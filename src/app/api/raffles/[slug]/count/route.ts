import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { closeExpiredRaffles } from "@/lib/raffle";
import { VERIFICATION_STATUS } from "@/lib/statuses";

export const dynamic = "force-dynamic";

export async function GET(
  _: Request,
  context: {
    params: Promise<{ slug: string }>;
  }
) {
  const { slug } = await context.params;

  await closeExpiredRaffles();

  const raffle = await prisma.raffle.findUnique({
    where: {
      slug
    },
    select: {
      id: true
    }
  });

  if (!raffle) {
    return NextResponse.json({ message: "Lotteriet hittades inte" }, { status: 404 });
  }

  const participants = await prisma.raffleEntry.findMany({
    where: {
      raffleId: raffle.id,
      verificationStatus: VERIFICATION_STATUS.VERIFIED
    },
    select: {
      submittedEmail: true,
      membershipNumber: true
    }
  });

  const uniqueParticipants = new Set(
    participants.map((entry) => {
      const emailKey = entry.submittedEmail?.trim().toLocaleLowerCase("sv-SE");
      return emailKey || `legacy:${entry.membershipNumber}`;
    })
  );

  return NextResponse.json(
    {
      count: uniqueParticipants.size,
      updatedAt: new Date().toISOString()
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
