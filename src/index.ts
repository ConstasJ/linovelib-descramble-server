import express from "express";
import morgan from "morgan";
import { decrypt, getCoefficientsFromPage } from "./decryptor";
import { getCachedValue, setCachedValue, loadCache, persistCache } from "./cache";
import { existsSync } from "node:fs";

async function main() {
    if (existsSync("cache.json")) {
        await loadCache();
    }

    const app = express();
    app.use(express.json());
    app.use(morgan("dev"));

    const router = express.Router();

    router.post("/page", async (req, res) => {
        const { path } = req.body;
        if (!path) {
            return res.status(400).json({ error: "Missing 'path' in request body" });
        }
        try {
            const requestInit: RequestInit = {
                method: "GET",
                headers: {
                    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
                    "Accept": "*/*",
                    "Accept-Language": "*",
                    "Referer": `https://www.bilinovel.com${path}`,
                    "Cookie": "night=0",
                }
            }
            const response = await fetch(`https://www.bilinovel.com${path}`, requestInit);
            const html = await response.text();
            const decryptedContent = await decrypt(html);
            res.json({ content: decryptedContent });
        } catch (error) {
            console.error("Decryption error:", error);
            res.status(500).json({ error: "Decryption failed" });
        }
    });

    router.get("/coefficients", async (_, res) => {
        const url = "https://www.bilinovel.com/novel/2186/78033_4.html";
        try {
            const timestamp = getCachedValue<number>("pageCacheTimestamp");
            let html = "";
            const htmlCache = getCachedValue<string>("pageCacheHtml");
            if (timestamp && (Date.now() - timestamp < 6 * 60 * 60 * 1000) && htmlCache) {
                html = htmlCache;
            } else {
                const requestInit: RequestInit = {
                    method: "GET",
                    headers: {
                    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
                        "Accept": "*/*",
                        "Accept-Language": "*",
                        "Referer": url,
                        "Cookie": "night=0",
                    }
                };
                const response = await fetch(url, requestInit);
                html = await response.text();
                setCachedValue("pageCacheTimestamp", Date.now());
                setCachedValue("pageCacheHtml", html);
            }
            const coefficients = await getCoefficientsFromPage(html);
            res.json({ coefficients });
        } catch(error) {
            console.error("Error fetching coefficients:", error);
            res.status(500).json({ error: "Failed to fetch coefficients" });
        }
    })

    app.use("/", router);

    app.listen(process.env.PORT || 5301, (err?: any) => {
        if (err) {
            console.error("Server failed to start:", err);
        }
        else {
            console.log(`Server is running on http://localhost:${process.env.PORT || 5301}`);
        }
    })

    async function onExit() {
        console.log("Shutting down server...");
        await persistCache();
        process.exit();
    }

    process.on("SIGINT", onExit);
}

main();
