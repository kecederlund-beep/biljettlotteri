import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

function hasValue(value: unknown) {
  return typeof value === "string" ? value.length > 0 : Boolean(value);
}

export async function GET() {
  let hyperdrivePresent = false;
  let hyperdriveKeys: string[] = [];
  let contextAvailable = false;

  try {
    const { env } = getCloudflareContext();
    contextAvailable = true;
    const hyperdrive = (env as { HYPERDRIVE?: Record<string, unknown> }).HYPERDRIVE;
    hyperdrivePresent = Boolean(hyperdrive);
    if (hyperdrive && typeof hyperdrive === "object") {
      hyperdriveKeys = Object.keys(hyperdrive);
    }
  } catch {
    contextAvailable = false;
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    build: {
      commit: process.env.CF_PAGES_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "unknown"
    },
    env: {
      hasDatabaseUrl: hasValue(process.env.DATABASE_URL),
      hasDirectUrl: hasValue(process.env.DIRECT_URL),
      hasAdminPassword: hasValue(process.env.ADMIN_PASSWORD),
      hasAdminSessionSecret: hasValue(process.env.ADMIN_SESSION_SECRET),
      hasITargetToken: hasValue(process.env.ITARGET_TOKEN)
    },
    cloudflare: {
      contextAvailable,
      hyperdrivePresent,
      hyperdriveKeys
    }
  });
}
