// Polyfill DOMMatrix for server-side PDF.js before any imports
if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    a: number; b: number; c: number; d: number; e: number; f: number;
    constructor(init?: string | number[]) {
      if (Array.isArray(init) && init.length >= 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      } else {
        this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
      }
    }
    multiply(other: DOMMatrix): DOMMatrix {
      return new DOMMatrix([
        this.a * other.a + this.c * other.b,
        this.b * other.a + this.d * other.b,
        this.a * other.c + this.c * other.d,
        this.b * other.c + this.d * other.d,
        this.a * other.e + this.c * other.f + this.e,
        this.b * other.e + this.d * other.f + this.f,
      ]);
    }
    translate(tx: number, ty: number): DOMMatrix {
      return new DOMMatrix([this.a, this.b, this.c, this.d, this.e + tx, this.f + ty]);
    }
    scale(scaleX: number, scaleY?: number): DOMMatrix {
      const sy = scaleY ?? scaleX;
      return new DOMMatrix([this.a * scaleX, this.b * scaleX, this.c * sy, this.d * sy, this.e, this.f]);
    }
    rotate(angle: number): DOMMatrix {
      const rad = (angle * Math.PI) / 180;
      const cos = Math.cos(rad); const sin = Math.sin(rad);
      return new DOMMatrix([
        this.a * cos + this.c * sin, this.b * cos + this.d * sin,
        this.c * cos - this.a * sin, this.d * cos - this.b * sin,
        this.e, this.f,
      ]);
    }
  } as unknown as typeof globalThis.DOMMatrix;
}

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
