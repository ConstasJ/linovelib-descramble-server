import { webcrack } from "webcrack";
import * as cheerio from "cheerio";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { writeFile } from "fs/promises";
import { type Element, type AnyNode } from "domhandler"; 
import { getCachedValue, setCachedValue } from "./cache";

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

function isCoefficientsNeedUpdate(version: string) {
    const cachedVersion = getCachedValue<string>("chapterLogVersion");
    return cachedVersion !== version;
}

async function extractCoefficients(scriptUrl: string) {
    const scriptContent = await (await fetch(scriptUrl)).text();
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
                })
        ).attr("src") || "";
    return chapterLogScriptUrl;
}

export async function getCoefficientsFromPage(html: string) {
    const scriptUrl = extractChapterLogScriptUrl(html);
    const version = scriptUrl.match(/chapterlog\.js\?(v.*)/)?.[1] || "";
    if (isCoefficientsNeedUpdate(version)) {
        const coefficients = await extractCoefficients(scriptUrl);
        setCachedValue("chapterLogVersion", version);
        setCachedValue("coefficients", coefficients);
        return coefficients;
    } else {
        const cachedCoefficients = getCachedValue<Coefficients>("coefficients");
        if (cachedCoefficients) {
            return cachedCoefficients;
        }
        throw new Error("Cached coefficients not found");
    }
}

export async function decrypt(html: string) {
    const $ = cheerio.load(html);
    const chapterId = extractChapterId(html);
    const coefficients = await getCoefficientsFromPage(html);
    const container = $("#acontent");
    if (!container.length) return "";

    container.find("p").each((_, el) => {
        const $el = $(el);
        const innerHtml = $el.html();
        if (innerHtml) {
            const cleanedHtml = innerHtml.replace(/^\s+|(?<=>)\s+/g, "");
            $el.html(cleanedHtml);
        }
    });

    const allChildren = container
        .contents()
        .toArray()
        .filter((node) => !(node.type === "tag" && node.tagName === "div"));

    const sortableEntries: { element: Element; originalPos: number }[] = [];

    allChildren.forEach((node, index) => {
        if (node.type === "tag" && node.tagName === "p") {
            const text = $(node).text().trim();
            if (text.length > 0) {
                sortableEntries.push({ element: node, originalPos: index });
            }
        }
    });

    const pCount = sortableEntries.length;
    if (pCount <= 20) {
        return container.html() || "";
    }

    const seed = parseInt(chapterId, 10) * coefficients.seedMultiplier + coefficients.seedOffset;

    const dynamicIndices = Array.from(
        { length: pCount - 20 },
        (_, i) => i + 20
    );
    const shuffledIndices = shuffle(dynamicIndices, seed, coefficients);

    const fullMapping = Array.from({ length: 20 }, (_, i) => i).concat(
        shuffledIndices
    );

    const restoredChildren: (AnyNode | null)[] = [...allChildren];

    sortableEntries.forEach((entry, i) => {
        const targetLogicalPos = fullMapping[i] ?? 0;
        const actualSlot = sortableEntries[targetLogicalPos]?.originalPos ?? 0;
        restoredChildren[actualSlot] = entry.element;
    });

    const newContainer = $("<div></div>");
    restoredChildren.forEach((node) => {
        if (node && node.type === "tag") {
            newContainer.append($(node));
            newContainer.append("\n");
        }
    });

    return newContainer.html() || "";
}

function shuffle(array: number[], seed: number, coefficients: Coefficients): number[] {
    let currentSeed = seed;
    const result = [...array];
    const len = result.length;

    for (let i = len - 1; i > 0; i--) {
        currentSeed = (currentSeed * coefficients.lcgMultiplier + coefficients.lcgIncrement) % coefficients.lcgModulus;
        const j = Math.floor((currentSeed / 233280) * (i + 1));

        // 交换
        const temp = result[i] ?? 0;
        result[i] = result[j] ?? 0;
        result[j] = temp;
    }
    return result;
}

function extractChapterId(html: string): string {
    const match = html.match(/chapterid\s*:\s*'(\d+)'/);
    if (match && match[1]) {
        return match[1];
    }
    return "";
}
