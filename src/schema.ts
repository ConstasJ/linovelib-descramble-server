import { sql } from "drizzle-orm";
import {
    integer,
    primaryKey,
    sqliteTable,
    text,
} from "drizzle-orm/sqlite-core";

export const novels = sqliteTable("novels", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    path: text("path").notNull().unique(),
    name: text("name").notNull(),
    cover: text("cover"),
    createdAt: integer("created_at")
        .notNull()
        .default(sql`unixepoch('now','subsec') * 1000`),
});

export const keywordSearches = sqliteTable("keyword_searches", {
    keyword: text("keyword").primaryKey(),
    queryTime: integer("query_time").notNull(),
    total: integer("total").notNull(),
});

export const keywordNovels = sqliteTable(
    "keyword_novels",
    {
        keyword: text("keyword")
            .notNull()
            .references(() => keywordSearches.keyword, { onDelete: "cascade" }),
        novelId: integer("novel_id")
            .notNull()
            .references(() => novels.id, { onDelete: "cascade" }),
    },
    (table) => [primaryKey({ columns: [table.keyword, table.novelId] })],
);

export const chapterPaths = sqliteTable("chapter_paths", {
    name: text("name").primaryKey(),
    path: text("path").notNull(),
});

export const coverMetadata = sqliteTable("cover_metadata", {
    hash: text("hash").primaryKey(),
    contentType: text("content_type").notNull(),
    originalUrl: text("original_url").notNull(),
    ext: text("ext").notNull(),
});

export const generalCache = sqliteTable("general_cache", {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
});
