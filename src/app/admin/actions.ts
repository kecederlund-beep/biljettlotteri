"use server";

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";

import { ensureAdmin } from "@/lib/admin-session";
import { drawWinnersForRaffle } from "@/lib/draw";
import { syncMembershipRegistryFromSheets, updateMembershipSourceConfig } from "@/lib/google-sheets";
import { normalizeSlug } from "@/lib/normalize";
import { prisma } from "@/lib/prisma";
import { RAFFLE_STATUS, type RaffleStatus, VERIFICATION_STATUS } from "@/lib/statuses";

const LOGO_UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "raffle-logos");

function parseDateTimeLocal(value: string, fieldLabel: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldLabel} har ogiltigt datumformat`);
  }

  return date;
}

function resolveFileExtension(file: File) {
  const fromMime = file.type.split("/")[1];
  if (fromMime) {
    return fromMime.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "png";
  }

  const fromName = file.name.split(".").pop();
  return fromName?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "png";
}

function isManagedLogoPath(url: string | null | undefined) {
  return Boolean(url && url.startsWith("/uploads/raffle-logos/"));
}

async function deleteManagedLogoFile(url: string | null | undefined) {
  if (!isManagedLogoPath(url)) {
    return;
  }

  const relativePath = String(url).replace(/^\/+/, "");
  const absolutePath = path.join(process.cwd(), relativePath);

  await fs.unlink(absolutePath).catch(() => undefined);
}

async function uploadLogoFile(file: File, prefix: "home" | "away") {
  if (!file.type.startsWith("image/")) {
    throw new Error("Endast bildfiler stöds för logotyper");
  }

  if (file.size > 8 * 1024 * 1024) {
    throw new Error("Logotypfilen är för stor (max 8 MB)");
  }

  await fs.mkdir(LOGO_UPLOAD_DIR, { recursive: true });

  const extension = resolveFileExtension(file);
  const filename = `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const absolutePath = path.join(LOGO_UPLOAD_DIR, filename);

  await fs.writeFile(absolutePath, buffer);

  return `/uploads/raffle-logos/${filename}`;
}

function isUniqueSlugError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code !== "P2002") {
    return false;
  }

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.includes("slug");
  }

  return target === "slug";
}

async function findAvailableRaffleSlug(baseSlug: string) {
  const existing = await prisma.raffle.findMany({
    where: {
      slug: {
        startsWith: baseSlug
      }
    },
    select: {
      slug: true
    }
  });

  const usedSlugs = new Set(existing.map((item) => item.slug));
  if (!usedSlugs.has(baseSlug)) {
    return baseSlug;
  }

  let suffix = 2;
  while (usedSlugs.has(`${baseSlug}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseSlug}-${suffix}`;
}

function mapCreateRaffleError(error: unknown) {
  if (isUniqueSlugError(error)) {
    return "Ett lotteri med liknande adress finns redan. Ange en unik slug och försök igen.";
  }

  if (error instanceof Error) {
    const lowered = error.message.toLocaleLowerCase("sv-SE");

    if (
      lowered.includes("read-only file system") ||
      lowered.includes("erofs") ||
      lowered.includes("eacces") ||
      lowered.includes("eperm")
    ) {
      return "Filuppladdning av logotyper stöds inte i denna driftmiljö just nu. Använd logotyp-URL.";
    }

    return error.message;
  }

  return "Kunde inte skapa lotteriet just nu. Försök igen.";
}

export async function upsertSheetsConfigAction(formData: FormData) {
  await ensureAdmin();

  const sheetId = String(formData.get("sheetId") ?? "");
  const sheetTab = String(formData.get("sheetTab") ?? "");
  const apiKey = String(formData.get("apiKey") ?? "");

  await updateMembershipSourceConfig({ sheetId, sheetTab, apiKey });

  revalidatePath("/admin");
  redirect("/admin?saved=1");
}

export async function syncRegistryAction() {
  await ensureAdmin();

  await syncMembershipRegistryFromSheets();

  revalidatePath("/admin");
  redirect("/admin?synced=1");
}

export async function createRaffleAction(formData: FormData) {
  await ensureAdmin();

  try {
    const matchName = String(formData.get("matchName") ?? "").trim();
    const logoUrl = String(formData.get("logoUrl") ?? "").trim();
    const homeLogoUrlInput = String(formData.get("homeLogoUrl") ?? "").trim();
    const awayLogoUrlInput = String(formData.get("awayLogoUrl") ?? "").trim();
    const homeLogoFileInput = formData.get("homeLogoFile");
    const awayLogoFileInput = formData.get("awayLogoFile");
    const matchDate = String(formData.get("matchDate") ?? "").trim();
    const arena = String(formData.get("arena") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const openAt = String(formData.get("openAt") ?? "").trim();
    const closeAt = String(formData.get("closeAt") ?? "").trim();
    const drawAt = String(formData.get("drawAt") ?? "").trim();
    const numberOfWinners = Number(formData.get("numberOfWinners") ?? 1);
    const statusInput = String(formData.get("status") ?? "DRAFT");
    const explicitSlug = String(formData.get("slug") ?? "").trim();

    if (!matchName || !openAt || !closeAt || !drawAt || !matchDate) {
      throw new Error("Saknade fält vid skapande av lotteri");
    }

    if (!Object.values(RAFFLE_STATUS).includes(statusInput as RaffleStatus)) {
      throw new Error("Ogiltig status");
    }

    const parsedOpen = parseDateTimeLocal(openAt, "Öppningstid");
    const parsedClose = parseDateTimeLocal(closeAt, "Stängningstid");
    const parsedDraw = parseDateTimeLocal(drawAt, "Dragningstid");
    const parsedMatchDate = parseDateTimeLocal(matchDate, "Matchdatum");

    if (parsedClose <= parsedOpen) {
      throw new Error("Stängningstid måste vara efter öppningstid");
    }

    if (parsedDraw < parsedClose) {
      throw new Error("Dragningstid måste vara efter eller lika med stängningstid");
    }

    const slugBase = normalizeSlug(explicitSlug || matchName);

    if (!slugBase) {
      throw new Error("Kunde inte skapa slug");
    }

    const hasHomeLogoUpload = homeLogoFileInput instanceof File && homeLogoFileInput.size > 0;
    const hasAwayLogoUpload = awayLogoFileInput instanceof File && awayLogoFileInput.size > 0;

    const homeLogoUrl = hasHomeLogoUpload
      ? await uploadLogoFile(homeLogoFileInput, "home")
      : homeLogoUrlInput || null;
    const awayLogoUrl = hasAwayLogoUpload
      ? await uploadLogoFile(awayLogoFileInput, "away")
      : awayLogoUrlInput || null;

    let slug = await findAvailableRaffleSlug(slugBase);

    const raffle = await (async () => {
      try {
        return await prisma.raffle.create({
          data: {
            slug,
            matchName,
            logoUrl: logoUrl || null,
            homeLogoUrl,
            awayLogoUrl,
            matchDate: parsedMatchDate,
            arena: arena || null,
            description: description || null,
            openAt: parsedOpen,
            closeAt: parsedClose,
            drawAt: parsedDraw,
            numberOfWinners: Math.max(1, Math.floor(numberOfWinners || 1)),
            status: statusInput as RaffleStatus
          }
        });
      } catch (error) {
        if (!isUniqueSlugError(error)) {
          throw error;
        }

        // Safety retry if another admin created a raffle with the same slug at the same time.
        slug = await findAvailableRaffleSlug(slugBase);

        return prisma.raffle.create({
          data: {
            slug,
            matchName,
            logoUrl: logoUrl || null,
            homeLogoUrl,
            awayLogoUrl,
            matchDate: parsedMatchDate,
            arena: arena || null,
            description: description || null,
            openAt: parsedOpen,
            closeAt: parsedClose,
            drawAt: parsedDraw,
            numberOfWinners: Math.max(1, Math.floor(numberOfWinners || 1)),
            status: statusInput as RaffleStatus
          }
        });
      }
    })();

    await prisma.adminAuditLog.create({
      data: {
        action: "raffle.create",
        raffleId: raffle.id,
        details: `Skapade lotteri ${raffle.slug}`,
        actor: "admin"
      }
    });

    revalidatePath("/admin");
    revalidatePath("/");
    revalidatePath(`/raffles/${slug}`);
    redirect("/admin?created=1");
  } catch (error) {
    const message = mapCreateRaffleError(error);
    redirect(`/admin?error=${encodeURIComponent(message)}`);
  }
}

export async function updateRaffleLogosAction(formData: FormData) {
  await ensureAdmin();

  const raffleId = String(formData.get("raffleId") ?? "").trim();
  const homeLogoUrlInput = String(formData.get("homeLogoUrl") ?? "").trim();
  const awayLogoUrlInput = String(formData.get("awayLogoUrl") ?? "").trim();
  const homeLogoFileInput = formData.get("homeLogoFile");
  const awayLogoFileInput = formData.get("awayLogoFile");
  const removeHomeLogo = String(formData.get("removeHomeLogo") ?? "") === "on";
  const removeAwayLogo = String(formData.get("removeAwayLogo") ?? "") === "on";

  if (!raffleId) {
    throw new Error("Saknar raffleId");
  }

  const raffle = await prisma.raffle.findUnique({
    where: { id: raffleId },
    select: {
      homeLogoUrl: true,
      awayLogoUrl: true,
      slug: true
    }
  });

  if (!raffle) {
    throw new Error("Lotteriet hittades inte");
  }

  const hasHomeLogoUpload = homeLogoFileInput instanceof File && homeLogoFileInput.size > 0;
  const hasAwayLogoUpload = awayLogoFileInput instanceof File && awayLogoFileInput.size > 0;

  let nextHomeLogo = raffle.homeLogoUrl;
  let nextAwayLogo = raffle.awayLogoUrl;

  if (hasHomeLogoUpload) {
    nextHomeLogo = await uploadLogoFile(homeLogoFileInput, "home");
  } else if (removeHomeLogo) {
    nextHomeLogo = null;
  } else if (homeLogoUrlInput !== (raffle.homeLogoUrl || "")) {
    nextHomeLogo = homeLogoUrlInput || null;
  }

  if (hasAwayLogoUpload) {
    nextAwayLogo = await uploadLogoFile(awayLogoFileInput, "away");
  } else if (removeAwayLogo) {
    nextAwayLogo = null;
  } else if (awayLogoUrlInput !== (raffle.awayLogoUrl || "")) {
    nextAwayLogo = awayLogoUrlInput || null;
  }

  const previousHomeLogo = raffle.homeLogoUrl;
  const previousAwayLogo = raffle.awayLogoUrl;

  const updatedRaffle = await prisma.raffle.update({
    where: { id: raffleId },
    data: {
      homeLogoUrl: nextHomeLogo,
      awayLogoUrl: nextAwayLogo
    },
    select: {
      slug: true
    }
  });

  if (previousHomeLogo !== nextHomeLogo) {
    await deleteManagedLogoFile(previousHomeLogo);
  }

  if (previousAwayLogo !== nextAwayLogo) {
    await deleteManagedLogoFile(previousAwayLogo);
  }

  await prisma.adminAuditLog.create({
    data: {
      action: "raffle.update_logos",
      raffleId,
      details: "Uppdaterade hemmalag/bortalag-logotyper",
      actor: "admin"
    }
  });

  revalidatePath("/admin");
  revalidatePath(`/raffles/${updatedRaffle.slug}`);
}

export async function setRaffleStatusAction(formData: FormData) {
  await ensureAdmin();

  const raffleId = String(formData.get("raffleId") ?? "");
  const statusInput = String(formData.get("status") ?? "");

  if (!raffleId || !Object.values(RAFFLE_STATUS).includes(statusInput as RaffleStatus)) {
    throw new Error("Felaktiga statusparametrar");
  }

  const raffle = await prisma.raffle.findUnique({
    where: { id: raffleId },
    select: {
      closeAt: true,
      openAt: true,
      drawAt: true,
      slug: true
    }
  });

  if (!raffle) {
    throw new Error("Lotteriet hittades inte");
  }

  const now = new Date();

  const data: { status: RaffleStatus; closeAt?: Date; openAt?: Date; drawAt?: Date } = {
    status: statusInput as RaffleStatus
  };

  if (statusInput === RAFFLE_STATUS.CLOSED) {
    data.closeAt = now;
  }

  if (statusInput === RAFFLE_STATUS.ACTIVE) {
    data.openAt = raffle.openAt > now ? raffle.openAt : now;

    if (raffle.closeAt <= now) {
      const fallbackCloseAt =
        raffle.drawAt > now ? raffle.drawAt : new Date(now.getTime() + 60 * 60 * 1000);
      data.closeAt = fallbackCloseAt;

      if (raffle.drawAt <= fallbackCloseAt) {
        data.drawAt = new Date(fallbackCloseAt.getTime() + 60 * 60 * 1000);
      }
    }
  }

  const updated = await prisma.raffle.update({
    where: { id: raffleId },
    data
  });

  await prisma.adminAuditLog.create({
    data: {
      action: "raffle.status",
      raffleId,
      details: `Satte status till ${statusInput}`,
      actor: "admin"
    }
  });

  revalidatePath("/admin");
  revalidatePath(`/raffles/${updated.slug}`);
}

export async function setRaffleWinnersCountAction(formData: FormData) {
  await ensureAdmin();

  const raffleId = String(formData.get("raffleId") ?? "");
  const winnersCountInput = Number(formData.get("numberOfWinners") ?? 1);

  if (!raffleId) {
    throw new Error("Saknar raffleId");
  }

  const numberOfWinners = Math.max(1, Math.floor(Number.isFinite(winnersCountInput) ? winnersCountInput : 1));

  const raffle = await prisma.raffle.update({
    where: { id: raffleId },
    data: {
      numberOfWinners
    },
    select: {
      slug: true
    }
  });

  await prisma.adminAuditLog.create({
    data: {
      action: "raffle.winners_count",
      raffleId,
      details: `Satte antal vinnare till ${numberOfWinners}`,
      actor: "admin"
    }
  });

  revalidatePath("/admin");
  revalidatePath(`/raffles/${raffle.slug}`);
}

export async function closeRaffleNowAction(formData: FormData) {
  await ensureAdmin();

  const raffleId = String(formData.get("raffleId") ?? "");
  if (!raffleId) {
    throw new Error("Saknar raffleId");
  }

  const raffle = await prisma.raffle.update({
    where: { id: raffleId },
    data: {
      status: RAFFLE_STATUS.CLOSED,
      closeAt: new Date()
    }
  });

  await prisma.adminAuditLog.create({
    data: {
      action: "raffle.manual_close",
      raffleId,
      details: "Manuellt stängde lotteriet",
      actor: "admin"
    }
  });

  revalidatePath("/admin");
  revalidatePath(`/raffles/${raffle.slug}`);
}

export async function drawWinnersAction(formData: FormData) {
  await ensureAdmin();

  const raffleId = String(formData.get("raffleId") ?? "");
  if (!raffleId) {
    throw new Error("Saknar raffleId");
  }

  const result = await drawWinnersForRaffle(raffleId, "admin");

  await prisma.adminAuditLog.create({
    data: {
      action: "raffle.draw.summary",
      raffleId,
      details: `Drog ${result.winners.length} vinnare`,
      actor: "admin"
    }
  });

  const raffle = await prisma.raffle.findUnique({
    where: { id: raffleId },
    select: { slug: true }
  });

  revalidatePath("/admin");
  if (raffle?.slug) {
    revalidatePath(`/raffles/${raffle.slug}`);
  }
}

export async function publishWinnersAction(formData: FormData) {
  await ensureAdmin();

  const raffleId = String(formData.get("raffleId") ?? "");
  if (!raffleId) {
    throw new Error("Saknar raffleId");
  }

  const now = new Date();

  const raffle = await prisma.raffle.update({
    where: { id: raffleId },
    data: {
      status: RAFFLE_STATUS.RESOLVED,
      winnersPublicVisible: true,
      winners: {
        updateMany: {
          where: {
            raffleId,
            publishedAt: null
          },
          data: {
            publishedAt: now
          }
        }
      }
    },
    select: {
      slug: true
    }
  });

  await prisma.adminAuditLog.create({
    data: {
      action: "raffle.publish_winners",
      raffleId,
      details: "Publicerade vinnare",
      actor: "admin"
    }
  });

  revalidatePath("/admin");
  revalidatePath(`/raffles/${raffle.slug}`);
}

export async function deleteRaffleAction(formData: FormData) {
  await ensureAdmin();

  const raffleId = String(formData.get("raffleId") ?? "");
  if (!raffleId) {
    throw new Error("Saknar raffleId");
  }

  const raffle = await prisma.raffle.findUnique({
    where: { id: raffleId },
    select: {
      slug: true,
      matchName: true,
      homeLogoUrl: true,
      awayLogoUrl: true
    }
  });

  if (!raffle) {
    return;
  }

  await prisma.raffle.delete({
    where: { id: raffleId }
  });

  await deleteManagedLogoFile(raffle.homeLogoUrl);
  await deleteManagedLogoFile(raffle.awayLogoUrl);

  await prisma.adminAuditLog.create({
    data: {
      action: "raffle.delete",
      details: `Raderade lotteri ${raffle.matchName}`,
      actor: "admin"
    }
  });

  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/raffles/${raffle.slug}`);
}

export async function invalidateEntryAction(formData: FormData) {
  await ensureAdmin();

  const entryId = String(formData.get("entryId") ?? "");
  if (!entryId) {
    throw new Error("Saknar entryId");
  }

  const entry = await prisma.raffleEntry.update({
    where: {
      id: entryId
    },
    data: {
      verificationStatus: VERIFICATION_STATUS.MANUAL_INVALID
    },
    select: {
      raffleId: true,
      raffle: {
        select: {
          slug: true
        }
      }
    }
  });

  await prisma.adminAuditLog.create({
    data: {
      action: "entry.invalidate",
      raffleId: entry.raffleId,
      details: `Markerade ogiltig post: ${entryId}`,
      actor: "admin"
    }
  });

  revalidatePath(`/admin/raffles/${entry.raffleId}`);
  revalidatePath(`/raffles/${entry.raffle.slug}`);
}

export async function deleteEntryAction(formData: FormData) {
  await ensureAdmin();

  const entryId = String(formData.get("entryId") ?? "");
  if (!entryId) {
    throw new Error("Saknar entryId");
  }

  const entry = await prisma.raffleEntry.findUnique({
    where: { id: entryId },
    select: {
      raffleId: true,
      raffle: {
        select: {
          slug: true
        }
      }
    }
  });

  if (!entry) {
    return;
  }

  await prisma.raffleEntry.delete({
    where: { id: entryId }
  });

  await prisma.adminAuditLog.create({
    data: {
      action: "entry.delete",
      raffleId: entry.raffleId,
      details: `Raderade deltagarpost ${entryId}`,
      actor: "admin"
    }
  });

  revalidatePath(`/admin/raffles/${entry.raffleId}`);
  revalidatePath(`/raffles/${entry.raffle.slug}`);
}
