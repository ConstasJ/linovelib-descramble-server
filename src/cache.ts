import { NovelItem } from "./types";
import { existsSync, writeFileSync, mkdirSync, statSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";

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

function createDataDirIfNotExists() {
    if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
    }
    if (existsSync(dataDir) && !(statSync(dataDir)).isDirectory()) {
        rmSync(dataDir);
        mkdirSync(dataDir, { recursive: true });
    }
}

export function saveCache() {
    createDataDirIfNotExists();
    const cacheFilePath = `${dataDir}/novelsCache.json`;
    const cacheData = {
        lastUpdate: Date.now(),
        novels: novelsCache,
        keywordsToNovelsMap,
    };
    writeFileSync(cacheFilePath, JSON.stringify(cacheData), "utf-8");
}

export async function loadCache(): Promise<void> {
    const novelCacheFilePath = `${dataDir}/novelsCache.json`;
    if (existsSync(novelCacheFilePath)) {
        const fileData = await readFile(novelCacheFilePath, "utf-8");
        const cacheData = JSON.parse(fileData);
        novelsCache.push(...cacheData.novels);
        for (const [key, value] of Object.entries(cacheData.keywordsToNovelsMap)) {
            keywordsToNovelsMap.set(key, value as KTNMValue);
        }
    }
}