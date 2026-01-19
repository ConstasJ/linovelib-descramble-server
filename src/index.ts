import express from "express";
import morgan from "morgan";
import { getCoefficientsFromPage } from "./coefficient";
import { decrypt } from "./decrypt";
import { fetchHtml } from "./utils";
import { CheerioAPI, load } from "cheerio";
import { type AnyNode, type Element } from "domhandler";

async function main() {
    const app = express();
    app.use(express.json());
    app.use(morgan("dev"));

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

    apiRouter.post("/chapter-page", async (req, res) => {
        const { path } = req.body;
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

    apiRouter.post("/chapter", async (req, res) => {
        const { path } = req.body;
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
            let nextPageId = $("div.mlfy_page a:last")
                .attr("href")
                ?.match(/\/novel\/(\d+)\/([\d_]+)\.html/)?.[2] || "";
            let content = await decrypt(firstPageHtml);
            while (nextPageId?.includes(chapterId)) {
                const nextPageHtml = await fetchHtml(
                    `https://www.linovelib.com/novel/${novelId}/${nextPageId}.html`,
                );
                content += await decrypt(nextPageHtml);
                $ = load(nextPageHtml);
                nextPageId = $("div.mlfy_page a:last")
                    .attr("href")
                    ?.match(/\/novel\/(\d+)\/([\d_]+)\.html/)?.[2] || "";
            }
            res.json({ content });
        } catch (e) {
            console.error("Error fetching chapter:", e);
            res.status(500).json({ error: "Failed to fetch chapter" });
        }
    });

    app.use("/api", apiRouter);

    app.listen(process.env.PORT || 5301, (err?: any) => {
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

    async function onExit() {
        console.log("Shutting down server...");
        process.exit();
    }

    process.on("SIGINT", onExit);
    process.on("SIGTERM", onExit);
    process.on("SIGUSR1", onExit);
    process.on("SIGUSR2", onExit);
}

main();
