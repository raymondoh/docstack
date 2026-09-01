import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { reconcileFulfillmentEmails } from "@/lib/services/order-fulfillment";

function hasValidBearerToken(request: Request) {
  const secret = env.FULFILLMENT_RECONCILIATION_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;

  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function POST(request: Request) {
  if (!env.FULFILLMENT_RECONCILIATION_SECRET) {
    return NextResponse.json({ error: "Fulfillment reconciliation is not configured." }, { status: 503 });
  }
  if (!hasValidBearerToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await reconcileFulfillmentEmails();
  return NextResponse.json({ ok: true, ...summary });
}
