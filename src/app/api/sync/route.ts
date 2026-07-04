import { NextResponse } from "next/server";
import { db } from "../../../db/index";
import { getSetting } from "../../../db/repositories/settings";
import { ebGet } from "../../../enablebanking/client";
import { syncAll } from "../../../enablebanking/sync";

export async function POST() {
  const uidsRaw = getSetting(db(), "account_uids");
  if (!uidsRaw) return NextResponse.json({ error: "not_connected" }, { status: 400 });
  try {
    const result = await syncAll(db(), {
      ebGet,
      accountUids: JSON.parse(uidsRaw) as string[],
      accountName: "CIC",
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
