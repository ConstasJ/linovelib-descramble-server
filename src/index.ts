import express from "express";
import morgan from "morgan";
import nocache from "nocache";
import { getCoefficientsFromPage } from "./extractor";

async function main() {
    const app = express();
    app.use(express.json());
    app.use(morgan("dev"));
    app.use(nocache());

    const router = express.Router();

    router.get("/coefficients", async (_, res) => {
        const url = "https://www.bilinovel.com/novel/2186/78033_4.html";
        try {
            const requestInit: RequestInit = {
                method: "GET",
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
                    Accept: "*/*",
                    "Accept-Language": "*",
                    Referer: url,
                    Cookie: "night=0",
                },
            };
            const response = await fetch(url, requestInit);
            const html = await response.text();
            const coefficients = await getCoefficientsFromPage(html);
            res.json({ coefficients });
        } catch (error) {
            console.error("Error fetching coefficients:", error);
            res.status(500).json({ error: "Failed to fetch coefficients" });
        }
    });

    app.use("/", router);

    app.listen(process.env.PORT || 5301, (err?: any) => {
        if (err) {
            console.error("Server failed to start:", err);
        } else {
            console.log(
                `Server is running on http://localhost:${
                    process.env.PORT || 5301
                }`
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
