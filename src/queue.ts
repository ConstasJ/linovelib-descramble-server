import PQueue from "p-queue";
import { getCache, setCache } from "./cache";
import { fetchText, FetchType, fetchWithAppliance, solveSearchChallenge } from "./utils";
import { load } from "cheerio";

// 定义任务返回的类型
interface ApiResponse {
    success: boolean;
    data?: any;
    error?: string;
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
    
    constructor() {
        this.queue = new PQueue({
            concurrency: 1,
        });
    }

    private getRandomDelay(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async fetchChapterPartContent(url: string): Promise<string> {
        return await this.queue.add(async () => {
            try {
                return await fetchText(url);
            } catch (e) {
                throw new Error(`获取章节Part内容失败: ${e}`);
            } finally {
                const delay = this.getRandomDelay(200, 1000);
                console.log(`[ChapterQueue] 章节Part请求完成，延时 ${delay}ms 后开始下一个请求。`);
                await this.sleep(delay);
            }
        })
    }
}

// 导出单例，确保全站共用同一个限流器
export const searchQueue = new SearchQueue();
export const novelChapterQueue = new NovelChapterQueue();
