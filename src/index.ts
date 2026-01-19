import express from "express";
import morgan from "morgan";
import { getCoefficientsFromPage } from "./coefficient";
import { decrypt } from "./decrypt";
import {
    fetchHtml,
    getPuppeteerBrowser,
    transformChapterName,
    transformContent,
} from "./utils";
import { load } from "cheerio";
import {
    addToNovelsCache,
    loadCache,
    saveCache,
    searchNovelsInCache,
} from "./cache";
import { promisify } from "node:util";

async function main() {
    await loadCache();
    const app = express();
    app.use(express.json());
    app.use(morgan(process.env.NODE_ENV === "development" ? "dev" : "combined"));

    const apiRouter = express.Router();

    apiRouter.get("/coefficients", async (_, res) => {
        const url = "https://www.linovelib.com/novel/2186/78033_4.html";
        try {
            const html = await fetchHtml(url);
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
            const html = await fetchHtml(url);
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
            const firstPageHtml = await fetchHtml(
                `https://www.linovelib.com${path}`,
            );
            const novelId = path.split("/")[2];
            const chapterId = firstPageHtml.match(/cid="(\d+)"/)?.[1] || "";
            let $ = load(firstPageHtml);
            const chapterName = $("h1").text().trim();
            let nextPageId =
                $("div.mlfy_page a:last")
                    .attr("href")
                    ?.match(/\/novel\/(\d+)\/([\d_]+)\.html/)?.[2] || "";
            let content = await decrypt(firstPageHtml);
            while (nextPageId?.includes(chapterId)) {
                const nextPageHtml = await fetchHtml(
                    `https://www.linovelib.com/novel/${novelId}/${nextPageId}.html`,
                );
                content += await decrypt(nextPageHtml);
                $ = load(nextPageHtml);
                nextPageId =
                    $("div.mlfy_page a:last")
                        .attr("href")
                        ?.match(/\/novel\/(\d+)\/([\d_]+)\.html/)?.[2] || "";
            }
            res.json({
                content:
                    "<h2>" +
                    chapterName +
                    "</h2>\n" +
                    transformContent(content),
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
            const html = await fetchHtml(url);
            const $ = load(html);
            const name = $("h1.book-name").text().trim();
            const cover = $("div.book-img img").attr("src") || "";
            const summary = (() => {
                const $container = $('.book-dec.Jbook-dec').clone();
                $container.find('.notice').remove();
                const paragraphs: string[] = [];
                $container.find('p').each((_, el) => {
                    paragraphs.push($(el).text().trim());
                });
                return paragraphs.join('\n');
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
            let catalogHtml = await fetchHtml(catalogUrl);
            const catalogCheerio = load(catalogHtml);
            const chapters: {
                name: string;
                path: string;
                releaseTime: string | null;
            }[] = [];
            const volumes = catalogCheerio("#volume-list div.volume").toArray();
            let lastChapNotIdentified = false;
            let lastChapterName = "";
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
                    const chapterPath = chapterEl.attr("href") || "";

                    if (chapterPath.includes("javascript:cid(0)")) {
                        lastChapNotIdentified = true;
                        lastChapterName = chapterName;
                        continue;
                    }

                    if (lastChapNotIdentified) {
                        const html = await fetchHtml(
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
            const homeUrl = `https://www.linovelib.com`;
            const browser = await getPuppeteerBrowser();
            const page =
                (await browser.pages())[0] || (await browser.newPage());
            await page.goto(homeUrl, { waitUntil: "networkidle2" });
            await page.type("input[name='searchkey']", keyword);
            await new Promise((r) => setTimeout(r, 700));
            await page.keyboard.press("Enter");
            await new Promise((r) => setTimeout(r, 1000));
            await page.waitForSelector("div.head-fixed");
            const searchResultsFPHtml = await page.content();
            const $1 = load(searchResultsFPHtml);
            if ($1("div.book-html-box").length > 0) {
                const results: { name: string; path: string; cover: string }[] =
                    [
                        {
                            name: $1("h1.book-name").text().trim(),
                            path: page.url().replace(homeUrl, ""),
                            cover: $1("div.book-img img").attr("src") || "",
                        },
                    ];
                addToNovelsCache(keyword, results);
                return res.json({ results });
            }
            const pages =
                $1("em#pagestats")
                    .text()
                    .match(/1\/(\d+)/)?.[1] || "1";
            const results: { name: string; path: string; cover: string }[] = [];
            $1("div.search-html-box div.search-result-list").each((_, el) => {
                const el$ = $1(el);
                const name = el$.find("h2").text().trim();
                const path = el$.find("h2 a").attr("href") || "";
                const cover = el$.find("img").attr("src") || "";
                results.push({ name, path, cover });
            });
            if (Number(pages) > 1) {
                let currentPageHtml = searchResultsFPHtml;
                while (true) {
                    const $2 = load(currentPageHtml);
                    if ($2("a.next").length > 0) {
                        await Promise.all([
                            page.click("a.next"),
                            page.waitForNavigation({
                                waitUntil: "networkidle2",
                            }),
                        ]);
                    }
                    currentPageHtml = await page.content();
                    const $3 = load(currentPageHtml);
                    $2("div.search-html-box div.search-result-list").each(
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
                `Server is running on http://localhost:${
                    process.env.PORT || 5301
                }`,
            );
        }
    });

    let isShuttingDown = false;
    async function onExit(signal: string) {
        if (isShuttingDown) {
            console.log(
                `Received ${signal}, but shutdown is already in progress ...`,
            );
            return;
        }
        isShuttingDown = true;

        console.log(`Received ${signal}, shutting down gracefully ...`);
        const forceExitTimeout = setTimeout(() => {
            console.error("Shutting down timeout, forcing exit.");
            process.exit(1);
        }, 15000);
        forceExitTimeout.unref();
        try {
            await promisify(server.close.bind(server))();
            await saveCache();
            console.log("Cleanup completed successfully.");
            process.exit(0);
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
