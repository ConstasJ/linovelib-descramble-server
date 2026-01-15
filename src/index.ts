import { readFile, writeFile } from "fs/promises";
import { decrypt } from "./decryptor";

async function main() {
    const input = await readFile("input.html", "utf-8");
    const output = await decrypt(input);
    await writeFile("output.html", output, "utf-8");
}

main();
