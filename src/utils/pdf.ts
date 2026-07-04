import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFile } from "node:fs/promises";
import { parseKeyValueText } from "./text.ts";

/** Extract text from a PDF and parse "Key: Value" fields from it. */
export async function parsePdf(
  filePath: string,
): Promise<Record<string, unknown>> {
  const bytes = await readFile(filePath);
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    text +=
      tc.items
        .map((it: any) => (typeof it.str === "string" ? it.str : ""))
        .join(" ") + "\n";
  }
  return parseKeyValueText(text);
}
