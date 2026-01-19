import { NovelItem } from "./types";
import {
  existsSync,
  writeFileSync,
  mkdirSync,
  statSync,
  rmSync,
} from "node:fs";
import { readFile } from "node:fs/promises";

const novelsCache: Array<NovelItem> = [];

type KTNMValue = {
  queryTime: number;
  total: number;
  novels: Array<NovelItem>;
};

const dataDir = process.env.DATA_DIR || "./data";

const keywordsToNovelsMap: Map<string, KTNMValue> = new Map();

const generalCache: Map<string, any> = new Map();

export function getCache<T>(key: string): T | undefined {
  return generalCache.get(key);
}

export function setCache<T>(key: string, value: T): void {
  generalCache.set(key, value);
}

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
  if (
    keywordsToNovelsMap.has(query) &&
    Date.now() - keywordsToNovelsMap.get(query)!.queryTime < 48 * 60 * 60 * 1000
  ) {
    return keywordsToNovelsMap.get(query)!.novels;
  } else {
    return [];
  }
}

export function createDataDirIfNotExists() {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  if (existsSync(dataDir) && !statSync(dataDir).isDirectory()) {
    rmSync(dataDir);
    mkdirSync(dataDir, { recursive: true });
  }
}

export function saveCache() {
  createDataDirIfNotExists();
  const cacheFilePath = `${dataDir}/cache.json`;
  let cacheData = {
    lastUpdate: Date.now(),
    novels: novelsCache,
    keywordsToNovelsMap: Object.fromEntries(keywordsToNovelsMap),
  };
  // merge generalCache into cacheData
  for (const [key, value] of generalCache.entries()) {
    (cacheData as any)[key] = value;
  }
  writeFileSync(cacheFilePath, JSON.stringify(cacheData), "utf-8");
}

export async function loadCache(): Promise<void> {
  const novelCacheFilePath = `${dataDir}/cache.json`;
  if (existsSync(novelCacheFilePath)) {
    const fileData = await readFile(novelCacheFilePath, "utf-8");
    const cacheData = JSON.parse(fileData);
    novelsCache.push(...cacheData.novels);
    for (const [key, value] of Object.entries(cacheData.keywordsToNovelsMap)) {
      keywordsToNovelsMap.set(key, value as KTNMValue);
    }
    // extract other entries into generalCache
    for (const [key, value] of Object.entries(cacheData)) {
      if (
        key !== "lastUpdate" &&
        key !== "novels" &&
        key !== "keywordsToNovelsMap"
      ) {
        generalCache.set(key, value);
      }
    }
  }
}
