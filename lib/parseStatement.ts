import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ParseStatementResult, ParsedSections, SectionName } from "@/lib/types";

const SECTION_HEADERS: SectionName[] = [
  "Account Summary",
  "Deposits and Other Credits",
  "Withdrawals and Other Debits",
  "Checks",
  "Service Fees",
  "Daily Ledger Balances",
];

// In Next.js server runtime, pdfjs may attempt to auto-resolve a bundled worker path
// that does not exist. Pointing to the package worker module avoids that failure.
GlobalWorkerOptions.workerSrc = "pdfjs-dist/build/pdf.worker.mjs";

const SECTION_PATTERNS: Record<SectionName, RegExp[]> = {
  "Account Summary": [
    /^account\s+summary$/i,
    /\baccount\s+summary\b/i,
    /^summary$/i,
    /\baccount\s+information\b.*\bsummary\b/i,
  ],
  "Deposits and Other Credits": [
    /^deposits?\s+and\s+other\s+credits?$/i,
    /^deposits?\s+and\s+ohter\s+credits?$/i,
    /\bdeposits?\b.*\bcredits?\b/i,
  ],
  "Withdrawals and Other Debits": [
    /^withdrawals?\s+and\s+other\s+debits?$/i,
    /\bwithdrawals?\b.*\bdebits?\b/i,
  ],
  Checks: [/^checks?$/i, /^checks?\s+paid$/i],
  "Service Fees": [/^service\s+fees?$/i, /\bservice\s+fees?\b/i],
  "Daily Ledger Balances": [/^daily\s+ledger\s+balances?$/i, /\bdaily\s+ledger\s+balances?\b/i],
};

class MissingSectionError extends Error {
  missingSections: SectionName[];

  constructor(missingSections: SectionName[]) {
    super("Missing required statement sections.");
    this.missingSections = missingSections;
  }
}

function normalizeAmount(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\s+/g, " ");
}

function parseRowsWithDateAmount(lines: string[]) {
  const datePattern = String.raw`\d{1,2}\/\d{1,2}(?:\/\d{2,4})?`;
  const amountPattern = String.raw`[\(\-]?\$?[\d,]+\.\d{2}\)?-?`;
  const rowRegex = new RegExp(`^(${datePattern})\\s+(.+?)\\s+(${amountPattern})$`);

  return lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((line) => {
      const dateMatch = line.match(rowRegex);
      if (!dateMatch) return null;
      return {
        Date: dateMatch[1],
        Description: dateMatch[2].trim(),
        Amount: normalizeAmount(dateMatch[3]),
      };
    })
    .filter((row): row is { Date: string; Description: string; Amount: string } => !!row);
}

function parseChecksRows(lines: string[]) {
  const datePattern = String.raw`\d{1,2}\/\d{1,2}(?:\/\d{2,4})?`;
  const amountPattern = String.raw`[\(\-]?\$?[\d,]+\.\d{2}\)?-?`;
  const tripleRegex = new RegExp(`(${datePattern})\\s+(\\d+)\\s+(${amountPattern})`, "g");

  const rows: Array<{ Date: string; "Check #": string; Amount: string; Name: string }> = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;

    for (const match of line.matchAll(tripleRegex)) {
      rows.push({
        Date: match[1],
        "Check #": match[2],
        Amount: normalizeAmount(match[3]),
        Name: "",
      });
    }
  }

  rows.sort((left, right) => {
    const leftNum = parseInt(left["Check #"], 10);
    const rightNum = parseInt(right["Check #"], 10);
    if (!Number.isNaN(leftNum) && !Number.isNaN(rightNum) && leftNum !== rightNum) {
      return leftNum - rightNum;
    }
    return left.Date.localeCompare(right.Date);
  });

  return rows;
}

const ACCOUNT_SUMMARY_AMOUNT = String.raw`[\(\-]?\$?[\d,]+\.\d{2}\)?-?`;

/** BOA account summary: label column + amount column; no headers. Amount is last token on the line. */
function parseAccountSummaryRows(lines: string[]) {
  const rowEndAmount = new RegExp(`^(.+?)\\s+(${ACCOUNT_SUMMARY_AMOUNT})$`);
  const amountOnly = new RegExp(`^${ACCOUNT_SUMMARY_AMOUNT}$`);

  const rows: Array<{ Description: string; Value: string }> = [];

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;

    const withAmount = line.match(rowEndAmount);
    if (withAmount) {
      rows.push({
        Description: withAmount[1].trim(),
        Value: normalizeAmount(withAmount[2]),
      });
      continue;
    }

    if (amountOnly.test(line) && rows.length > 0) {
      rows[rows.length - 1] = {
        ...rows[rows.length - 1],
        Value: normalizeAmount(line),
      };
      continue;
    }
  }

  return rows.filter((row) => row.Description && row.Value);
}

function parseDailyLedgerRows(lines: string[]) {
  const datePattern = String.raw`\d{1,2}\/\d{1,2}(?:\/\d{2,4})?`;
  const amountPattern = String.raw`[\(\-]?\$?[\d,]+\.\d{2}\)?-?`;
  /** BOA often lays out Daily Ledger as several Date/Balance pairs left-to-right on the same PDF row. */
  const pairRegexSource = `(${datePattern})\\s+(${amountPattern})`;

  function ledgerDateParts(dateStr: string): { y: number; m: number; d: number } {
    const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (!match) return { y: 0, m: 0, d: 0 };
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    let year = match[3] ? parseInt(match[3], 10) : 0;
    if (match[3] && year < 100) year += 2000;
    return { y: year, m: month, d: day };
  }

  function compareDailyLedgerDates(a: string, b: string): number {
    const A = ledgerDateParts(a);
    const B = ledgerDateParts(b);
    if (A.y !== 0 && B.y !== 0 && A.y !== B.y) return A.y - B.y;
    if (A.m !== B.m) return A.m - B.m;
    return A.d - B.d;
  }

  const rows: Array<{ Date: string; "Balance ($)": string }> = [];

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;

    const lower = line.toLowerCase();
    if (
      /^date\b/.test(lower) &&
      /\bbalance\b/.test(lower) &&
      !/\d{1,2}\/\d{1,2}/.test(line)
    ) {
      continue;
    }

    const pairRegex = new RegExp(pairRegexSource, "g");
    for (const match of line.matchAll(pairRegex)) {
      rows.push({
        Date: match[1],
        "Balance ($)": normalizeAmount(match[2]),
      });
    }
  }

  rows.sort((left, right) => compareDailyLedgerDates(left.Date, right.Date));

  return rows;
}

function getPageLines(
  items: Array<{ str?: string; transform?: number[] }>,
  options?: { maxX?: number },
): string[] {
  const lineBuckets = new Map<number, Array<{ x: number; text: string }>>();

  for (const item of items) {
    const text = item.str?.trim();
    const transform = item.transform;
    if (!text || !transform || transform.length < 6) continue;
    const x = transform[4];
    if (options?.maxX !== undefined && x > options.maxX) continue;
    const y = transform[5];
    const yKey = Math.round(y * 2) / 2;
    const bucket = lineBuckets.get(yKey) ?? [];
    bucket.push({ x, text });
    lineBuckets.set(yKey, bucket);
  }

  return [...lineBuckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) =>
      parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

function normalizeForHeading(line: string): string {
  return line
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function detectSectionHeading(line: string): SectionName | null {
  const trimmedLine = line.trim();
  if (/^\d{1,2}\/\d{1,2}/.test(trimmedLine)) {
    return null;
  }

  const normalizedLine = normalizeForHeading(line);
  if (!normalizedLine) return null;

  // Prevent false positives from "Check Images", row lines, etc.
  if (
    normalizedLine.includes("check images") ||
    normalizedLine.includes("check #") ||
    normalizedLine.includes("pay to the order of")
  ) {
    return null;
  }

  for (const section of SECTION_HEADERS) {
    const patterns = SECTION_PATTERNS[section];
    if (patterns.some((pattern) => pattern.test(normalizedLine))) {
      return section;
    }
  }
  return null;
}

/** Sub-rows inside Account Summary reuse the same phrases as detail section titles. */
const ACCOUNT_SUMMARY_INTERIOR_HEADINGS: SectionName[] = [
  "Deposits and Other Credits",
  "Withdrawals and Other Debits",
  "Checks",
  "Service Fees",
];

function isEndingBalanceSummaryLine(line: string): boolean {
  return /\bending\s+balance\s+on\b/i.test(line);
}

function isBeginningBalanceSummaryLine(line: string): boolean {
  return /\bbeginning\s+balance\s+on\b/i.test(line);
}

function hasTrailingAccountSummaryAmount(line: string): boolean {
  const compact = line.replace(/\s+/g, " ").trim();
  return new RegExp(`\\s+${ACCOUNT_SUMMARY_AMOUNT}$`).test(compact);
}

function splitSections(lines: string[]): {
  sections: Record<SectionName, string[]>;
  missingSections: SectionName[];
} {
  const output = Object.fromEntries(
    SECTION_HEADERS.map((header) => [header, [] as string[]]),
  ) as Record<SectionName, string[]>;
  const foundSections = new Set<SectionName>();

  let currentSection: SectionName | null = null;
  /** After this, "Deposits and Other Credits" etc. are real section headers, not summary sub-rows. */
  let accountSummaryInteriorClosed = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const sectionHeading = detectSectionHeading(line);

    if (sectionHeading === "Account Summary") {
      currentSection = "Account Summary";
      accountSummaryInteriorClosed = false;
      foundSections.add("Account Summary");
      continue;
    }

    if (!currentSection && isBeginningBalanceSummaryLine(line)) {
      currentSection = "Account Summary";
      accountSummaryInteriorClosed = false;
      foundSections.add("Account Summary");
      output["Account Summary"].push(line);
      continue;
    }

    if (
      !currentSection &&
      sectionHeading &&
      ACCOUNT_SUMMARY_INTERIOR_HEADINGS.includes(sectionHeading) &&
      hasTrailingAccountSummaryAmount(line)
    ) {
      currentSection = "Account Summary";
      accountSummaryInteriorClosed = false;
      foundSections.add("Account Summary");
      output["Account Summary"].push(line);
      continue;
    }

    if (
      currentSection === "Account Summary" &&
      !accountSummaryInteriorClosed &&
      sectionHeading &&
      ACCOUNT_SUMMARY_INTERIOR_HEADINGS.includes(sectionHeading)
    ) {
      output["Account Summary"].push(line);
      continue;
    }

    if (sectionHeading) {
      currentSection = sectionHeading;
      foundSections.add(sectionHeading);
      continue;
    }

    if (!currentSection) continue;

    output[currentSection].push(line);

    if (currentSection === "Account Summary" && isEndingBalanceSummaryLine(line)) {
      accountSummaryInteriorClosed = true;
    }
  }

  const missingSections = SECTION_HEADERS.filter((section) => !foundSections.has(section));
  return { sections: output, missingSections };
}

function cleanCheckPayeeName(value: string): string {
  return value
    .replace(/^\W+/, "")
    .replace(/\s+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(check|check number|check#)\b.*$/i, "")
    .replace(/\bdate:.*$/i, "")
    .replace(/\bamount:.*$/i, "")
    .trim();
}

function isLikelyAmountOrDateLine(line: string): boolean {
  const normalized = line.trim();
  if (!normalized) return true;
  if (/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(normalized)) return true;
  if (/^[\(\-]?\$?[\d,]+\.\d{2}\)?-?$/.test(normalized)) return true;
  return false;
}

function extractCheckImageLines(lines: string[]): string[] {
  const startIndex = lines.findIndex((line) => /\bcheck\s+images?\b/i.test(line));
  if (startIndex < 0) return [];

  const extracted: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    const heading = detectSectionHeading(line);
    if (heading && heading !== "Checks") {
      break;
    }

    extracted.push(line);
  }
  return extracted;
}

function mapCheckNamesFromLines(checkImageLines: string[], fullText: string): Map<string, string> {
  const map = new Map<string, string>();
  let currentCheckNumber: string | null = null;
  let waitingForPayee = false;

  for (const rawLine of checkImageLines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;

    const lineWithCheck = line.match(/^(\d{2,})\b\s*(.*)$/);
    if (lineWithCheck) {
      currentCheckNumber = lineWithCheck[1];
      waitingForPayee = false;
      const rest = lineWithCheck[2].trim();
      if (/pay to the order of/i.test(rest)) {
        const inlinePayee = rest.replace(/^.*pay to the order of\s*/i, "").trim();
        const cleanedInline = cleanCheckPayeeName(inlinePayee);
        if (cleanedInline && !map.has(currentCheckNumber)) {
          map.set(currentCheckNumber, cleanedInline);
          currentCheckNumber = null;
        } else {
          waitingForPayee = true;
        }
      }
      continue;
    }

    if (/pay to the order of/i.test(line)) {
      const inlinePayee = line.replace(/^.*pay to the order of\s*/i, "").trim();
      const cleanedInline = cleanCheckPayeeName(inlinePayee);
      if (currentCheckNumber && cleanedInline && !map.has(currentCheckNumber)) {
        map.set(currentCheckNumber, cleanedInline);
        currentCheckNumber = null;
        waitingForPayee = false;
      } else {
        waitingForPayee = !!currentCheckNumber;
      }
      continue;
    }

    if (currentCheckNumber && (waitingForPayee || !map.has(currentCheckNumber))) {
      if (isLikelyAmountOrDateLine(line)) continue;
      const cleaned = cleanCheckPayeeName(line);
      if (cleaned) {
        map.set(currentCheckNumber, cleaned);
        currentCheckNumber = null;
        waitingForPayee = false;
      }
    }
  }

  // Fallback for statements where check-image text is flattened.
  if (map.size === 0) {
    const checkRegex =
      /(?:Check\s*#?\s*|CHECK\s*#?\s*)(\d{2,})[\s\S]{0,240}?(?:Pay to the Order of|PAY TO THE ORDER OF)\s+([A-Za-z0-9 ,.'&-]+)/g;
    for (const match of fullText.matchAll(checkRegex)) {
      const checkNumber = match[1]?.trim();
      const payee = cleanCheckPayeeName(match[2] ?? "");
      if (checkNumber && payee && !map.has(checkNumber)) {
        map.set(checkNumber, payee);
      }
    }
  }

  return map;
}

function cleanNameForLabeling(value: string): string {
  return value
    .replace(/\bDES:[^\s]+/gi, "")
    .replace(/\bID:[^\s]+/gi, "")
    .replace(/\bINDN:[^\s]+/gi, "")
    .replace(/\bConf#\s*\S+/gi, "")
    .replace(/\bTRN:[^\s]+/gi, "")
    .replace(/\bSERVICE\s+REF::[^\s]+/gi, "")
    .replace(/\bDATE:[^\s]+/gi, "")
    .replace(/\bTIME:[^\s]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildUniqueNames(sections: ParsedSections): string[] {
  const names = [
    ...sections["Deposits and Other Credits"].map((item) => item.Description),
    ...sections["Withdrawals and Other Debits"].map((item) => item.Description),
    ...sections.Checks.map((item) => item.Name),
  ]
    .map((name) => cleanNameForLabeling(name))
    .filter(Boolean);

  const deduped = new Map<string, string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, name);
    }
  }
  return [...deduped.values()].sort((a, b) => a.localeCompare(b));
}

export async function parseStatement(buffer: Buffer): Promise<ParseStatementResult> {
  const loadingTask = getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const lineItems = textContent.items
      .map((item) => ({
        str: "str" in item ? item.str : "",
        transform: "transform" in item ? item.transform : undefined,
      }))
      .filter((item) => item.str);
    const lines = getPageLines(lineItems, {
      maxX: pageNumber === 1 ? viewport.width * 0.68 : undefined,
    });
    pageTexts.push(lines.join("\n"));
  }

  const fullText = pageTexts.join("\n");
  const allLines = fullText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const { sections: sectionBlocks, missingSections } = splitSections(allLines);
  const warnings: string[] = [];
  if (missingSections.length > 0) {
    warnings.push(`Missing section headers: ${missingSections.join(", ")}.`);
  }

  const checkImageLines = extractCheckImageLines(allLines);
  const checkNamesByNumber = mapCheckNamesFromLines(checkImageLines, fullText);
  if (checkNamesByNumber.size === 0) {
    warnings.push("Check images section not found - Name column will be empty.");
  }

  const sections: ParsedSections = {
    "Account Summary": parseAccountSummaryRows(sectionBlocks["Account Summary"]),
    "Deposits and Other Credits": parseRowsWithDateAmount(
      sectionBlocks["Deposits and Other Credits"],
    ),
    "Withdrawals and Other Debits": parseRowsWithDateAmount(
      sectionBlocks["Withdrawals and Other Debits"],
    ),
    Checks: parseChecksRows(sectionBlocks.Checks).map((row) => ({
      ...row,
      Name: checkNamesByNumber.get(row["Check #"]) ?? "",
    })),
    "Service Fees": parseRowsWithDateAmount(sectionBlocks["Service Fees"]),
    "Daily Ledger Balances": parseDailyLedgerRows(sectionBlocks["Daily Ledger Balances"]),
  };

  const totalRows =
    sections["Account Summary"].length +
    sections["Deposits and Other Credits"].length +
    sections["Withdrawals and Other Debits"].length +
    sections.Checks.length +
    sections["Service Fees"].length +
    sections["Daily Ledger Balances"].length;

  if (totalRows === 0) {
    throw new MissingSectionError(missingSections.length > 0 ? missingSections : SECTION_HEADERS);
  }

  return {
    sections,
    uniqueNames: buildUniqueNames(sections),
    warnings,
  };
}

export function isMissingSectionError(error: unknown): error is MissingSectionError {
  return error instanceof MissingSectionError;
}
