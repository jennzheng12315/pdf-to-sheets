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

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function applyCategoryColumn(
  sectionName: SectionName,
  rows: Record<string, string>[],
  labels: ExportSheetPayload["labels"],
) {
  if (
    sectionName !== "Deposits and Other Credits" &&
    sectionName !== "Withdrawals and Other Debits" &&
    sectionName !== "Checks"
  ) {
    return rows;
  }

  return rows.map((row) => {
    const sourceName = sectionName === "Checks" ? row.Name ?? "" : row.Description ?? "";
    const category = labels[normalizeName(sourceName)] ?? "";
    return { ...row, Category: category };
  });
}

function toGrid(sectionName: SectionName, sections: ParsedSections, labels: ExportSheetPayload["labels"]) {
  const rows = applyCategoryColumn(
    sectionName,
    sections[sectionName] as Array<Record<string, string>>,
    labels,
  ) as Array<Record<string, string>>;
  if (rows.length === 0) {
    return [["No data"]];
  }

  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((header) => row[header] ?? ""));
  return [headers, ...body];
}

export async function exportToGoogleSheets(accessToken: string, payload: ExportSheetPayload) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });

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

  const updates = SECTION_ORDER.map((sectionName) =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sectionName}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: toGrid(sectionName, payload.sections, payload.labels),
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

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: SECTION_ORDER.map((sectionName) => ({
        repeatCell: {
          range: {
            sheetId: sheetIdByName.get(sectionName),
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
      })),
    },
  });

  await drive.files.update({
    fileId: spreadsheetId,
    requestBody: {
      name: payload.title,
    },
  });

  return {
    spreadsheetId,
    url: created.data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}
