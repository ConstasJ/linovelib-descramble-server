import PQueue from "p-queue";
import { getCache, setCache } from "./cache";
import {
    fetchText,
    FetchType,
    fetchWithAppliance,
    solveSearchChallenge,
} from "./utils";
import { load } from "cheerio";

/**
 * Configuration for adaptive backoff algorithm
 */
interface BackoffConfig {
    initialBaseDelay: number;  // Starting delay in ms
    minDelay: number;          // Minimum delay floor
    maxDelay: number;          // Maximum delay ceiling
    windowSize: number;        // Sliding window size for success rate
    speedUpThreshold: number;  // Success rate to trigger speedup (0.9)
    stableThreshold: number;   // Success rate for stable state (0.7)
    slowdownThreshold: number; // Success rate for moderate slowdown (0.5)
    decayFactor: number;       // Multiplier when speeding up (0.8)
    moderateIncrease: number;  // Multiplier for moderate slowdown (1.5)
    aggressiveIncrease: number;// Multiplier for aggressive slowdown (2.0)
}

const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
    initialBaseDelay: 1000,
    minDelay: 300,
    maxDelay: 30000,
    windowSize: 10,
    speedUpThreshold: 0.9,
    stableThreshold: 0.7,
    slowdownThreshold: 0.5,
    decayFactor: 0.8,
    moderateIncrease: 1.5,
    aggressiveIncrease: 2.0,
};

/**
 * Adaptive backoff algorithm for request rate limiting
 * Uses sliding window to track success rate and adjust delay accordingly
 */
class AdaptiveBackoff {
    private config: BackoffConfig;
    private currentBaseDelay: number;
    private successWindow: boolean[]; // Circular buffer for success/failure tracking
    private windowIndex: number = 0;

    constructor(config: Partial<BackoffConfig> = {}) {
        this.config = { ...DEFAULT_BACKOFF_CONFIG, ...config };
        this.currentBaseDelay = this.config.initialBaseDelay;
        this.successWindow = new Array(this.config.windowSize).fill(true);
    }

    /**
     * Records the outcome of a request
     * @param success - true if request succeeded, false if failed
     */
    recordOutcome(success: boolean): void {
        this.successWindow[this.windowIndex] = success;
        this.windowIndex = (this.windowIndex + 1) % this.config.windowSize;
        this.adjustBaseDelay();
    }

    /**
     * Calculates the next delay with full jitter
     * @returns delay in milliseconds
     */
    getNextDelay(): number {
        return this.getRandomDelay(this.config.minDelay, this.currentBaseDelay);
    }

    /**
     * Resets backoff to initial state
     */
    reset(): void {
        this.currentBaseDelay = this.config.initialBaseDelay;
        this.successWindow.fill(true);
        this.windowIndex = 0;
    }

    /**
     * Gets current base delay for monitoring
     */
    getCurrentBaseDelay(): number {
        return this.currentBaseDelay;
    }

    /**
     * Gets current success rate for monitoring
     */
    getSuccessWindowRate(): number {
        return this.calculateSuccessRate();
    }

    private calculateSuccessRate(): number {
        const successCount = this.successWindow.filter(s => s).length;
        return successCount / this.config.windowSize;
    }

    private adjustBaseDelay(): void {
        const successRate = this.calculateSuccessRate();
        
        if (successRate >= this.config.speedUpThreshold) {
            // High success rate: speed up
            this.currentBaseDelay = Math.max(
                this.config.minDelay,
                this.currentBaseDelay * this.config.decayFactor
            );
        } else if (successRate >= this.config.stableThreshold) {
            // Moderate success rate: keep stable
            // No change
        } else if (successRate >= this.config.slowdownThreshold) {
            // Low success rate: moderate slowdown
            this.currentBaseDelay = Math.min(
                this.config.maxDelay,
                this.currentBaseDelay * this.config.moderateIncrease
            );
        } else {
            // Very low success rate: aggressive slowdown
            this.currentBaseDelay = Math.min(
                this.config.maxDelay,
                this.currentBaseDelay * this.config.aggressiveIncrease
            );
        }
    }

    private getRandomDelay(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
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
    private backoff: AdaptiveBackoff;

    constructor() {
        this.queue = new PQueue({
            concurrency: 1,
        });
        this.backoff = new AdaptiveBackoff();

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
            try {
                const content = await fetchText(url);
                this.backoff.recordOutcome(true); // Record success
                return content;
            } catch (e) {
                // Detect Cloudflare WAF blocking
                const isCFBlock = this.isCloudflareBlock(e);
                
                // Record failure for backoff adjustment
                this.backoff.recordOutcome(false);
                
                // Log with different messages for CF blocks vs other errors
                if (isCFBlock) {
                    console.warn(
                        `[ChapterQueue] 检测到Cloudflare防护触发: ${(e as Error).message}`,
                    );
                } else {
                    console.error(
                        `[ChapterQueue] 获取章节Part内容失败: ${(e as Error).message}`,
                    );
                }

                throw new Error(`获取章节Part内容失败: ${e}`);
            } finally {
                const delay = this.backoff.getNextDelay();
                const successRate = this.backoff.getSuccessWindowRate();
                const baseDelay = this.backoff.getCurrentBaseDelay();
                console.log(
                    `[ChapterQueue] 小说${novelId}-章节${chapterId}-Part${partId}请求完成，延时 ${delay}ms (成功率: ${successRate.toFixed(2)}, 基础延时: ${baseDelay}ms)`,
                );
                await this.sleep(delay);
            }
        });
    }
}

// 导出单例，确保全站共用同一个限流器
export const searchQueue = new SearchQueue();
export const novelChapterQueue = new NovelChapterQueue();
