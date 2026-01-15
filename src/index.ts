import * as cheerio from "cheerio";
import { readFile, writeFile } from "fs/promises";
import { type Element, type AnyNode } from "domhandler";

export class LinovelibDecrpytor {
    public static decrypt(html: string, chapterId: string): string {
        const $ = cheerio.load(html);
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

        const seed = parseInt(chapterId, 10) * 127 + 235;

        const dynamicIndices = Array.from(
            { length: pCount - 20 },
            (_, i) => i + 20
        );
        const shuffledIndices = this.shuffle(dynamicIndices, seed);

        const fullMapping = Array.from({ length: 20 }, (_, i) => i).concat(
            shuffledIndices
        );

        const restoredChildren: (AnyNode | null)[] = [...allChildren];

        sortableEntries.forEach((entry, i) => {
            const targetLogicalPos = fullMapping[i] ?? 0;
            const actualSlot =
                sortableEntries[targetLogicalPos]?.originalPos ?? 0;
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

    private static shuffle(array: number[], seed: number): number[] {
        let currentSeed = seed;
        const result = [...array];
        const len = result.length;

        for (let i = len - 1; i > 0; i--) {
            currentSeed = (currentSeed * 9302 + 49397) % 233280;
            const j = Math.floor((currentSeed / 233280) * (i + 1));

            // 交换
            const temp = result[i] ?? 0;
            result[i] = result[j] ?? 0;
            result[j] = temp;
        }
        return result;
    }

    public static extractChapterId(html: string): string {
        const match = html.match(/chapterid\s*:\s*'(\d+)'/);
        if (match && match[1]) {
            return match[1];
        }
        return "";
    }
}

async function main() {
    const inputPath = "input.html";
    const outputPath = "output.html";
    const html = await readFile(inputPath, "utf-8");
    const chapterId = LinovelibDecrpytor.extractChapterId(html);
    const restoredContent = LinovelibDecrpytor.decrypt(html, chapterId);
    await writeFile(outputPath, restoredContent, "utf-8");
    console.log(`Restored content written to ${outputPath}`);
}

main();
