import { webcrypto } from "node:crypto";
import { load } from "cheerio";
import pRetry from "p-retry";

class AccessDeniedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AccessDeniedError";
    }
}

export function fetchText(
    url: string,
    cookies?: Record<string, string>,
): Promise<string> {
    return pRetry(
        async () => {
            const res = await fetchWithAppliance(
                url,
                FetchType.GET,
                undefined,
                cookies,
            );

            const snippet = res.slice(0, 1024).toLowerCase();

            const isBlocked =
                /(limit|attention|protect|restrict|just a moment)/.test(
                    snippet,
                );
            if (isBlocked) {
                // 可以在这里增加一个 log，记录到底是哪个词触发了拦截
                throw new AccessDeniedError(
                    `Access limited detected for ${url}`,
                );
            }

            return res;
        },
        {
            shouldRetry: ({ error }) => error instanceof AccessDeniedError,
            onFailedAttempt: ({ attemptNumber }) => {
                // 指数级减少日志噪音
                console.warn(
                    `[fetchText] Attempt ${attemptNumber} failed. Retrying...`,
                );
            },
            minTimeout: 5000,
            maxTimeout: 15000,
            retries: 10,
            randomize: true,
        },
    );
}

export function transformChapterName(name: string): string {
    const chapNameTransDict: Record<string, string> = {
        "\u004e": "\u5973",
    };
    return name.replace(/./g, (char) => chapNameTransDict[char] || char);
}

export function transformContent(content: string): string {
    const contentTransDict: Record<string, string> = {
        "\u201c": "\u300c",
        "\u201d": "\u300d",
        "\u2018": "\u300e",
        "\u2019": "\u300f",
        "\ue82c": "\u7684",
        "\ue852": "\u4e00",
        "\ue82d": "\u662f",
        "\ue819": "\u4e86",
        "\ue856": "\u6211",
        "\ue857": "\u4e0d",
        "\ue816": "\u4eba",
        "\ue83c": "\u5728",
        "\ue830": "\u4ed6",
        "\ue82e": "\u6709",
        "\ue836": "\u8fd9",
        "\ue859": "\u4e2a",
        "\ue80a": "\u4e0a",
        "\ue855": "\u4eec",
        "\ue842": "\u6765",
        "\ue858": "\u5230",
        "\ue80b": "\u65f6",
        "\ue81f": "\u5927",
        "\ue84a": "\u5730",
        "\ue853": "\u4e3a",
        "\ue81e": "\u5b50",
        "\ue822": "\u4e2d",
        "\ue813": "\u4f60",
        "\ue85b": "\u8bf4",
        "\ue807": "\u751f",
        "\ue818": "\u56fd",
        "\ue810": "\u5e74",
        "\ue812": "\u7740",
        "\ue851": "\u5c31",
        "\ue801": "\u90a3",
        "\ue80c": "\u548c",
        "\ue815": "\u8981",
        "\ue84c": "\u5979",
        "\ue840": "\u51fa",
        "\ue848": "\u4e5f",
        "\ue835": "\u5f97",
        "\ue800": "\u91cc",
        "\ue826": "\u540e",
        "\ue863": "\u81ea",
        "\ue861": "\u4ee5",
        "\ue854": "\u4f1a",
        "\ue827": "\u5bb6",
        "\ue83b": "\u53ef",
        "\ue85d": "\u4e0b",
        "\ue84d": "\u800c",
        "\ue862": "\u8fc7",
        "\ue81c": "\u5929",
        "\ue81d": "\u53bb",
        "\ue860": "\u80fd",
        "\ue843": "\u5bf9",
        "\ue82f": "\u5c0f",
        "\ue802": "\u591a",
        "\ue831": "\u7136",
        "\ue84b": "\u4e8e",
        "\ue837": "\u5fc3",
        "\ue829": "\u5b66",
        "\ue85e": "\u4e48",
        "\ue83a": "\u4e4b",
        "\ue832": "\u90fd",
        "\ue808": "\u597d",
        "\ue841": "\u770b",
        "\ue821": "\u8d77",
        "\ue845": "\u53d1",
        "\ue803": "\u5f53",
        "\ue828": "\u6ca1",
        "\ue81b": "\u6210",
        "\ue83e": "\u53ea",
        "\ue820": "\u5982",
        "\ue84e": "\u4e8b",
        "\ue85a": "\u628a",
        "\ue806": "\u8fd8",
        "\ue83f": "\u7528",
        "\ue833": "\u7b2c",
        "\ue811": "\u6837",
        "\ue804": "\u9053",
        "\ue814": "\u60f3",
        "\ue80f": "\u4f5c",
        "\ue84f": "\u79cd",
        "\ue80e": "\u5f00",
        "\ue823": "\u7f8e",
        "\ue849": "\u4e73",
        "\ue805": "\u9634",
        "\ue809": "\u6db2",
        "\ue81a": "\u830e",
        "\ue844": "\u6b32",
        "\ue847": "\u547b",
        "\ue850": "\u8089",
        "\ue824": "\u4ea4",
        "\ue85f": "\u6027",
        "\ue817": "\u80f8",
        "\ue85c": "\u79c1",
        "\ue838": "\u7a74",
        "\ue82a": "\u6deb",
        "\ue83d": "\u81c0",
        "\ue82b": "\u8214",
        "\ue80d": "\u5c04",
        "\ue839": "\u8131",
        "\ue834": "\u88f8",
        "\ue846": "\u9a9a",
        "\ue825": "\u5507",
    };
    return content.replace(/./g, (char) => contentTransDict[char] || char);
}

export enum FetchType {
    GET,
    POST,
}

export async function fetchChapterLogJs(url: string): Promise<string> {
    let script = await fetchText(url);
    if (script.startsWith("<!DOCTYPE html>") || script.startsWith("<html>")) {
        const $ = load(script);
        script = $("body pre").text();
    }
    return script;
}

export async function fetchWithAppliance(
    url: string,
    mode: FetchType = FetchType.GET,
    body?: string,
    cookies?: Record<string, string>,
): Promise<string> {
    const applianceUrl = process.env.APPLIANCE_URL || "http://localhost:5302";
    try {
        let res: Response | null = null;
        switch (mode) {
            case FetchType.GET:
                res = await fetch(`${applianceUrl}/request`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        url,
                        method: "GET",
                        cookies,
                    }),
                });
                break;
            case FetchType.POST:
                res = await fetch(`${applianceUrl}/request`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        url,
                        method: "POST",
                        data: body,
                        cookies,
                    }),
                });
                break;
        }
        if (!res.status || res.status !== 200) {
            throw new Error(
                `Failed to fetch via Appliance: ${res.status} ${res.statusText}`,
            );
        }
        const data = await res.json();
        return data.content;
    } catch (e) {
        throw new Error(`Error in fetchWithAppliance: ${e}`);
    }
}

function k(e: string): Uint8Array<ArrayBuffer> {
    // 标准 Base64 映射表
    const t =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    // 1. 过滤掉所有不在映射表中的字符 (对应原代码的正则)
    const n = e.replace(/[^A-Za-z0-9+/]/g, "");
    const r = n.length;

    // 2. 计算输出长度：每 4 个字符转为 3 个字节
    // 注意：原代码通常不处理末尾填充，直接通过位移计算
    const buf = new Uint8Array(Math.floor(r * 0.75));
    let i = 0, // buf 指针
        a = 0, // 累加器
        s = 0, // 当前位深
        c = 0; // 临时索引
    for (let l = 0; l < r; l++) {
        c = t.indexOf(n[l] || "");
        if (c === -1) continue; // 安全检查
        a = (a << 6) | c; // 每个 Base64 字符携带 6 位信息
        s += 6;
        if (s >= 8) {
            s -= 8;
            // 提取高 8 位存入字节数组
            buf[i++] = (a >> s) & 255;
        }
    }
    // 关键：必须截取到实际写入的长度
    // 并强制转换为 Uint8Array<ArrayBuffer>
    return new Uint8Array(buf.buffer.slice(0, i)) as Uint8Array<ArrayBuffer>;
}

export async function solveSearchChallenge(
    a: string,
    b: string,
    c: string,
): Promise<string> {
    const subtle = webcrypto.subtle;
    // 使用 as Uint8Array 明确告诉 TS 这是它需要的 BufferSource
    const keyData = k(a);
    const counterData = k(b);
    const encryptedData = k(c);
    try {
        const cryptoKey = await subtle.importKey(
            "raw",
            keyData,
            { name: "AES-CTR" },
            false,
            ["decrypt"],
        );
        const decryptedBuffer = await subtle.decrypt(
            {
                name: "AES-CTR",
                counter: counterData,
                length: 64,
            },
            cryptoKey,
            encryptedData,
        );
        // decryptedBuffer 得到的是 ArrayBuffer，需要转回 Uint8Array 供 TextDecoder 使用
        const decoder = new TextDecoder();
        const plainText = decoder.decode(new Uint8Array(decryptedBuffer));
        return encodeURIComponent(plainText);
    } catch (error) {
        throw new Error(`解密失败: ${error}`);
    }
}
