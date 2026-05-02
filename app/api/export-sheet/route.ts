import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { exportToGoogleSheets } from "@/lib/googleSheets";
import type { ExportSheetPayload } from "@/lib/types";

function normalizeLabels(labels: ExportSheetPayload["labels"]) {
  const out: ExportSheetPayload["labels"] = {};
  for (const [key, value] of Object.entries(labels)) {
    out[key.trim().toLowerCase()] = value;
  }
  return out;
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session?.accessToken || !session.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ExportSheetPayload;
    if (!body?.title?.trim()) {
      return NextResponse.json({ error: "Spreadsheet title is required." }, { status: 400 });
    }

    const result = await exportToGoogleSheets(session.accessToken, {
      ...body,
      labels: normalizeLabels(body.labels ?? {}),
    });

    return NextResponse.json({ url: result.url, spreadsheetId: result.spreadsheetId });
  } catch (error) {
    console.error("Export sheet failure", {
      userId: session.user.id,
      timestamp: new Date().toISOString(),
      status: "failed",
    });
    return NextResponse.json(
      { error: "Unable to export spreadsheet at the moment. Please try again." },
      { status: 500 },
    );
  }
}
