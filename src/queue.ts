import PQueue from "p-queue";
import { getCache, setCache } from "./cache";
import {
    fetchText,
    FetchType,
    fetchWithAppliance,
    solveSearchChallenge,
    AccessDeniedError,
} from "./utils";
import { load } from "cheerio";

/**
 * Simple backoff strategy for request rate limiting
 * - Normal delay: 50-100ms random
 * - Failure delay: 8000ms (8 seconds)
 */
class SimpleBackoff {
    private readonly NORMAL_DELAY_MIN = 500;
    private readonly NORMAL_DELAY_MAX = 600;
    private readonly FAILURE_DELAY = 15000;

    /**
     * Get delay for normal (successful) operation
     * @returns Random delay in range [500, 600]ms
     */
    getDelayForSuccess(): number {
        return (
            this.NORMAL_DELAY_MIN +
            Math.random() * (this.NORMAL_DELAY_MAX - this.NORMAL_DELAY_MIN)
        );
    }

    /**
     * Get delay after a failure
     * @returns Fixed delay of 8000ms
     */
    getDelayForFailure(): number {
        return this.FAILURE_DELAY;
    }
}

class SearchQueue {
    private queue: PQueue;
    private lastFinishTime: number = 0;
    private readonly COOLDOWN_MS = 5000;

    constructor() {
        // 核心配置
        this.queue = new PQueue({
            concurrency: 1,
        });

        // 监控：可以记录队列排队情况
        this.queue.on("add", () => {
            console.log(`[Queue] 任务已添加，当前排队数: ${this.queue.size}`);
        });

        this.queue.on("next", () => {
            console.log(
                `[Queue] 任务完成或超时，开始下一个任务。剩余: ${this.queue.size}`,
            );
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async performFirstSearch(keyword: string): Promise<string> {
        return this.queue.add(async () => {
            const now = Date.now();
            const timeSinceLastFinish = now - this.lastFinishTime;
            if (timeSinceLastFinish < this.COOLDOWN_MS) {
                const waitTime = this.COOLDOWN_MS - timeSinceLastFinish;
                console.log(
                    `[Queue] 下游冷却中，下一个用户需额外排队等待: ${waitTime}ms`,
                );
                await this.sleep(waitTime);
            }
            try {
                console.log(`[Queue] 冷却完毕或无需冷却，开始请求下游...`);
                let haha: string = getCache("haha") || "";
                let resp = await fetchWithAppliance(
                    "https://www.linovelib.com/S6/",
                    FetchType.POST,
                    `searchkey=${encodeURIComponent(keyword)}`,
                    { haha },
                );
                let $ = load(resp);
                if ($("#challenge-running").length > 0) {
                    let a = "",
                        b = "",
                        c = "";
                    $("script").each((_, el) => {
                        const scriptContent = $(el).html() || "";
                        if (/window\.a\s*=\s*'([^']+)'/.test(scriptContent)) {
                            a =
                                scriptContent.match(
                                    /window\.a\s*=\s*'([^']+)'/,
                                )?.[1] || "";
                            b =
                                scriptContent.match(
                                    /window\.b\s*=\s*'([^']+)'/,
                                )?.[1] || "";
                            c =
                                scriptContent.match(
                                    /window\.c\s*=\s*'([^']+)'/,
                                )?.[1] || "";
                        }
                    });
                    haha = await solveSearchChallenge(a, b, c);
                    await new Promise((r) => setTimeout(r, 3000));
                    resp = await fetchWithAppliance(
                        "https://www.linovelib.com/S6/",
                        FetchType.POST,
                        `searchkey=${encodeURIComponent(keyword)}`,
                        { haha },
                    );
                    $ = load(resp);
                    if ($("#challenge-running").length === 0) {
                        setCache("haha", haha);
                    }
                }
                this.lastFinishTime = Date.now();
                return resp;
            } catch (e) {
                this.lastFinishTime = Date.now();
                throw new Error(`搜索请求失败: ${(e as Error).message}`);
            }
        });
    }
}

class NovelChapterQueue {
    private queue: PQueue;
    private backoff: SimpleBackoff;

    constructor() {
        this.queue = new PQueue({
            concurrency: 1,
        });
        this.backoff = new SimpleBackoff();
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Detects if an error is caused by Cloudflare WAF blocking.
     * Checks for:
     * 1. HTTP status codes 401 or 403 (access denied by Cloudflare)
     * 2. Cloudflare-specific text patterns in error messages
     *
     * @param error - The error object to check
     * @returns true if Cloudflare blocking is detected, false otherwise
     */
    private isCloudflareBlock(error: any): boolean {
        const errorMessage = String(error?.message || "").toLowerCase();
        const errorContent = String(error?.response || "").toLowerCase();

        // Check for HTTP status codes 401 or 403
        const isCFStatusCode =
            error?.status === 401 ||
            error?.status === 403 ||
            error?.statusCode === 401 ||
            error?.statusCode === 403 ||
            /(401|403)/.test(errorMessage);

        // Check for Cloudflare-specific text patterns
        const cfPatterns = [
            /cloudflare/,
            /cf-ray/,
            /access denied/,
            /challenge/,
            /captcha/,
            /attention required/,
        ];
        const isCFPattern = cfPatterns.some(
            (pattern) =>
                pattern.test(errorMessage) || pattern.test(errorContent),
        );

        return isCFStatusCode || isCFPattern;
    }

    async fetchChapterPartContent(url: string): Promise<string> {
        return await this.queue.add(async () => {
            const match = url.match(/\/novel\/(\d+)\/(\d+)(?:_(\d+))?\.html/);
            if (!match) {
                throw new Error(`无效的章节Part URL: ${url}`);
            }
            const novelId = match[1];
            const chapterId = match[2];
            const partId = match[3] || "1";

            const maxRetries = 1000;
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    const content = await fetchText(url);

                    // Success: apply normal delay (50-100ms random)
                    const delay = this.backoff.getDelayForSuccess();
                    console.log(
                        `[ChapterQueue] 小说${novelId}-章节${chapterId}-Part${partId}请求成功，将等待 ${Math.round(delay)}ms`,
                    );
                    await this.sleep(delay);

                    return content;
                } catch (e) {
                    lastError = e as Error;
                    const isCFBlock = this.isCloudflareBlock(e);

                    // Check if we should retry
                    const shouldRetry =
                        (isCFBlock || e instanceof AccessDeniedError) &&
                        attempt < maxRetries;

                    if (shouldRetry) {
                        // Failure: apply large delay (8 seconds)
                        const retryDelay = this.backoff.getDelayForFailure();

                        console.warn(
                            `[ChapterQueue] 检测到访问限制 (尝试 ${attempt}/${maxRetries})，将延迟 ${retryDelay / 1000}s 后重试`,
                        );

                        await this.sleep(retryDelay);
                        continue; // Retry
                    } else {
                        // Non-retryable error or max retries reached
                        if (isCFBlock || e instanceof AccessDeniedError) {
                            console.error(
                                `[ChapterQueue] Cloudflare防护触发，已达最大重试次数 (${maxRetries})`,
                            );
                        } else {
                            console.error(
                                `[ChapterQueue] 获取章节Part内容失败: ${lastError.message}`,
                            );
                        }

                        // Still apply normal delay before throwing
                        const delay = this.backoff.getDelayForSuccess();
                        await this.sleep(delay);

                        throw new Error(`获取章节Part内容失败: ${lastError.message}`);
                    }
                }
            }

            // Should never reach here, but TypeScript needs it
            throw lastError!;
        });
    }
}

// 导出单例，确保全站共用同一个限流器
export const searchQueue = new SearchQueue();
export const novelChapterQueue = new NovelChapterQueue();
