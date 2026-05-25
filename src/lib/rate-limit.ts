import { prisma } from "@/lib/prisma";

type RateLimitInput = {
  key: string;
  action: string;
  maxEvents: number;
  windowMs: number;
};

export async function checkAndConsumeRateLimit({
  key,
  action,
  maxEvents,
  windowMs
}: RateLimitInput) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);

  await prisma.rateLimitEvent.deleteMany({
    where: {
      action,
      createdAt: {
        lt: cutoff
      }
    }
  });

  const currentCount = await prisma.rateLimitEvent.count({
    where: {
      key,
      action,
      createdAt: {
        gte: cutoff
      }
    }
  });

  if (currentCount >= maxEvents) {
    return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  await prisma.rateLimitEvent.create({
    data: {
      key,
      action
    }
  });

  return { allowed: true, retryAfterSeconds: 0 };
}
