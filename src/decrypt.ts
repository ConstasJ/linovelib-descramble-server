import { CheerioAPI, load } from "cheerio";
import { getCoefficientsFromPage } from "./coefficient";
import { type AnyNode, type Element } from "domhandler";

function extractChapterId($: CheerioAPI): string {
    const scriptTags = $("script");
    let chapterId = "";
    scriptTags.each((_, el) => {
        const scriptContent = $(el).html();
        if (scriptContent) {
            const match = scriptContent.match(/chapterid\s*:\s*'(\d+)'/);
            if (match && match[1]) {
                chapterId = match[1];
                return false; // Break the loop
            }
        }
    });
    return chapterId;
}

function shuffle(array: number[], seed: number): number[] {
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

export async function decrypt(html: string): Promise<string> {
    const $ = load(html);
    const coefficients = await getCoefficientsFromPage(html);
    const chapterId = extractChapterId($);
    const container = $("#TextContent");
    if (!container.length) {
        return "";
    }

    container.find("p").each((_, el) => {
        const $el = $(el);
        const innerHtml = $el.html();
        if (innerHtml) {
            const cleanedHtml = innerHtml.replace(/^\s+|(?<=>)\s+/g, "");
            $el.html(cleanedHtml);
        }
    });

    container.find("img.imagecontent").each((_, el) => {
        const imgSrc = $(el).attr("data-src") || $(el).attr("src");
        if (imgSrc) {
            $(el)
                .attr("src", imgSrc)
                .removeAttr("data-src")
                .removeClass("lazyload");
        }
    });

    container.find("div.dag").remove();
    container.find("script").remove();

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

    const seed =
        parseInt(chapterId, 10) * coefficients.seedMultiplier +
        coefficients.seedOffset;

    const dynamicIndices = Array.from(
        { length: pCount - 20 },
        (_, i) => i + 20,
    );
    const shuffledIndices = shuffle(dynamicIndices, seed);

    const fullMapping = Array.from({ length: 20 }, (_, i) => i).concat(
        shuffledIndices,
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
