import { PrismaClient } from "@prisma/client";

import { RAFFLE_STATUS } from "../src/lib/statuses";

const prisma = new PrismaClient();

async function main() {
  await prisma.membershipSourceConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      sheetTab: process.env.GOOGLE_SHEETS_TAB || "Medlemmar"
    }
  });

  const now = new Date();
  const openAt = new Date(now.getTime() + 60 * 60 * 1000);
  const closeAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const drawAt = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  await prisma.raffle.upsert({
    where: { slug: "lulea-vs-frolunda" },
    update: {},
    create: {
      slug: "lulea-vs-frolunda",
      matchName: "Luleå Hockey vs Frölunda",
      matchDate: new Date(now.getTime() + 72 * 60 * 60 * 1000),
      description: "Medlemslotteri för hemmamatch i SHL",
      arena: "COOP Norrbotten Arena",
      openAt,
      closeAt,
      drawAt,
      numberOfWinners: 2,
      status: RAFFLE_STATUS.ACTIVE
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
