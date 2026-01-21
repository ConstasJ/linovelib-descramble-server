import express from "express";
import morgan from "morgan";
import { getCoefficientsFromPage } from "./coefficient";
import { decrypt } from "./decrypt";
import {
    fetchText,
    FetchType,
    fetchWithAppliance,
    solveSearchChallenge,
    transformChapterName,
    transformContent,
} from "./utils";
import { load } from "cheerio";
import {
    addToNovelsCache,
    getCache,
    getNovelContentFromCache,
    loadCache,
    saveCache,
    searchNovelsInCache,
    setCache,
    setNovelContentToCache,
} from "./cache";
import { novelChapterQueue, searchQueue } from "./queue";

async function main() {
    await loadCache();
    const app = express();

    app.set("trust proxy", true);
    app.use(express.json());
    app.use(
        morgan(process.env.NODE_ENV === "development" ? "dev" : "combined"),
    );

    const apiRouter = express.Router();

    apiRouter.get("/coefficients", async (_, res) => {
        const url = "https://www.linovelib.com/novel/2186/78033_4.html";
        try {
            const html = await fetchText(url);
            const coefficients = await getCoefficientsFromPage(html);
            res.json({ coefficients });
        } catch (error) {
            console.error("Error fetching coefficients:", error);
            res.status(500).json({ error: "Failed to fetch coefficients" });
        }
    });

    apiRouter.get("/chapter-page", async (req, res) => {
        const path = (req.query.path as string) || "";
        if (!path) {
            return res.status(400).json({ error: "Path is required" });
        }
        try {
            const url = `https://www.linovelib.com${path}`;
            const html = await fetchText(url);
            const decryptedContent = await decrypt(html);
            res.json({ content: decryptedContent });
        } catch (e) {
            console.error("Error fetching chapter:", e);
            res.status(500).json({ error: "Failed to fetch chapter" });
        }
    });

    apiRouter.get("/chapter", async (req, res) => {
        const path = (req.query.path as string) || "";
        if (!path) {
            return res.status(400).json({ error: "Path is required" });
        }
        try {
            const matches = path.match(/\/novel\/(\d+)\/([\d_]+)\.html/);
            if (!matches) {
                return res.status(400).json({ error: "Invalid chapter path" });
            }
            const novelId = matches[1] || "0";
            const chapterId = matches[2] || "0";
            const cache = getNovelContentFromCache(
                parseInt(novelId),
                parseInt(chapterId),
            )
            if (cache) {
                return res.json({ content: cache });
            }
            const firstPageHtml = await novelChapterQueue.fetchChapterPartContent(
                `https://www.linovelib.com${path}`,
            );
            let $ = load(firstPageHtml);
            const chapterName = $("h1").text().trim();
            let nextPageId =
                $("div.mlfy_page a:last")
                    .attr("href")
                    ?.match(/\/novel\/(\d+)\/([\d_]+)\.html/)?.[2] || "";
            let content = await decrypt(firstPageHtml);
            while (nextPageId?.includes(chapterId)) {
                const nextPageHtml = await novelChapterQueue.fetchChapterPartContent(
                    `https://www.linovelib.com/novel/${novelId}/${nextPageId}.html`,
                );
                content += await decrypt(nextPageHtml);
                $ = load(nextPageHtml);
                nextPageId =
                    $("div.mlfy_page a:last")
                        .attr("href")
                        ?.match(/\/novel\/(\d+)\/([\d_]+)\.html/)?.[2] || "";
            }
            content = `<h2>${chapterName}</h2>\n` + transformContent(content);
            setNovelContentToCache(
                parseInt(novelId),
                parseInt(chapterId) || 0,
                content,
            );
            res.json({
                content
            });
        } catch (e) {
            console.error("Error fetching chapter:", e);
            res.status(500).json({ error: "Failed to fetch chapter" });
        }
    });

    apiRouter.get("/novel", async (req, res) => {
        const path = (req.query.path as string) || "";
        if (!path) {
            return res.status(400).json({ error: "Path is required" });
        }
        try {
            const url = `https://www.linovelib.com${path}`;
            const html = await fetchText(url);
            const $ = load(html);
            const name = $("h1.book-name").text().trim();
            const cover = $("div.book-img img").attr("src") || "";
            const summary = (() => {
                const $container = $(".book-dec.Jbook-dec").clone();
                $container.find(".notice").remove();
                const paragraphs: string[] = [];
                $container.find("p").not(".backupname").each((_, el) => {
                    paragraphs.push($(el).text().trim());
                });
                return paragraphs.join("\n");
            })();
            const author = $("div.au-name a:first").text().trim();
            const status = $("div.book-label a.state").text().includes("完结")
                ? "Completed"
                : "Ongoing";
            const genres = $("div.book-label span")
                .children("a")
                .map((_, el) => $(el).text())
                .toArray()
                .join(",");
            const catalogUrl = `https://www.linovelib.com${$("a.read-btn").attr("href")}`;
            let catalogHtml = await fetchText(catalogUrl);
            const catalogCheerio = load(catalogHtml);
            const chapters: {
                name: string;
                path: string;
                releaseTime: string | null;
            }[] = [];
            const volumes = catalogCheerio("#volume-list div.volume").toArray();
            const novelId = path.match(/\/novel\/(\d+).html/)?.[1] || "";
            let lastChapNotIdentified = false;
            let lastChapterName = "";
            let chapterId = 0;
            for (const vol of volumes) {
                const volumeEl = catalogCheerio(vol);
                const volumeName = volumeEl
                    .find("h2")
                    .text()
                    .replace(name, "")
                    .trim();
                const chapterEls = volumeEl
                    .find("ul.chapter-list li a")
                    .toArray();
                for (const chapEl of chapterEls) {
                    const chapterEl = catalogCheerio(chapEl);
                    const chapterName = transformChapterName(
                        chapterEl.text().trim(),
                    );
                    const idPattern = /(\d+)\.html/;
                    const extractedChapterId = chapterEl
                        .attr("href")
                        ?.match(idPattern)?.[1];
                    chapterId = extractedChapterId
                        ? parseInt(extractedChapterId)
                        : chapterId + 1;
                    let chapterPath = chapterEl.attr("href") || "";

                    if (chapterPath.includes("javascript:cid(0)")) {
                        if (chapterName.includes("插图")) {
                            lastChapNotIdentified = true;
                            lastChapterName = chapterName;
                            continue;
                        } else {
                            chapterPath = `/novel/${novelId}/${chapterId}.html`;
                        }
                    }

                    if (lastChapNotIdentified) {
                        await new Promise((r) => setTimeout(r, 200));
                        const html = await novelChapterQueue.fetchChapterPartContent(
                            `https://www.linovelib.com${chapterPath}`,
                        );
                        const $temp = load(html);
                        const lastChapterPath = $temp(
                            "div.mlfy_page a:first",
                        ).attr("href");
                        chapters.push({
                            name: `${volumeName} - ${lastChapterName}`,
                            path: lastChapterPath || "",
                            releaseTime: null,
                        });
                        lastChapNotIdentified = false;
                    }

                    chapters.push({
                        name: `${volumeName} - ${chapterName}`,
                        path: chapterPath,
                        releaseTime: null,
                    });
                }
            }
            res.json({
                name,
                path,
                cover,
                summary,
                author,
                status,
                genres,
                chapters,
            });
        } catch (e) {
            console.error("Error fetching novel info:", e);
            res.status(500).json({ error: "Failed to fetch novel info" });
        }
    });

    apiRouter.get("/search", async (req, res) => {
        const keyword = (req.query.keyword as string) || "";
        if (!keyword) {
            return res.status(400).json({ error: "Keyword is required" });
        }
        const cacheResults = searchNovelsInCache(keyword);
        if (cacheResults.length > 0) {
            return res.json({ results: cacheResults });
        }
        try {
            const fp = await searchQueue.performFirstSearch(keyword);
            const $ = load(fp);
            if ($("div.book-html-box").length > 0) {
                const results: { name: string; path: string; cover: string }[] =
                    [
                        {
                            name: $("h1.book-name").text().trim(),
                            path: $("meta[name=url]").attr("content")?.replace("https://www.linovelib.com", "") || "",
                            cover: $("div.book-img img").attr("src") || "",
                        },
                    ];
                addToNovelsCache(keyword, results);
                return res.json({ results });
            }
            const pages =
                $("em#pagestats")
                    .text()
                    .match(/1\/(\d+)/)?.[1] || "1";
            const results: { name: string; path: string; cover: string }[] = [];
            $("div.search-html-box div.search-result-list").each((_, el) => {
                const el$ = $(el);
                const name = el$.find("h2").text().trim();
                const path = el$.find("h2 a").attr("href") || "";
                const cover = el$.find("img").attr("src") || "";
                results.push({ name, path, cover });
            });
            if (Number(pages) > 1) {
                let currentPageHtml = fp;
                while (true) {
                    const $2 = load(currentPageHtml);
                    if ($("a.next").length > 0) {
                        currentPageHtml = await fetchWithAppliance(
                            `https://www.linovelib.com${$2("a.next").attr("href")}`,
                        )
                    }
                    const $3 = load(currentPageHtml);
                    $3("div.search-html-box div.search-result-list").each(
                        (_, el) => {
                            const el$ = $3(el);
                            const name = el$.find("h2").text().trim();
                            const path = el$.find("h2 a").attr("href") || "";
                            const cover = el$.find("img").attr("src") || "";
                            results.push({ name, path, cover });
                        },
                    );
                    if ($3("a.next").length === 0) break;
                }
            }
            if (results.length === 0) {
                throw new Error("Parser Error!");
            }
            addToNovelsCache(keyword, results);
            res.json({ results });
        } catch (e) {
            console.error("Error performing search:", e);
            res.status(500).json({ error: "Failed to perform search" });
        }
    });

    app.use("/api", apiRouter);

    const server = app.listen(process.env.PORT || 5301, (err?: any) => {
        if (err) {
            console.error("Server failed to start:", err);
        } else {
            console.log(
                `Server is running on http://localhost:${process.env.PORT || 5301}`,
            );
        }
    });

    let isShuttingDown = false;
    function onExit(signal: string) {
        if (isShuttingDown) return;
        isShuttingDown = true;
        console.log(`Received ${signal}, shutting down gracefully ...`);
        if (process.env.NODE_ENV !== "development") {
            const forceExitTimeout = setTimeout(() => {
                console.error("Shutting down timeout, forcing exit.");
                process.exit(1);
            }, 15000);
            forceExitTimeout.unref();
        }
        try {
            console.log("Saving cache...");
            saveCache();
            console.log("Closing server...");
            if (server && server.listening) {
                server.close();
            }
        } catch (e) {
            console.error("Error during cleanup:", e);
            process.exit(1);
        }
    }

    ["SIGINT", "SIGTERM"].forEach((signal) => {
        process.on(signal, () => onExit(signal));
    });

    process.on("unhandledRejection", (reason, promise) => {
        console.error("Unhandled Rejection at:", promise, "reason:", reason);
        onExit("unhandledRejection");
    });
    process.on("uncaughtException", (error) => {
        console.error("Uncaught Exception:", error);
        onExit("uncaughtException");
    });
}

main();
