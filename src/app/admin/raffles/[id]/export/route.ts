import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { ADMIN_COOKIE_NAME, isAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function toCsvCell(value: string | number | null) {
  const normalized = value == null ? "" : String(value);
  return `"${normalized.replaceAll("\"", '""')}"`;
}

export async function GET(
  _: Request,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;

  if (!isAdminSession(token)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await context.params;

  const raffle = await prisma.raffle.findUnique({
    where: {
      id
    },
    include: {
      entries: {
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });

  if (!raffle) {
    return new NextResponse("Not found", { status: 404 });
  }

  const rows = [
    [
      "submitted_email",
      "membership_number",
      "verification_status",
      "verification_match_reason",
      "created_at"
    ],
    ...raffle.entries.map((entry) => [
      entry.submittedEmail,
      entry.membershipNumber,
      entry.verificationStatus,
      entry.verificationMatchReason,
      entry.createdAt.toISOString()
    ])
  ];

  const csv = rows.map((row) => row.map((cell) => toCsvCell(cell)).join(",")).join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="raffle-${raffle.slug}-entries.csv"`
    }
  });
}
