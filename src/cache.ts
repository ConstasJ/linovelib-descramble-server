import { NovelItem } from "./types";
import {
    existsSync,
    writeFileSync,
    mkdirSync,
    statSync,
    rmSync,
} from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { zstdCompress as zc, zstdDecompress as zd } from "node:zlib";

const zstdCompress = (data: Buffer): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
        zc(data, (err, compressedData) => {
            if (err) {
                reject(err);
            } else {
                resolve(compressedData);
            }
        });
    });
};

const zstdDecompress = (data: Buffer): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
        zd(data, (err, decompressedData) => {
            if (err) {
                reject(err);
            } else {
                resolve(decompressedData);
            }
        });
    });
};

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
        Date.now() - keywordsToNovelsMap.get(query)!.queryTime <
            48 * 60 * 60 * 1000
    ) {
        return keywordsToNovelsMap.get(query)!.novels;
    } else {
        return [];
    }
}

const novelsCacheDir = `${dataDir}/novels`;

export async function getNovelContentFromStorage(
    novelId: number,
    chapterId: number,
): Promise<string | null> {
    const novelCacheDir = `${novelsCacheDir}/${novelId}`;
    if (!existsSync(novelCacheDir) || (await stat(novelCacheDir)).isDirectory() === false) {
        return null;
    }
    const chapterFilePath = `${novelCacheDir}/${chapterId}.zstd`;
    if (!existsSync(chapterFilePath)) {
        return null;
    }
    const compressedData = await readFile(chapterFilePath);
    const decompressedData = await zstdDecompress(compressedData);
    return new TextDecoder().decode(decompressedData);
}

export async function setNovelContentToStorage(
    novelId: number,
    chapterId: number,
    content: string,
): Promise<void> {
    const novelCacheDir = `${novelsCacheDir}/${novelId}`;
    if (!existsSync(novelCacheDir)) {
        await mkdir(novelCacheDir, { recursive: true });
    } else if (existsSync(novelCacheDir) && !(await stat(novelCacheDir)).isDirectory()) {
        await rm(novelCacheDir);
        await mkdir(novelCacheDir, { recursive: true });
    }
    const chapterFilePath = `${novelCacheDir}/${chapterId}.zstd`;
    const compressedData = await zstdCompress(Buffer.from(content, "utf-8"));
    await writeFile(chapterFilePath, compressedData);
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
        for (const [key, value] of Object.entries(
            cacheData.keywordsToNovelsMap,
        )) {
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
