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
    dbSearchNovels,
    dbSetChapterPath,
    dbGetChapterPath,
    dbSetCoverMeta,
    dbGetCoverMeta,
    dbSetGeneralCache,
    dbGetGeneralCache,
    dbGetAllKeywordSearches,
    dbGetAllChapterPaths,
    dbGetAllCoverMetadata,
    dbGetAllGeneralCache,
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

const dataDir = process.env.DATA_DIR || "./data";

// ========== General Cache ==========

export function getCache<T>(key: string): T | undefined {
    return dbGetGeneralCache<T>(key);
}

export function setCache<T>(key: string, value: T): void {
    dbSetGeneralCache(key, value);
}

// ========== Novel Search Cache ==========

export function addToNovelsCache(keyword: string, novels: NovelItem[]): void {
    dbAddNovelsForKeyword(keyword, novels);
}

export function searchNovelsInCache(query: string): NovelItem[] {
    return dbSearchNovels(query) || [];
}

// ========== Novel Content Storage (file-based, unchanged) ==========

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

// ========== Chapter Path Cache ==========

export function getChapterPathFromCache(name: string): string | undefined {
    return dbGetChapterPath(name);
}

export function setChapterPathToCache(name: string, path: string): void {
    dbSetChapterPath(name, path);
}

// ========== Cover Cache System ==========

export function createDataDirIfNotExists() {
    if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
    }
    if (existsSync(dataDir) && !statSync(dataDir).isDirectory()) {
        rmSync(dataDir);
        mkdirSync(dataDir, { recursive: true });
    }
}

const coversCacheDir = `${dataDir}/covers`;

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
    const meta = dbGetCoverMeta(hash);
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
    dbSetCoverMeta(hash, contentType, url, ext);
}

// ========== Backup: export SQLite → cache.json ==========

export function saveCache() {
    createDataDirIfNotExists();
    const cacheFilePath = `${dataDir}/cache.json`;

    // Build backup from SQLite data
    const keywordSearches = dbGetAllKeywordSearches();
    const keywordsToNovelsMap: Record<
        string,
        { queryTime: number; total: number; novels: NovelItem[] }
    > = {};
    const allNovels: NovelItem[] = [];
    for (const ks of keywordSearches) {
        keywordsToNovelsMap[ks.keyword] = {
            queryTime: ks.queryTime,
            total: ks.total,
            novels: ks.novels,
        };
        allNovels.push(...ks.novels);
    }

    const cacheData: Record<string, unknown> = {
        lastUpdate: Date.now(),
        novels: allNovels,
        keywordsToNovelsMap,
        chapterNameToPathCache: dbGetAllChapterPaths(),
        coverMetadata: dbGetAllCoverMetadata(),
    };

    // Merge general cache entries
    const generalEntries = dbGetAllGeneralCache();
    for (const [key, value] of Object.entries(generalEntries)) {
        if (!(key in cacheData)) {
            cacheData[key] = value;
        }
    }

    writeFileSync(cacheFilePath, JSON.stringify(cacheData), "utf-8");
}

/**
 * loadCache is now a no-op. SQLite is the source of truth.
 * Kept for API compatibility with index.ts startup sequence.
 */
export async function loadCache(): Promise<void> {
    // No-op: SQLite is the source of truth since Phase 2.
    // cache.json is only written as a backup on shutdown.
}
