import { GaxiosError } from "gaxios";
import { google } from "googleapis";
import type { ExportSheetPayload, ParsedSections, SectionName } from "@/lib/types";

const SECTION_ORDER: SectionName[] = [
  "Account Summary",
  "Deposits and Other Credits",
  "Withdrawals and Other Debits",
  "Checks",
  "Service Fees",
  "Daily Ledger Balances",
];

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
    .trim()
    .toLowerCase();
}

function applyCategoryColumn(
  sectionName: SectionName,
  rows: Record<string, string>[],
  labels: ExportSheetPayload["labels"],
) {
  if (sectionName !== "Withdrawals and Other Debits" && sectionName !== "Checks") {
    return rows;
  }

  return rows.map((row) => {
    const sourceName = sectionName === "Checks" ? row.Name ?? "" : row.Description ?? "";
    const cleanedName = cleanNameForLabeling(sourceName);
    const category = labels[cleanedName] ?? "";
    return { ...row, Category: category };
  });
}

type GridResult = {
  grid: string[][];
  hasTotalRow: boolean;
};

function toGrid(sectionName: SectionName, sections: ParsedSections, labels: ExportSheetPayload["labels"]): GridResult {
  const rows = applyCategoryColumn(
    sectionName,
    sections[sectionName] as Array<Record<string, string>>,
    labels,
  ) as Array<Record<string, string>>;
  if (rows.length === 0) {
    return { grid: [["No data"]], hasTotalRow: false };
  }

  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((header) => row[header] ?? ""));

  // Add totals for sections with Amount column
  const sectionsWithTotals: SectionName[] = [
    "Deposits and Other Credits",
    "Withdrawals and Other Debits",
    "Checks",
    "Service Fees",
  ];

  let hasTotalRow = false;
  if (sectionsWithTotals.includes(sectionName)) {
    const amountColIndex = headers.findIndex((h) => h === "Amount");
    if (amountColIndex >= 0) {
      let total = 0;
      for (const row of body) {
        const val = parseFloat(row[amountColIndex] ?? "0");
        if (!Number.isNaN(val)) {
          total += val;
        }
      }
      // Add empty row and total row
      const emptyRow = new Array(headers.length).fill("");
      const totalRow = new Array(headers.length).fill("");
      totalRow[0] = "TOTAL";
      totalRow[amountColIndex] = total.toFixed(2);
      body.push(emptyRow, totalRow);
      hasTotalRow = true;
    }
  }

  return { grid: [headers, ...body], hasTotalRow };
}

export async function exportToGoogleSheets(accessToken: string, payload: ExportSheetPayload) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });

  try {
    await drive.about.get({ fields: "user(displayName)" });
  } catch (error) {
    if (error instanceof GaxiosError) {
      throw new Error(
        `Google authorization failed: ${error.response?.status ?? "unknown"} ${error.message}`,
      );
    }
    throw error;
  }

  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: payload.title },
      sheets: SECTION_ORDER.map((name) => ({
        properties: { title: name },
      })),
    },
    fields: "spreadsheetId,spreadsheetUrl,sheets.properties(sheetId,title)",
  });

  const spreadsheetId = created.data.spreadsheetId;
  if (!spreadsheetId) {
    throw new Error("Failed to create spreadsheet.");
  }

  // Build grids and track which sections have total rows
  const gridResults = new Map<SectionName, GridResult>();
  for (const sectionName of SECTION_ORDER) {
    gridResults.set(sectionName, toGrid(sectionName, payload.sections, payload.labels));
  }

  const updates = SECTION_ORDER.map((sectionName) =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sectionName}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: gridResults.get(sectionName)!.grid,
      },
    }),
  );
  await Promise.all(updates);

  const sheetIdByName = new Map(
    (created.data.sheets ?? []).map((sheet) => [
      sheet.properties?.title ?? "",
      sheet.properties?.sheetId ?? 0,
    ]),
  );

  // Build formatting requests - bold header row and total row (if exists)
  const formatRequests: Array<{
    repeatCell: {
      range: {
        sheetId: number | undefined;
        startRowIndex: number;
        endRowIndex: number;
      };
      cell: {
        userEnteredFormat: {
          textFormat: { bold: boolean };
        };
      };
      fields: string;
    };
  }> = [];

  for (const sectionName of SECTION_ORDER) {
    const sheetId = sheetIdByName.get(sectionName);
    const result = gridResults.get(sectionName)!;

    // Bold header row (row 0)
    formatRequests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
          },
        },
        fields: "userEnteredFormat.textFormat.bold",
      },
    });

    // Bold total row (last row) if exists
    if (result.hasTotalRow) {
      const totalRowIndex = result.grid.length - 1;
      formatRequests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: totalRowIndex,
            endRowIndex: totalRowIndex + 1,
          },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true },
            },
          },
          fields: "userEnteredFormat.textFormat.bold",
        },
      });
    }
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: formatRequests,
    },
  });

  return {
    spreadsheetId,
    url: created.data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}
