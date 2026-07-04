import { NextRequest, NextResponse } from "next/server";
import { finishAuth } from "../../../enablebanking/connection";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/settings?error=missing_code", req.url));
  try {
    await finishAuth(code);
    return NextResponse.redirect(new URL("/settings?connected=1", req.url));
  } catch {
    return NextResponse.redirect(new URL("/settings?error=auth_failed", req.url));
  }
}
