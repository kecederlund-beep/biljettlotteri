import { randomInt } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { closeExpiredRaffles } from "@/lib/raffle";
import { RAFFLE_STATUS, VERIFICATION_STATUS } from "@/lib/statuses";

function shuffleInPlace<T>(list: T[]) {
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [list[index], list[swapIndex]] = [list[swapIndex], list[index]];
  }

  return list;
}

export async function drawWinnersForRaffle(raffleId: string, actor = "admin") {
  await closeExpiredRaffles();

  const raffle = await prisma.raffle.findUnique({
    where: { id: raffleId },
    include: {
      entries: {
        where: {
          verificationStatus: VERIFICATION_STATUS.VERIFIED
        },
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });

  if (!raffle) {
    throw new Error("Lotteriet hittades inte");
  }

  const eligibleState: string[] = [
    RAFFLE_STATUS.CLOSED,
    RAFFLE_STATUS.ACTIVE,
    RAFFLE_STATUS.RESOLVED
  ];
  if (!eligibleState.includes(raffle.status)) {
    throw new Error("Lotteriet kan inte dras i nuvarande status");
  }

  if (raffle.entries.length === 0) {
    throw new Error("Det finns inga verifierade deltagare att dra ifrån");
  }

  const seenEmails = new Set<string>();
  const uniqueEntries = raffle.entries.filter((entry) => {
    const emailKey = entry.submittedEmail?.trim().toLocaleLowerCase("sv-SE");
    const key = emailKey || `legacy:${entry.membershipNumber}`;

    if (seenEmails.has(key)) {
      return false;
    }

    seenEmails.add(key);
    return true;
  });

  if (uniqueEntries.length === 0) {
    throw new Error("Det finns inga unika deltagare att dra ifrån");
  }

  const shuffled = shuffleInPlace([...uniqueEntries]);
  const winnerCount = Math.min(raffle.numberOfWinners, shuffled.length);
  const winners = shuffled.slice(0, winnerCount);

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.raffleWinner.deleteMany({
      where: {
        raffleId
      }
    });

    for (const [index, winner] of winners.entries()) {
      await tx.raffleWinner.create({
        data: {
          raffleId,
          raffleEntryId: winner.id,
          membershipNumber: winner.membershipNumber,
          position: index + 1,
          drawnAt: now
        }
      });
    }

    await tx.raffle.update({
      where: {
        id: raffleId
      },
      data: {
        status: RAFFLE_STATUS.RESOLVED,
        winnersPublicVisible: false
      }
    });

    await tx.adminAuditLog.create({
      data: {
        action: "raffle.draw",
        details: `Drog ${winners.length} vinnare från ${uniqueEntries.length} unika e-postadresser (${raffle.entries.length} verifierade poster)`,
        raffleId,
        actor
      }
    });
  });

  return {
    winners,
    invalidatedCount: 0,
    participantCount: uniqueEntries.length
  };
}
