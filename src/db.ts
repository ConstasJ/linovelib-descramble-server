import Database from "better-sqlite3";
import { and, eq, gte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import {
    chapterPaths,
    coverMetadata,
    generalCache,
    keywordNovels,
    keywordSearches,
    novels,
} from "./schema";
import { NovelItem } from "./types";

const dataDir = process.env.DATA_DIR || "./data";
const DB_PATH = `${dataDir}/cache.db`;

let db: Database.Database | null = null;
let orm: ReturnType<typeof drizzle> | null = null;

function getDb(): Database.Database {
    if (!db) throw new Error("Database not initialized. Call initDB() first.");
    return db;
}

function getOrm(): NonNullable<typeof orm> {
    if (!orm) throw new Error("Database not initialized. Call initDB() first.");
    return orm;
}

export function initDB(): void {
    if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
    }
    if (existsSync(dataDir) && !statSync(dataDir).isDirectory()) {
        rmSync(dataDir);
        mkdirSync(dataDir, { recursive: true });
    }

    db = new Database(DB_PATH);
    orm = drizzle(db);

    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");

    createTables();
}

export function closeDB(): void {
    if (db) {
        db.close();
        db = null;
        orm = null;
    }
}

function createTables(): void {
    const d = getDb();
    d.exec(`
        CREATE TABLE IF NOT EXISTS novels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            cover TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
        );

        CREATE TABLE IF NOT EXISTS keyword_searches (
            keyword TEXT PRIMARY KEY,
            query_time INTEGER NOT NULL,
            total INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS keyword_novels (
            keyword TEXT NOT NULL,
            novel_id INTEGER NOT NULL,
            PRIMARY KEY (keyword, novel_id),
            FOREIGN KEY (keyword) REFERENCES keyword_searches(keyword) ON DELETE CASCADE,
            FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS chapter_paths (
            name TEXT PRIMARY KEY,
            path TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cover_metadata (
            hash TEXT PRIMARY KEY,
            content_type TEXT NOT NULL,
            original_url TEXT NOT NULL,
            ext TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS general_cache (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);
}

// ========== Novel + Keyword CRUD ==========

export function dbAddNovelsForKeyword(
    keyword: string,
    novelsList: NovelItem[],
): void {
    const d = getOrm();

    d.transaction((tx) => {
        tx.insert(keywordSearches)
            .values({
                keyword,
                queryTime: Date.now(),
                total: novelsList.length,
            })
            .onConflictDoUpdate({
                target: keywordSearches.keyword,
                set: { queryTime: Date.now(), total: novelsList.length },
            })
            .run();

        for (const novel of novelsList) {
            const inserted = tx
                .insert(novels)
                .values({
                    path: novel.path,
                    name: novel.name,
                    cover: novel.cover || null,
                })
                .onConflictDoUpdate({
                    target: novels.path,
                    set: { name: novel.name, cover: novel.cover || null },
                })
                .returning({ id: novels.id })
                .all();

            const novelRow = inserted[0];
            if (novelRow) {
                tx.insert(keywordNovels)
                    .values({ keyword, novelId: novelRow.id })
                    .onConflictDoNothing()
                    .run();
            }
        }
    });
}

export function dbSearchNovels(keyword: string): NovelItem[] | null {
    const d = getOrm();
    const minQueryTime = Date.now() - 48 * 60 * 60 * 1000;

    const searchRows = d
        .select({ keyword: keywordSearches.keyword })
        .from(keywordSearches)
        .where(
            and(
                eq(keywordSearches.keyword, keyword),
                gte(keywordSearches.queryTime, minQueryTime),
            ),
        )
        .all();
    const search = searchRows[0];
    if (!search) return null;

    const rows = d
        .select({ path: novels.path, name: novels.name, cover: novels.cover })
        .from(keywordNovels)
        .innerJoin(novels, eq(keywordNovels.novelId, novels.id))
        .where(eq(keywordNovels.keyword, keyword))
        .all();

    return rows.map((r) => ({
        path: r.path,
        name: r.name,
        cover: r.cover || "",
    }));
}

// ========== Chapter Path CRUD ==========

export function dbSetChapterPath(name: string, path: string): void {
    getOrm()
        .insert(chapterPaths)
        .values({ name, path })
        .onConflictDoUpdate({ target: chapterPaths.name, set: { path } })
        .run();
}

export function dbGetChapterPath(name: string): string | undefined {
    const row = getOrm()
        .select({ path: chapterPaths.path })
        .from(chapterPaths)
        .where(eq(chapterPaths.name, name))
        .all()[0];
    return row?.path;
}

// ========== Cover Metadata CRUD ==========

export function dbSetCoverMeta(
    hash: string,
    contentType: string,
    originalUrl: string,
    ext: string,
): void {
    getOrm()
        .insert(coverMetadata)
        .values({ hash, contentType, originalUrl, ext })
        .onConflictDoUpdate({
            target: coverMetadata.hash,
            set: { contentType, originalUrl, ext },
        })
        .run();
}

export function dbGetCoverMeta(
    hash: string,
): { contentType: string; originalUrl: string; ext: string } | undefined {
    const row = getOrm()
        .select({
            contentType: coverMetadata.contentType,
            originalUrl: coverMetadata.originalUrl,
            ext: coverMetadata.ext,
        })
        .from(coverMetadata)
        .where(eq(coverMetadata.hash, hash))
        .all()[0];
    return row;
}

// ========== General Cache CRUD ==========

export function dbSetGeneralCache(key: string, value: unknown): void {
    getOrm()
        .insert(generalCache)
        .values({ key, value: JSON.stringify(value) })
        .onConflictDoUpdate({
            target: generalCache.key,
            set: { value: JSON.stringify(value) },
        })
        .run();
}

export function dbGetGeneralCache<T>(key: string): T | undefined {
    const row = getOrm()
        .select({ value: generalCache.value })
        .from(generalCache)
        .where(eq(generalCache.key, key))
        .all()[0];
    if (!row) return undefined;
    return JSON.parse(row.value) as T;
}

// ========== Bulk Export (for backup) ==========

export function dbGetAllKeywordSearches(): Array<{
    keyword: string;
    queryTime: number;
    total: number;
    novels: NovelItem[];
}> {
    const d = getOrm();
    const keywords = d
        .select({
            keyword: keywordSearches.keyword,
            queryTime: keywordSearches.queryTime,
            total: keywordSearches.total,
        })
        .from(keywordSearches)
        .orderBy(sql`${keywordSearches.keyword}`)
        .all();

    return keywords.map((kw) => {
        const rows = d
            .select({
                path: novels.path,
                name: novels.name,
                cover: novels.cover,
            })
            .from(keywordNovels)
            .innerJoin(novels, eq(keywordNovels.novelId, novels.id))
            .where(eq(keywordNovels.keyword, kw.keyword))
            .all();

        return {
            keyword: kw.keyword,
            queryTime: kw.queryTime,
            total: kw.total,
            novels: rows.map((n) => ({
                path: n.path,
                name: n.name,
                cover: n.cover || "",
            })),
        };
    });
}

export function dbGetAllChapterPaths(): Record<string, string> {
    const rows = getOrm()
        .select({ name: chapterPaths.name, path: chapterPaths.path })
        .from(chapterPaths)
        .all();
    const result: Record<string, string> = {};
    for (const r of rows) result[r.name] = r.path;
    return result;
}

export function dbGetAllCoverMetadata(): Record<
    string,
    { contentType: string; originalUrl: string; ext: string }
> {
    const rows = getOrm()
        .select({
            hash: coverMetadata.hash,
            contentType: coverMetadata.contentType,
            originalUrl: coverMetadata.originalUrl,
            ext: coverMetadata.ext,
        })
        .from(coverMetadata)
        .all();
    const result: Record<
        string,
        { contentType: string; originalUrl: string; ext: string }
    > = {};
    for (const r of rows) {
        result[r.hash] = {
            contentType: r.contentType,
            originalUrl: r.originalUrl,
            ext: r.ext,
        };
    }
    return result;
}

export function dbGetAllGeneralCache(): Record<string, unknown> {
    const rows = getOrm()
        .select({ key: generalCache.key, value: generalCache.value })
        .from(generalCache)
        .all();
    const result: Record<string, unknown> = {};
    for (const r of rows) {
        try {
            result[r.key] = JSON.parse(r.value);
        } catch {
            result[r.key] = r.value;
        }
    }
    return result;
}

// ========== Migration: cache.json → SQLite ==========

interface CacheJsonData {
    lastUpdate?: number;
    novels?: NovelItem[];
    keywordsToNovelsMap?: Record<
        string,
        { queryTime: number; total: number; novels: NovelItem[] }
    >;
    chapterNameToPathCache?: Record<string, string>;
    coverMetadata?: Record<
        string,
        { contentType: string; originalUrl: string; ext: string }
    >;
    [key: string]: unknown;
}

export function migrateFromCacheJson(cacheData: CacheJsonData): void {
    const d = getOrm();

    d.transaction((tx) => {
        if (cacheData.keywordsToNovelsMap) {
            for (const [keyword, entry] of Object.entries(
                cacheData.keywordsToNovelsMap,
            )) {
                tx.insert(keywordSearches)
                    .values({
                        keyword,
                        queryTime: entry.queryTime,
                        total: entry.total,
                    })
                    .onConflictDoUpdate({
                        target: keywordSearches.keyword,
                        set: { queryTime: entry.queryTime, total: entry.total },
                    })
                    .run();

                for (const novel of entry.novels) {
                    const inserted = tx
                        .insert(novels)
                        .values({
                            path: novel.path,
                            name: novel.name,
                            cover: novel.cover || null,
                        })
                        .onConflictDoUpdate({
                            target: novels.path,
                            set: {
                                name: novel.name,
                                cover: novel.cover || null,
                            },
                        })
                        .returning({ id: novels.id })
                        .all();

                    const novelRow = inserted[0];
                    if (novelRow) {
                        tx.insert(keywordNovels)
                            .values({ keyword, novelId: novelRow.id })
                            .onConflictDoNothing()
                            .run();
                    }
                }
            }
        }

        if (cacheData.chapterNameToPathCache) {
            for (const [name, path] of Object.entries(
                cacheData.chapterNameToPathCache,
            )) {
                tx.insert(chapterPaths)
                    .values({ name, path })
                    .onConflictDoUpdate({
                        target: chapterPaths.name,
                        set: { path },
                    })
                    .run();
            }
        }

        if (cacheData.coverMetadata) {
            for (const [hash, meta] of Object.entries(
                cacheData.coverMetadata,
            )) {
                tx.insert(coverMetadata)
                    .values({
                        hash,
                        contentType: meta.contentType,
                        originalUrl: meta.originalUrl,
                        ext: meta.ext,
                    })
                    .onConflictDoUpdate({
                        target: coverMetadata.hash,
                        set: {
                            contentType: meta.contentType,
                            originalUrl: meta.originalUrl,
                            ext: meta.ext,
                        },
                    })
                    .run();
            }
        }

        const skipKeys = new Set([
            "lastUpdate",
            "novels",
            "keywordsToNovelsMap",
            "chapterNameToPathCache",
            "coverMetadata",
        ]);
        for (const [key, value] of Object.entries(cacheData)) {
            if (!skipKeys.has(key)) {
                tx.insert(generalCache)
                    .values({ key, value: JSON.stringify(value) })
                    .onConflictDoUpdate({
                        target: generalCache.key,
                        set: { value: JSON.stringify(value) },
                    })
                    .run();
            }
        }
    });

    console.log("[DB] Migration from cache.json completed.");
}
