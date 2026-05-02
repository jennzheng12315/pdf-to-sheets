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

const SECTION_PATTERNS: Record<SectionName, RegExp> = {
  "Account Summary": /account\s+summary/i,
  "Deposits and Other Credits": /deposits?\s+and\s+other\s+credits?/i,
  "Withdrawals and Other Debits": /withdrawals?\s+and\s+other\s+debits?/i,
  Checks: /\bchecks?\b/i,
  "Service Fees": /service\s+fees?/i,
  "Daily Ledger Balances": /daily\s+ledger\s+balances?/i,
};

class MissingSectionError extends Error {
  missingSections: SectionName[];

  constructor(missingSections: SectionName[]) {
    super("Missing required statement sections.");
    this.missingSections = missingSections;
  }
}

function tokenizeLine(line: string): string[] {
  return line
    .split(/\s{2,}|\t+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function normalizeAmount(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\s+/g, " ");
}

function parseRowsWithDateAmount(lines: string[]) {
  return lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((line) => {
      const dateMatch = line.match(/^(\d{1,2}\/\d{1,2})\s+(.*)\s+(-?\$?[\d,]+\.\d{2})$/);
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
  return lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d{1,2}\/\d{1,2})\s+(\d+)\s+(-?\$?[\d,]+\.\d{2})$/);
      if (!match) return null;
      return {
        Date: match[1],
        "Check #": match[2],
        Amount: normalizeAmount(match[3]),
        Name: "",
      };
    })
    .filter((row): row is { Date: string; "Check #": string; Amount: string; Name: string } => !!row);
}

function parseAccountSummaryRows(lines: string[]) {
  return lines
    .map((line) => tokenizeLine(line))
    .filter((parts) => parts.length >= 2)
    .map((parts) => ({
      Description: parts.slice(0, parts.length - 1).join(" "),
      Value: normalizeAmount(parts[parts.length - 1]),
    }))
    .filter((row) => row.Description && row.Value);
}

function parseDailyLedgerRows(lines: string[]) {
  return lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d{1,2}\/\d{1,2})\s+(-?\$?[\d,]+\.\d{2})$/);
      if (!match) return null;
      return { Date: match[1], "Balance ($)": normalizeAmount(match[2]) };
    })
    .filter((row): row is { Date: string; "Balance ($)": string } => !!row);
}

function splitSections(text: string): {
  sections: Record<SectionName, string[]>;
  missingSections: SectionName[];
} {
  const normalized = text.replace(/\r/g, "");
  const indexByHeader = SECTION_HEADERS.map((header) => {
    const regex = SECTION_PATTERNS[header];
    const match = regex.exec(normalized);
    return {
      header,
      index: match?.index ?? -1,
      length: match?.[0]?.length ?? header.length,
    };
  }).filter((entry) => entry.index >= 0);

  const missingSections = SECTION_HEADERS.filter(
    (header) => !indexByHeader.some((entry) => entry.header === header),
  );
  indexByHeader.sort((a, b) => a.index - b.index);

  const output = Object.fromEntries(
    SECTION_HEADERS.map((header) => [header, [] as string[]]),
  ) as Record<SectionName, string[]>;
  for (let i = 0; i < indexByHeader.length; i += 1) {
    const start = indexByHeader[i].index + indexByHeader[i].length;
    const end = i + 1 < indexByHeader.length ? indexByHeader[i + 1].index : normalized.length;
    output[indexByHeader[i].header] = normalized
      .slice(start, end)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return { sections: output, missingSections };
}

function mapCheckNamesFromText(fullText: string): Map<string, string> {
  const map = new Map<string, string>();
  const checkRegex =
    /(?:Check\s*#?\s*|CHECK\s*#?\s*)(\d{2,})[\s\S]{0,200}?(?:Pay to the Order of|PAY TO THE ORDER OF)\s+([A-Za-z0-9 ,.'&-]+)/g;

  for (const match of fullText.matchAll(checkRegex)) {
    const checkNumber = match[1]?.trim();
    const payee = match[2]?.trim();
    if (checkNumber && payee && !map.has(checkNumber)) {
      map.set(checkNumber, payee);
    }
  }
  return map;
}

function buildUniqueNames(sections: ParsedSections): string[] {
  const names = [
    ...sections["Deposits and Other Credits"].map((item) => item.Description),
    ...sections["Withdrawals and Other Debits"].map((item) => item.Description),
    ...sections.Checks.map((item) => item.Name),
  ]
    .map((name) => name.trim())
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
    const text = textContent.items
      .map((item) => {
        if (!("str" in item)) return "";
        const value = item.str ?? "";
        return item.hasEOL ? `${value}\n` : `${value} `;
      })
      .join("")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
    pageTexts.push(text);
  }

  const fullText = pageTexts.join("\n");
  const { sections: sectionBlocks, missingSections } = splitSections(fullText);
  const warnings: string[] = [];
  if (missingSections.length > 0) {
    warnings.push(`Missing section headers: ${missingSections.join(", ")}.`);
  }

  const checkNamesByNumber = mapCheckNamesFromText(fullText);
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
