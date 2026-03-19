import { NovelItem } from "./types";
import { createHash } from "node:crypto";
import {
    existsSync,
    writeFileSync,
    mkdirSync,
    statSync,
    rmSync,
} from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { zstdCompress as zc, zstdDecompress as zd } from "node:zlib";
import {
    dbAddNovelsForKeyword,
    dbSetChapterPath,
    dbSetCoverMeta,
    dbSetGeneralCache,
} from "./db";

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
    try {
        dbSetGeneralCache(key, value);
    } catch (e) {
        console.error("[DB] dual-write generalCache failed:", e);
    }
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
    try {
        dbAddNovelsForKeyword(keyword, novels);
    } catch (e) {
        console.error("[DB] dual-write novels failed:", e);
    }
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
    if (
        !existsSync(novelCacheDir) ||
        (await stat(novelCacheDir)).isDirectory() === false
    ) {
        return null;
    }
    const chapterFilePath = `${novelCacheDir}/${chapterId}.zst`;
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
    } else if (
        existsSync(novelCacheDir) &&
        !(await stat(novelCacheDir)).isDirectory()
    ) {
        await rm(novelCacheDir);
        await mkdir(novelCacheDir, { recursive: true });
    }
    const chapterFilePath = `${novelCacheDir}/${chapterId}.zst`;
    const compressedData = await zstdCompress(Buffer.from(content, "utf-8"));
    await writeFile(chapterFilePath, compressedData);
}

const chapterNameToPathCache: Map<string, string> = new Map();

export function getChapterPathFromCache(name: string): string | undefined {
    return chapterNameToPathCache.get(name);
}

export function setChapterPathToCache(name: string, path: string): void {
    chapterNameToPathCache.set(name, path);
    try {
        dbSetChapterPath(name, path);
    } catch (e) {
        console.error("[DB] dual-write chapterPath failed:", e);
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

// ========== 封面缓存系统 ==========

const coversCacheDir = `${dataDir}/covers`;

type CoverMeta = {
    contentType: string;
    originalUrl: string;
    ext: string;
};

const coverMetadataMap: Map<string, CoverMeta> = new Map();

function getCoverHash(url: string): string {
    return createHash("md5").update(url).digest("hex");
}

function getExtFromContentType(contentType: string): string {
    if (contentType.includes("jpeg") || contentType.includes("jpg"))
        return "jpg";
    if (contentType.includes("png")) return "png";
    if (contentType.includes("gif")) return "gif";
    if (contentType.includes("webp")) return "webp";
    if (contentType.includes("avif")) return "avif";
    return "bin";
}

export async function getCoverFromCache(
    url: string,
): Promise<{ data: Buffer; contentType: string } | null> {
    const hash = getCoverHash(url);
    const meta = coverMetadataMap.get(hash);
    if (!meta) return null;
    const filePath = `${coversCacheDir}/${hash}.${meta.ext}`;
    if (!existsSync(filePath)) return null;
    const data = await readFile(filePath);
    return { data, contentType: meta.contentType };
}

export async function setCoverToCache(
    url: string,
    data: Buffer,
    contentType: string,
): Promise<void> {
    const hash = getCoverHash(url);
    const ext = getExtFromContentType(contentType);
    if (!existsSync(coversCacheDir)) {
        await mkdir(coversCacheDir, { recursive: true });
    }
    const filePath = `${coversCacheDir}/${hash}.${ext}`;
    await writeFile(filePath, data);
    coverMetadataMap.set(hash, {
        contentType,
        originalUrl: url,
        ext,
    });
    try {
        dbSetCoverMeta(hash, contentType, url, ext);
    } catch (e) {
        console.error("[DB] dual-write coverMeta failed:", e);
    }
}

export function saveCache() {
    createDataDirIfNotExists();
    const cacheFilePath = `${dataDir}/cache.json`;
    let cacheData = {
        lastUpdate: Date.now(),
        novels: novelsCache,
        keywordsToNovelsMap: Object.fromEntries(keywordsToNovelsMap),
        chapterNameToPathCache: Object.fromEntries(chapterNameToPathCache),
        coverMetadata: Object.fromEntries(coverMetadataMap),
    };
    // merge generalCache into cacheData
    for (const [key, value] of generalCache.entries()) {
        if (key in cacheData) continue;
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
        for (const [key, value] of Object.entries(
            cacheData.chapterNameToPathCache,
        )) {
            chapterNameToPathCache.set(key, value as string);
        }
        // 恢复封面元数据
        if (cacheData.coverMetadata) {
            for (const [key, value] of Object.entries(
                cacheData.coverMetadata,
            )) {
                coverMetadataMap.set(key, value as CoverMeta);
            }
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
