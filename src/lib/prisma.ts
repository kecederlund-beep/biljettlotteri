import { cache } from "react";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

const logLevels: Prisma.LogLevel[] =
  process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

function resolveConnectionString() {
  try {
    const { env } = getCloudflareContext();
    const hyperdrive = (env as { HYPERDRIVE?: { connectionString?: string } }).HYPERDRIVE;
    if (hyperdrive?.connectionString) {
      return hyperdrive.connectionString;
    }
  } catch {
    // Ignore when Cloudflare context is unavailable (e.g. local Next dev/build)
  }

  return process.env.DATABASE_URL;
}

const getPrismaClient = cache(() => {
  const connectionString = resolveConnectionString();
  if (!connectionString) {
    throw new Error("Varken HYPERDRIVE eller DATABASE_URL är konfigurerad");
  }

  const adapter = new PrismaPg({ connectionString, max: 1, maxUses: 1 });

  return new PrismaClient({
    adapter,
    log: logLevels
  });
});

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, client);

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  }
}) as PrismaClient;
