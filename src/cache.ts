import { NovelItem } from "./types";

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