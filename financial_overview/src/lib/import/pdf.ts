// PDF text extraction for statement uploads. ICS only publishes PDF, so the
// import path needs to see what a human sees: one line per visual row, cells in
// their printed order. Column positions are the only structure a PDF has, so the
// reconstruction lives here and nowhere else.

import { getDocumentProxy } from "unpdf";

/** Read the bytes, never the filename: a .pdf that is not one must not reach the parser. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
  );
}

/**
 * Every visual line of every page, words joined by a single space and ordered
 * left to right. Lines further apart than LINE_TOLERANCE are separate rows, which
 * is what turns a table back into records.
 */
const LINE_TOLERANCE = 2.5;

export async function extractPdfLines(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const lines: string[] = [];

  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();

    const words: { x: number; y: number; text: string }[] = [];
    for (const item of content.items) {
      // TextMarkedContent carries no str; only text runs do.
      if (!("str" in item) || typeof item.str !== "string") continue;
      const text = item.str.trim();
      if (text === "") continue;
      words.push({ x: item.transform[4], y: item.transform[5], text });
    }

    // Top of the page first, then left to right: PDF y grows upwards.
    words.sort((a, b) => b.y - a.y || a.x - b.x);

    let current: typeof words = [];
    let baseline = Number.NaN;
    const flush = () => {
      if (current.length === 0) return;
      current.sort((a, b) => a.x - b.x);
      lines.push(current.map((word) => word.text).join(" "));
      current = [];
    };

    for (const word of words) {
      if (!Number.isNaN(baseline) && Math.abs(word.y - baseline) > LINE_TOLERANCE) {
        flush();
      }
      if (current.length === 0) baseline = word.y;
      current.push(word);
    }
    flush();
  }

  return lines;
}
