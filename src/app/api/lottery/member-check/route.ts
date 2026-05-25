import { NextResponse } from "next/server";
import { z } from "zod";

import { checkMemberEligibility } from "@/lib/itarget";
import { checkAndConsumeRateLimit } from "@/lib/rate-limit";

const requestSchema = z.object({
  email: z.string().email()
});

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  const rateLimit = await checkAndConsumeRateLimit({
    key: `${ip}:member-check`,
    action: "member-check",
    maxEvents: 20,
    windowMs: 60_000
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        code: "RATE_LIMITED",
        message: "För många verifieringsförsök. Försök igen strax."
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds)
        }
      }
    );
  }

  const json = await request.json();
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "INVALID_INPUT" }, { status: 400 });
  }

  const result = await checkMemberEligibility(parsed.data);

  return NextResponse.json({
    ok: true,
    status: result.status,
    reason_code: result.reasonCode,
    checked_at: result.checkedAt,
    member_snapshot: result.memberSnapshot
  });
}
