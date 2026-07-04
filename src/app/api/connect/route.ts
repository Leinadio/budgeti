import { NextResponse } from "next/server";
import { startAuth } from "../../../enablebanking/connection";

export async function POST() {
  try {
    const { url } = await startAuth();
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
