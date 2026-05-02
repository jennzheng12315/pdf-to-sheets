import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { isMissingSectionError, parseStatement } from "@/lib/parseStatement";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

function isPdfMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  return (
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46 // F
  );
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("statement");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No PDF file uploaded." }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File is too large. Maximum allowed size is 20MB." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!isPdfMagicBytes(buffer)) {
      return NextResponse.json(
        { error: "Invalid PDF file signature. Please upload a real PDF." },
        { status: 400 },
      );
    }

    const parsed = await parseStatement(buffer);

    return NextResponse.json(parsed);
  } catch (error) {
    if (isMissingSectionError(error)) {
      return NextResponse.json(
        {
          error: "Missing required section(s) in PDF.",
          missingSections: error.missingSections,
        },
        { status: 400 },
      );
    }

    console.error("Parse statement failure", {
      userId: session.user.id,
      timestamp: new Date().toISOString(),
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      errorName: error instanceof Error ? error.name : "Unknown",
    });
    return NextResponse.json(
      {
        error:
          "Unable to parse this statement. Please verify the statement format and try again.",
      },
      { status: 400 },
    );
  }
}
