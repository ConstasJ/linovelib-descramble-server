import Database from "better-sqlite3";
import { existsSync, mkdirSync, statSync, rmSync } from "node:fs";
import { NovelItem } from "./types";

const dataDir = process.env.DATA_DIR || "./data";
const DB_PATH = `${dataDir}/cache.db`;

let db: Database.Database | null = null;

function getDb(): Database.Database {
    if (!db) throw new Error("Database not initialized. Call initDB() first.");
    return db;
}

export function initDB(): void {
    // Ensure data directory exists
    if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
    }
    if (existsSync(dataDir) && !statSync(dataDir).isDirectory()) {
        rmSync(dataDir);
        mkdirSync(dataDir, { recursive: true });
    }

    db = new Database(DB_PATH);

    // Performance pragmas
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");

    createTables();
    prepareStatements();
}

export function closeDB(): void {
    if (db) {
        db.close();
        db = null;
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

// Prepared statements cache
let stmts: {
    upsertNovel: Database.Statement;
    getNovelByPath: Database.Statement;
    upsertKeywordSearch: Database.Statement;
    upsertKeywordNovel: Database.Statement;
    getKeywordSearch: Database.Statement;
    getNovelsByKeyword: Database.Statement;
    upsertChapterPath: Database.Statement;
    getChapterPath: Database.Statement;
    upsertCoverMeta: Database.Statement;
    getCoverMeta: Database.Statement;
    upsertGeneralCache: Database.Statement;
    getGeneralCache: Database.Statement;
} | null = null;

function prepareStatements(): void {
    const d = getDb();
    stmts = {
        upsertNovel: d.prepare(`
            INSERT INTO novels (path, name, cover) VALUES (@path, @name, @cover)
            ON CONFLICT(path) DO UPDATE SET name=@name, cover=@cover
            RETURNING id
        `),
        getNovelByPath: d.prepare(
            `SELECT id, path, name, cover FROM novels WHERE path = ?`,
        ),
        upsertKeywordSearch: d.prepare(`
            INSERT INTO keyword_searches (keyword, query_time, total) VALUES (@keyword, @queryTime, @total)
            ON CONFLICT(keyword) DO UPDATE SET query_time=@queryTime, total=@total
        `),
        upsertKeywordNovel: d.prepare(`
            INSERT OR IGNORE INTO keyword_novels (keyword, novel_id) VALUES (@keyword, @novelId)
        `),
        getKeywordSearch: d.prepare(
            `SELECT keyword, query_time, total FROM keyword_searches WHERE keyword = ?`,
        ),
        getNovelsByKeyword: d.prepare(`
            SELECT n.path, n.name, n.cover
            FROM keyword_novels kn
            JOIN novels n ON kn.novel_id = n.id
            WHERE kn.keyword = ?
        `),
        upsertChapterPath: d.prepare(`
            INSERT INTO chapter_paths (name, path) VALUES (@name, @path)
            ON CONFLICT(name) DO UPDATE SET path=@path
        `),
        getChapterPath: d.prepare(
            `SELECT path FROM chapter_paths WHERE name = ?`,
        ),
        upsertCoverMeta: d.prepare(`
            INSERT INTO cover_metadata (hash, content_type, original_url, ext)
            VALUES (@hash, @contentType, @originalUrl, @ext)
            ON CONFLICT(hash) DO UPDATE SET content_type=@contentType, original_url=@originalUrl, ext=@ext
        `),
        getCoverMeta: d.prepare(
            `SELECT content_type, original_url, ext FROM cover_metadata WHERE hash = ?`,
        ),
        upsertGeneralCache: d.prepare(`
            INSERT INTO general_cache (key, value) VALUES (@key, @value)
            ON CONFLICT(key) DO UPDATE SET value=@value
        `),
        getGeneralCache: d.prepare(
            `SELECT value FROM general_cache WHERE key = ?`,
        ),
    };
}

function getStmts() {
    if (!stmts)
        throw new Error("Statements not prepared. Call initDB() first.");
    return stmts;
}

// ========== Novel + Keyword CRUD ==========

export function dbAddNovelsForKeyword(
    keyword: string,
    novels: NovelItem[],
): void {
    const d = getDb();
    const s = getStmts();

    const run = d.transaction(() => {
        // Upsert keyword search record
        s.upsertKeywordSearch.run({
            keyword,
            queryTime: Date.now(),
            total: novels.length,
        });

        for (const novel of novels) {
            // Upsert novel, get its id
            const row = s.upsertNovel.get({
                path: novel.path,
                name: novel.name,
                cover: novel.cover || null,
            }) as { id: number } | undefined;

            if (row) {
                s.upsertKeywordNovel.run({ keyword, novelId: row.id });
            }
        }
    });

    run();
}

export function dbSearchNovels(keyword: string): NovelItem[] | null {
    const s = getStmts();
    const search = s.getKeywordSearch.get(keyword) as
        | { keyword: string; query_time: number; total: number }
        | undefined;
    if (!search) return null;

    // Check 48h TTL
    if (Date.now() - search.query_time >= 48 * 60 * 60 * 1000) {
        return null;
    }

    const rows = s.getNovelsByKeyword.all(keyword) as Array<{
        path: string;
        name: string;
        cover: string | null;
    }>;
    return rows.map((r) => ({
        path: r.path,
        name: r.name,
        cover: r.cover || "",
    }));
}

// ========== Chapter Path CRUD ==========

export function dbSetChapterPath(name: string, path: string): void {
    getStmts().upsertChapterPath.run({ name, path });
}

export function dbGetChapterPath(name: string): string | undefined {
    const row = getStmts().getChapterPath.get(name) as
        | { path: string }
        | undefined;
    return row?.path;
}

// ========== Cover Metadata CRUD ==========

export function dbSetCoverMeta(
    hash: string,
    contentType: string,
    originalUrl: string,
    ext: string,
): void {
    getStmts().upsertCoverMeta.run({ hash, contentType, originalUrl, ext });
}

export function dbGetCoverMeta(
    hash: string,
): { contentType: string; originalUrl: string; ext: string } | undefined {
    const row = getStmts().getCoverMeta.get(hash) as
        | { content_type: string; original_url: string; ext: string }
        | undefined;
    if (!row) return undefined;
    return {
        contentType: row.content_type,
        originalUrl: row.original_url,
        ext: row.ext,
    };
}

// ========== General Cache CRUD ==========

export function dbSetGeneralCache(key: string, value: unknown): void {
    getStmts().upsertGeneralCache.run({ key, value: JSON.stringify(value) });
}

export function dbGetGeneralCache<T>(key: string): T | undefined {
    const row = getStmts().getGeneralCache.get(key) as
        | { value: string }
        | undefined;
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
    const d = getDb();
    const keywords = d
        .prepare(`SELECT keyword, query_time, total FROM keyword_searches`)
        .all() as Array<{ keyword: string; query_time: number; total: number }>;

    const getNovelsByKw = getStmts().getNovelsByKeyword;
    return keywords.map((kw) => {
        const novels = getNovelsByKw.all(kw.keyword) as Array<{
            path: string;
            name: string;
            cover: string | null;
        }>;
        return {
            keyword: kw.keyword,
            queryTime: kw.query_time,
            total: kw.total,
            novels: novels.map((n) => ({
                path: n.path,
                name: n.name,
                cover: n.cover || "",
            })),
        };
    });
}

export function dbGetAllChapterPaths(): Record<string, string> {
    const rows = getDb()
        .prepare(`SELECT name, path FROM chapter_paths`)
        .all() as Array<{ name: string; path: string }>;
    const result: Record<string, string> = {};
    for (const r of rows) result[r.name] = r.path;
    return result;
}

export function dbGetAllCoverMetadata(): Record<
    string,
    { contentType: string; originalUrl: string; ext: string }
> {
    const rows = getDb()
        .prepare(
            `SELECT hash, content_type, original_url, ext FROM cover_metadata`,
        )
        .all() as Array<{
        hash: string;
        content_type: string;
        original_url: string;
        ext: string;
    }>;
    const result: Record<
        string,
        { contentType: string; originalUrl: string; ext: string }
    > = {};
    for (const r of rows) {
        result[r.hash] = {
            contentType: r.content_type,
            originalUrl: r.original_url,
            ext: r.ext,
        };
    }
    return result;
}

export function dbGetAllGeneralCache(): Record<string, unknown> {
    const rows = getDb()
        .prepare(`SELECT key, value FROM general_cache`)
        .all() as Array<{ key: string; value: string }>;
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
    const d = getDb();
    const s = getStmts();

    const run = d.transaction(() => {
        // 1. Migrate novels + keyword mappings
        if (cacheData.keywordsToNovelsMap) {
            for (const [keyword, entry] of Object.entries(
                cacheData.keywordsToNovelsMap,
            )) {
                s.upsertKeywordSearch.run({
                    keyword,
                    queryTime: entry.queryTime,
                    total: entry.total,
                });
                for (const novel of entry.novels) {
                    const row = s.upsertNovel.get({
                        path: novel.path,
                        name: novel.name,
                        cover: novel.cover || null,
                    }) as { id: number } | undefined;
                    if (row) {
                        s.upsertKeywordNovel.run({ keyword, novelId: row.id });
                    }
                }
            }
        }

        // 2. Migrate chapter paths
        if (cacheData.chapterNameToPathCache) {
            for (const [name, path] of Object.entries(
                cacheData.chapterNameToPathCache,
            )) {
                s.upsertChapterPath.run({ name, path });
            }
        }

        // 3. Migrate cover metadata
        if (cacheData.coverMetadata) {
            for (const [hash, meta] of Object.entries(
                cacheData.coverMetadata,
            )) {
                s.upsertCoverMeta.run({
                    hash,
                    contentType: meta.contentType,
                    originalUrl: meta.originalUrl,
                    ext: meta.ext,
                });
            }
        }

        // 4. Migrate general cache entries (skip known structured keys)
        const skipKeys = new Set([
            "lastUpdate",
            "novels",
            "keywordsToNovelsMap",
            "chapterNameToPathCache",
            "coverMetadata",
        ]);
        for (const [key, value] of Object.entries(cacheData)) {
            if (!skipKeys.has(key)) {
                s.upsertGeneralCache.run({ key, value: JSON.stringify(value) });
            }
        }
    });

    run();
    console.log("[DB] Migration from cache.json completed.");
}
