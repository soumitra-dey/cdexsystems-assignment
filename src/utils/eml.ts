import { readFile } from "node:fs/promises";
import { parseKeyValueLines } from "./text.ts";

/** Parse a simple .eml file: headers, blank line, then "Key: Value" body. */
export async function parseEml(
  filePath: string,
): Promise<Record<string, unknown>> {
  const raw = await readFile(filePath, "utf8");
  // Split headers from body at the first blank line.
  const blank = raw.search(/\r?\n\r?\n/);
  const body = blank >= 0 ? raw.slice(blank).replace(/^\r?\n\r?\n/, "") : raw;
  return parseKeyValueLines(body);
}
