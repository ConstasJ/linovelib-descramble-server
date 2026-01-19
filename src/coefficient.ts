import { webcrack } from "webcrack";
import * as cheerio from "cheerio";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { writeFile } from "fs/promises";
import { fetchChapterLogJs, fetchHtml } from "./utils";
import { getCache, setCache } from "./cache";

export interface Coefficients {
    seedMultiplier: number;
    seedOffset: number;
    lcgMultiplier: number;
    lcgIncrement: number;
    lcgModulus: number;
}

function getObfuscatedPart(fullCode: string): string {
    const match = fullCode.match(/function\s+_0x/);
    if (!match || match.index == null)
        throw new Error("Obfuscated part not found");
    return fullCode.slice(match.index);
}

async function extractCoefficients(scriptUrl: string) {
    const scriptContent = await fetchChapterLogJs(scriptUrl);
    const obfCode = getObfuscatedPart(scriptContent);
    const deobfCode = (
        await webcrack(obfCode, {
            mangle: true,
        })
    ).code;
    await writeFile("deobfuscated.js", deobfCode, "utf-8");
    const ast = parse(deobfCode, { sourceType: "module", plugins: ["jsx"] });
    const coefficients: Partial<Coefficients> = {};
    traverse(ast, {
        BinaryExpression(path) {
            const { node } = path;
            if (
                node.operator === "%" &&
                t.isNumericLiteral(node.right) &&
                t.isBinaryExpression(node.left) &&
                node.left.operator === "+" &&
                t.isNumericLiteral(node.left.right) &&
                t.isBinaryExpression(node.left.left) &&
                node.left.left.operator === "*" &&
                t.isNumericLiteral(node.left.left.right)
            ) {
                coefficients.lcgModulus = (
                    node.right as t.NumericLiteral
                ).value;

                const leftSide = node.left;
                if (
                    t.isBinaryExpression(leftSide) &&
                    leftSide.operator === "+"
                ) {
                    if (t.isNumericLiteral(leftSide.right)) {
                        coefficients.lcgIncrement = leftSide.right.value;
                    }
                    if (
                        t.isBinaryExpression(leftSide.left) &&
                        leftSide.left.operator === "*"
                    ) {
                        if (t.isNumericLiteral(leftSide.left.right)) {
                            coefficients.lcgMultiplier =
                                leftSide.left.right.value;
                        }
                    }
                }
            }
            if (
                node.operator === "+" &&
                t.isNumericLiteral(node.right) &&
                t.isBinaryExpression(node.left) &&
                node.left.operator === "*" &&
                t.isNumericLiteral(node.left.right)
            ) {
                const potentialOffset = node.right.value;
                const potentialMultiplier = node.left.right.value;
                const numberTransformed = node.left.left;
                if (
                    t.isCallExpression(numberTransformed) &&
                    t.isIdentifier(numberTransformed.callee) &&
                    (numberTransformed.callee.name === "Number" ||
                        numberTransformed.callee.name === "parseInt")
                ) {
                    coefficients.seedMultiplier = potentialMultiplier;
                    coefficients.seedOffset = potentialOffset;
                }
            }
        },
    });
    if (
        coefficients.seedMultiplier &&
        coefficients.seedOffset &&
        coefficients.lcgMultiplier
    ) {
        return coefficients as Coefficients;
    }
    throw new Error("Failed to extract coefficients");
}

function extractChapterLogScriptUrl(html: string): string {
    const $ = cheerio.load(html);
    const chapterLogScriptUrl =
        $(
            $("script")
                .toArray()
                .find((el) => {
                    const scriptContent = $(el).attr("src") || "";
                    return /chapterlog\.js/.test(scriptContent);
                }),
        ).attr("src") || "";
    return chapterLogScriptUrl;
}

export async function getCoefficientsFromPage(html: string) {
    const scriptUrl = extractChapterLogScriptUrl(html);
    const version = scriptUrl.match(/chapterlog\.js\?(v.*)/)?.[1] || "";
    const cachedVersion = getCache<string>("chapterlog_js_version");
    if (version && cachedVersion === version) {
        const cachedCoefficients = getCache<Coefficients>("coefficients");
        if (cachedCoefficients) {
            return cachedCoefficients;
        }
    }
    const coefficients = await extractCoefficients(
        scriptUrl.startsWith("http")
            ? scriptUrl
            : `https://www.linovelib.com${scriptUrl}`,
    );
    setCache("coefficients", coefficients);
    setCache("chapterlog_js_version", version);
    return coefficients;
}
