/**
 * pdf.ts - "what does a robot see?" checks on a compiled PDF.
 *
 * /apply asks Claude to run this check through Python (pypdf or Poppler). Neither is
 * installed here, and neither should be: the app already runs on a JS runtime, so it
 * does the extraction itself and shows the result in the UI, where she can actually
 * read it. Claude's own pass degrades to a visual review, which apply.md allows for.
 */

import { extractText, getDocumentProxy } from "unpdf";
import { readFileSync } from "node:fs";

export interface AtsResult {
  ok: boolean;
  pages: number;
  expectedPages: number | null;
  chars: number;
  text: string;
  findings: { level: "pass" | "warn" | "fail"; label: string; detail: string }[];
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+\d[\d\s().-]{6,})|(?:\b\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}\b)/;
const YEAR = /\b(19|20)\d{2}\b/;

export async function atsCheck(absPath: string, expectedPages: number | null = null): Promise<AtsResult> {
  const buf = new Uint8Array(readFileSync(absPath));
  const pdf = await getDocumentProxy(buf);
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  const clean = String(text ?? "");
  const findings: AtsResult["findings"] = [];

  const push = (level: "pass" | "warn" | "fail", label: string, detail: string) =>
    findings.push({ level, label, detail });

  if (clean.trim().length < 200) {
    push("fail", "Readable text", "Almost no text came out. A screening system would see a blank page.");
  } else {
    push("pass", "Readable text", `${clean.trim().length} characters extracted cleanly.`);
  }

  if (/\(cid:\d+\)/.test(clean)) push("fail", "Fonts", "Some text extracts as glyph codes instead of letters.");
  else if (/�/.test(clean)) push("fail", "Fonts", "Some characters extract as replacement symbols.");
  else push("pass", "Fonts", "Every character extracts as real text.");

  const email = clean.match(EMAIL);
  if (email) push("pass", "Email", `Found as text: ${email[0]}`);
  else push("fail", "Email", "No email address in the text layer. A parser cannot contact you.");

  if (PHONE.test(clean)) push("pass", "Phone number", "Found as text.");
  else push("warn", "Phone number", "No phone number found. Fine if you left it off on purpose.");

  const years = clean.match(new RegExp(YEAR, "g")) ?? [];
  if (years.length >= 2) push("pass", "Dates", `${new Set(years).size} distinct years readable.`);
  else push("warn", "Dates", "Few or no years found, so a parser may not place your roles on a timeline.");

  if (expectedPages !== null) {
    if (totalPages === expectedPages) push("pass", "Length", `${totalPages} page${totalPages === 1 ? "" : "s"}, as intended.`);
    else
      push(
        "fail",
        "Length",
        `${totalPages} page${totalPages === 1 ? "" : "s"}, but this document should be exactly ${expectedPages}.`,
      );
  }

  return {
    ok: !findings.some((f) => f.level === "fail"),
    pages: totalPages,
    expectedPages,
    chars: clean.trim().length,
    text: clean,
    findings,
  };
}

export async function pageCount(absPath: string): Promise<number | null> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(readFileSync(absPath)));
    return pdf.numPages;
  } catch {
    return null;
  }
}
