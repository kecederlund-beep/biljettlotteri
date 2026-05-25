import { NextResponse } from "next/server";
import { z } from "zod";

import { checkMemberEligibility, getMembershipSignupUrl, maskForLog } from "@/lib/itarget";
import { prisma } from "@/lib/prisma";
import { closeExpiredRaffles } from "@/lib/raffle";
import { isRaffleOpen } from "@/lib/raffle-state";
import { checkAndConsumeRateLimit } from "@/lib/rate-limit";
import { VERIFICATION_STATUS } from "@/lib/statuses";

const bodySchema = z.object({
  email: z.string().email()
});

export async function POST(
  request: Request,
  context: {
    params: Promise<{ slug: string }>;
  }
) {
  const { slug } = await context.params;

  await closeExpiredRaffles();

  const raffle = await prisma.raffle.findUnique({
    where: { slug },
    select: {
      id: true,
      status: true,
      openAt: true,
      closeAt: true
    }
  });

  if (!raffle) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  const rateLimit = await checkAndConsumeRateLimit({
    key: `${ip}:${slug}`,
    action: "raffle-entry",
    maxEvents: 8,
    windowMs: 60_000
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        code: "RATE_LIMITED",
        message: "För många försök. Försök igen strax."
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds)
        }
      }
    );
  }

  if (!isRaffleOpen(raffle)) {
    return NextResponse.json(
      {
        ok: false,
        code: "RAFFLE_CLOSED",
        message: "Lotteriet är stängt"
      },
      {
        status: 409
      }
    );
  }

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "INVALID_INPUT" }, { status: 400 });
  }

  const submittedEmail = parsed.data.email.trim().toLocaleLowerCase("sv-SE");

  const membershipCheck = await checkMemberEligibility({
    email: submittedEmail
  });

  await prisma.adminAuditLog.create({
    data: {
      action: "member_check",
      raffleId: raffle.id,
      actor: "system",
      details: JSON.stringify({
        status: membershipCheck.status,
        reasonCode: membershipCheck.reasonCode,
        checkedAt: membershipCheck.checkedAt,
        matchedBy: membershipCheck.memberSnapshot?.matchedBy || null,
        emailMask: maskForLog(submittedEmail)
      })
    }
  });

  if (membershipCheck.status === "unknown") {
    return NextResponse.json(
      {
        ok: false,
        code: "UNKNOWN_MEMBERSHIP",
        message: "Vi kunde inte verifiera medlemskap just nu. Försök igen om en stund."
      },
      {
        status: 503
      }
    );
  }

  if (membershipCheck.status === "ambiguous") {
    return NextResponse.json(
      {
        ok: false,
        code: "AMBIGUOUS_MEMBER",
        message: "Vi hittar flera möjliga medlemsprofiler för e-postadressen."
      },
      {
        status: 409
      }
    );
  }

  if (membershipCheck.status === "not_member") {
    return NextResponse.json(
      {
        ok: false,
        code: "NOT_MEMBER",
        message: "Vi hittar inget aktivt medlemskap.",
        signupUrl: getMembershipSignupUrl()
      },
      {
        status: 403
      }
    );
  }

  const existingByEmail = await prisma.raffleEntry.findFirst({
    where: {
      raffleId: raffle.id,
      submittedEmail
    },
    select: { id: true }
  });

  if (existingByEmail) {
    return NextResponse.json(
      {
        ok: false,
        code: "DUPLICATE",
        message: "Den här e-postadressen är redan registrerad i lotteriet."
      },
      {
        status: 409
      }
    );
  }

  const canonicalMembershipNumber = membershipCheck.memberSnapshot?.membershipNumber?.trim()
    ? membershipCheck.memberSnapshot.membershipNumber.trim()
    : `contact:${membershipCheck.memberSnapshot?.contactId || "unknown"}`;

  await prisma.raffleEntry.create({
    data: {
      raffleId: raffle.id,
      submittedMembershipNumber: "",
      submittedEmail,
      submittedLastName: "",
      submittedPhone: "",
      membershipNumber: canonicalMembershipNumber,
      lastName: "",
      phoneLast7: "",
      verificationStatus: VERIFICATION_STATUS.VERIFIED,
      verificationMatchReason: `itarget:${membershipCheck.reasonCode}`,
      verifiedAt: new Date()
    }
  });

  return NextResponse.json({
    ok: true,
    message: "Du är verifierad medlem. Din anmälan är registrerad."
  });
}
