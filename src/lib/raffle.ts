import { prisma } from "@/lib/prisma";
import { RAFFLE_STATUS } from "@/lib/statuses";

export async function closeExpiredRaffles() {
  const now = new Date();

  const updated = await prisma.raffle.updateMany({
    where: {
      status: RAFFLE_STATUS.ACTIVE,
      closeAt: {
        lte: now
      }
    },
    data: {
      status: RAFFLE_STATUS.CLOSED
    }
  });

  if (updated.count > 0) {
    await prisma.adminAuditLog.create({
      data: {
        action: "raffle.autoclose",
        details: `Auto-stängde ${updated.count} lotterier`,
        actor: "system"
      }
    });
  }

  return updated.count;
}
