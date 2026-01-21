import PQueue from 'p-queue';

// 定义任务返回的类型
interface ApiResponse {
    success: boolean;
    data?: any;
    error?: string;
}

class SearchQueue {
    private queue: PQueue;

    constructor() {
        // 核心配置
        this.queue = new PQueue({
            concurrency: 1,      // 严格并发数为 1
            interval: 5000,      // 每 5000 毫秒
            intervalCap: 1       // 在上述时间内只允许执行 1 次任务
        });

        // 监控：可以记录队列排队情况
        this.queue.on('add', () => {
            console.log(`[Queue] 任务已添加，当前排队数: ${this.queue.size}`);
        });

        this.queue.on('next', () => {
            console.log(`[Queue] 任务完成或超时，开始下一个任务。剩余: ${this.queue.size}`);
        });
    }

    /**
     * 执行下游 API 请求
     * @param apiTask 一个返回 Promise 的函数
     */
    async execute<T>(apiTask: () => Promise<T>): Promise<T> {
        // 将任务加入队列，并等待其执行结果
        return await this.queue.add(apiTask);
    }
}

// 导出单例，确保全站共用同一个限流器
export const searchQueue = new SearchQueue();
