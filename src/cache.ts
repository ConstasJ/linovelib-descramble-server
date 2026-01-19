import { NovelItem } from "./types";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, stat, rm } from "node:fs/promises";

const novelsCache: Array<NovelItem> = [];

type KTNMValue = {
    queryTime: number;
    total: number;
    novels: Array<NovelItem>;
}

const keywordsToNovelsMap: Map<string, KTNMValue> = new Map();

export function clearNovelsCache(): void {
    novelsCache.length = 0;
}

export function addToNovelsCache(keyword: string, novels: NovelItem[]): void {
    keywordsToNovelsMap.set(keyword, {
        queryTime: Date.now(),
        total: novels.length,
        novels: novels,
    });
    novelsCache.push(...novels);
}

export function searchNovelsInCache(query: string): NovelItem[] {
    if (keywordsToNovelsMap.has(query) && (Date.now() - keywordsToNovelsMap.get(query)!.queryTime) < 48 * 60 * 60 * 1000) {
        return keywordsToNovelsMap.get(query)!.novels;
    } else {
        return [];
    }
}

const dataDir = process.env.DATA_DIR || "./data";

async function createDataDirIfNotExists(): Promise<void> {
    if (!existsSync(dataDir)) {
        await mkdir(dataDir, { recursive: true });
    }
    if (existsSync(dataDir) && !(await stat(dataDir)).isDirectory()) {
        await rm(dataDir);
        await mkdir(dataDir, { recursive: true });
    }
}

export async function saveCache(): Promise<void> {
    await createDataDirIfNotExists();
    const cacheFilePath = `${dataDir}/novelsCache.json`;
    const cacheData = {
        lastUpdate: Date.now(),
        novelsCache,
        keywordsToNovelsMap: Array.from(keywordsToNovelsMap.entries()),
    };
    await writeFile(cacheFilePath, JSON.stringify(cacheData), "utf-8");
}

export async function loadCache(): Promise<void> {
    const novelCacheFilePath = `${dataDir}/novelsCache.json`;
    if (existsSync(novelCacheFilePath)) {
        const fileData = await readFile(novelCacheFilePath, "utf-8");
        const cacheData = JSON.parse(fileData);
        novelsCache.push(...cacheData.novelsCache);
        for (const [key, value] of cacheData.keywordsToNovelsMap) {
            keywordsToNovelsMap.set(key, value);
        }
    }
}