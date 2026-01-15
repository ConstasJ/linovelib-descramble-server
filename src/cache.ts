import { readFile, writeFile, lstat, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const globalCache: Map<string, any> = new Map();

export function getCachedValue<T>(key: string): T | undefined {
    return globalCache.get(key);
}

export function setCachedValue<T>(key: string, value: T): void {
    globalCache.set(key, value);
}

export function clearCache(): void {
    globalCache.clear();
}

export async function persistCache(): Promise<void> {
    const obj: Record<string, any> = {
        "__persistedAt": Date.now()
    };
    for (const [key, value] of globalCache.entries()) {
        obj[key] = value;
    }
    if (!existsSync("data")) await mkdir("data")
    else {
        const stats = await lstat("data");
        if (!stats.isDirectory()) {
            await rm("data");
            await mkdir("data");
        }
    }
    await writeFile("data/cache.json", JSON.stringify(obj), "utf-8").catch((err) => {
        console.error("Error persisting cache:", err);
    });
}

export async function loadCache(): Promise<void> {
    try {
        const data = await readFile("cache.json", "utf-8");
        const obj = JSON.parse(data);
        for (const key in obj) {
            if (key === "__persistedAt") continue;
            globalCache.set(key, obj[key]);
        }
    } catch (err) {
        console.warn("No existing cache to load.");
    }
}