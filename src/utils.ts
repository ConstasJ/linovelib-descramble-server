export async function fetchHtml(url: string): Promise<string> {
    const requestInit: RequestInit = {
        method: "GET",
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0",
            Accept: "*/*",
            "Accept-Language": "*",
            Referer: url,
            Cookie: "night=0",
        },
    };
    const response = await fetch(url, requestInit);
    return await response.text();
}
