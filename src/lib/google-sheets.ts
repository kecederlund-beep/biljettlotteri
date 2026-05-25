import { extractPhoneLast7, normalizeLastName, normalizeMembershipNumber } from "@/lib/normalize";
import { prisma } from "@/lib/prisma";
import { MEMBERSHIP_STATUS, type MembershipStatus } from "@/lib/statuses";

type MembershipSourceConfigInput = {
  sheetId: string;
  sheetTab: string;
  apiKey?: string;
};

type ParsedMember = {
  membershipNumber: string;
  lastName: string;
  phoneLast7: string;
  status: MembershipStatus;
};

const headerAliases = {
  membershipNumber: [
    "medlemsnummer",
    "medlemsnr",
    "medlemnr",
    "medlemsid",
    "membershipnumber",
    "membership_number",
    "membershipnr",
    "membershipno",
    "memberid"
  ],
  lastName: ["efternamn", "lastname", "last_name", "surname", "familjenamn"],
  phone: [
    "telefonnummer",
    "telefon",
    "telefonnr",
    "mobil",
    "mobilnummer",
    "phone",
    "phone_number",
    "phonenumber",
    "tel"
  ],
  status: ["status", "medlemsstatus", "medlemstatus", "membershipstatus", "active", "aktiv"]
};

function normalizeHeader(value: string) {
  const withoutBom = value.replace(/\uFEFF/g, "").trim();
  const lowered = withoutBom.toLocaleLowerCase("sv-SE");

  const withoutDiacritics = lowered
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("å", "a")
    .replaceAll("ä", "a")
    .replaceAll("ö", "o");

  return withoutDiacritics.replace(/[^a-z0-9]/g, "");
}

function detectStatus(value: string, statusColumnExists: boolean): MembershipStatus {
  if (!statusColumnExists) {
    return MEMBERSHIP_STATUS.ACTIVE;
  }

  const normalized = value.trim().toLocaleLowerCase("sv-SE");

  if (["active", "aktiv", "1", "true", "ja", "yes"].includes(normalized)) {
    return MEMBERSHIP_STATUS.ACTIVE;
  }

  if (["inactive", "inaktiv", "0", "false", "nej", "no"].includes(normalized)) {
    return MEMBERSHIP_STATUS.INACTIVE;
  }

  return MEMBERSHIP_STATUS.UNKNOWN;
}

function findHeaderIndex(headers: string[], candidates: string[]) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const normalizedCandidates = candidates.map(normalizeHeader);

  const exactIndex = normalizedHeaders.findIndex((header) =>
    normalizedCandidates.includes(header)
  );

  if (exactIndex >= 0) {
    return exactIndex;
  }

  return normalizedHeaders.findIndex((header) =>
    normalizedCandidates.some((candidate) => header.includes(candidate))
  );
}

function detectHeaderRow(rows: string[][]) {
  const scanLimit = Math.min(rows.length, 5);
  let bestRowIndex = 0;
  let bestScore = -1;

  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const headers = rows[rowIndex].map((value) => value?.toString() ?? "");

    const membershipScore = findHeaderIndex(headers, headerAliases.membershipNumber) >= 0 ? 1 : 0;
    const lastNameScore = findHeaderIndex(headers, headerAliases.lastName) >= 0 ? 1 : 0;
    const phoneScore = findHeaderIndex(headers, headerAliases.phone) >= 0 ? 1 : 0;
    const statusScore = findHeaderIndex(headers, headerAliases.status) >= 0 ? 0.3 : 0;
    const total = membershipScore + lastNameScore + phoneScore + statusScore;

    if (total > bestScore) {
      bestScore = total;
      bestRowIndex = rowIndex;
    }
  }

  return bestRowIndex;
}

function buildMissingHeadersError(headers: string[]) {
  const listedHeaders = headers
    .map((header) => header.trim())
    .filter(Boolean)
    .join(", ");

  const foundHeaders = listedHeaders || "(inga rubriker hittades)";

  return new Error(
    `Saknar obligatoriska kolumner. Krav: medlemsnummer, efternamn, telefonnummer. Hittade: ${foundHeaders}`
  );
}

async function fetchSheetRows({ sheetId, sheetTab, apiKey }: MembershipSourceConfigInput) {
  if (apiKey) {
    const encodedRange = encodeURIComponent(`${sheetTab}!A:Z`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodedRange}?key=${apiKey}`;

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Google Sheets API svarade med ${response.status}`);
    }

    const payload = (await response.json()) as { values?: string[][] };
    return payload.values ?? [];
  }

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetTab)}`;
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Google Sheets gviz svarade med ${response.status}`);
  }

  const body = await response.text();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error("Kunde inte tolka Google Sheets-svar");
  }

  const json = JSON.parse(body.slice(start, end + 1)) as {
    table?: {
      cols?: Array<{ label?: string }>;
      rows?: Array<{ c?: Array<{ v?: string | number | null } | null> }>;
    };
  };

  const cols = json.table?.cols ?? [];
  const rows = json.table?.rows ?? [];

  const header = cols.map((col) => (col.label || "").trim());
  const values = rows.map((row) =>
    (row.c ?? []).map((cell) => {
      const value = cell?.v;
      return value == null ? "" : String(value);
    })
  );

  return [header, ...values];
}

function parseMembers(rows: string[][]) {
  if (rows.length < 2) {
    throw new Error("Google Sheet saknar data-rader");
  }

  const headerRowIndex = detectHeaderRow(rows);
  const headers = rows[headerRowIndex].map((value) => value?.toString() ?? "");
  const dataRows = rows.slice(headerRowIndex + 1);

  const membershipIndex = findHeaderIndex(headers, headerAliases.membershipNumber);
  const lastNameIndex = findHeaderIndex(headers, headerAliases.lastName);
  const phoneIndex = findHeaderIndex(headers, headerAliases.phone);
  const statusIndex = findHeaderIndex(headers, headerAliases.status);

  if (membershipIndex === -1 || lastNameIndex === -1 || phoneIndex === -1) {
    throw buildMissingHeadersError(headers);
  }

  const statusColumnExists = statusIndex >= 0;
  const parsed: ParsedMember[] = [];

  for (const row of dataRows) {
    const membershipNumber = normalizeMembershipNumber(row[membershipIndex] ?? "");
    const lastName = normalizeLastName(row[lastNameIndex] ?? "");
    const phoneLast7 = extractPhoneLast7(row[phoneIndex] ?? "");

    if (!membershipNumber || !lastName || phoneLast7.length !== 7) {
      continue;
    }

    const statusRaw = statusIndex >= 0 ? row[statusIndex] ?? "" : "";

    parsed.push({
      membershipNumber,
      lastName,
      phoneLast7,
      status: detectStatus(statusRaw, statusColumnExists)
    });
  }

  return parsed;
}

export async function getMembershipSourceConfig() {
  return prisma.membershipSourceConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      sheetTab: process.env.GOOGLE_SHEETS_TAB || "Medlemmar",
      sheetId: process.env.GOOGLE_SHEETS_ID || null,
      apiKey: process.env.GOOGLE_SHEETS_API_KEY || null
    }
  });
}

export async function updateMembershipSourceConfig(values: {
  sheetId: string;
  sheetTab: string;
  apiKey?: string;
}) {
  const normalizedSheetId = values.sheetId.trim();
  const normalizedSheetTab = values.sheetTab.trim();
  const normalizedApiKey = values.apiKey?.trim() || null;

  if (!normalizedSheetId || !normalizedSheetTab) {
    throw new Error("Sheet ID och bladnamn är obligatoriska");
  }

  return prisma.membershipSourceConfig.upsert({
    where: { id: 1 },
    update: {
      sheetId: normalizedSheetId,
      sheetTab: normalizedSheetTab,
      apiKey: normalizedApiKey
    },
    create: {
      id: 1,
      sheetId: normalizedSheetId,
      sheetTab: normalizedSheetTab,
      apiKey: normalizedApiKey
    }
  });
}

export async function syncMembershipRegistryFromSheets() {
  const config = await getMembershipSourceConfig();

  const sheetId = config.sheetId || process.env.GOOGLE_SHEETS_ID || "";
  const sheetTab = config.sheetTab || process.env.GOOGLE_SHEETS_TAB || "";
  const apiKey = config.apiKey || process.env.GOOGLE_SHEETS_API_KEY || "";

  if (!sheetId || !sheetTab) {
    throw new Error("Google Sheets är inte konfigurerat i adminpanelen");
  }

  try {
    const rows = await fetchSheetRows({ sheetId, sheetTab, apiKey });
    const members = parseMembers(rows);

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      for (const member of members) {
        await tx.membershipRegistry.upsert({
          where: { membershipNumber: member.membershipNumber },
          update: {
            lastName: member.lastName,
            phoneLast7: member.phoneLast7,
            status: member.status,
            sourceUpdatedAt: now
          },
          create: {
            membershipNumber: member.membershipNumber,
            lastName: member.lastName,
            phoneLast7: member.phoneLast7,
            status: member.status,
            sourceUpdatedAt: now
          }
        });
      }

      await tx.membershipSourceConfig.upsert({
        where: { id: 1 },
        update: {
          lastSyncAt: now,
          lastSyncStatus: "OK",
          lastImportedCount: members.length,
          sheetId,
          sheetTab,
          apiKey: apiKey || null
        },
        create: {
          id: 1,
          lastSyncAt: now,
          lastSyncStatus: "OK",
          lastImportedCount: members.length,
          sheetId,
          sheetTab,
          apiKey: apiKey || null
        }
      });

      await tx.adminAuditLog.create({
        data: {
          action: "registry.sync",
          details: `Synkade ${members.length} medlemmar`,
          actor: "admin"
        }
      });
    });

    return {
      importedCount: members.length,
      syncedAt: now
    };
  } catch (error) {
    const now = new Date();
    await prisma.membershipSourceConfig.upsert({
      where: { id: 1 },
      update: {
        lastSyncAt: now,
        lastSyncStatus: `ERROR: ${error instanceof Error ? error.message : "okänt fel"}`
      },
      create: {
        id: 1,
        lastSyncAt: now,
        lastSyncStatus: `ERROR: ${error instanceof Error ? error.message : "okänt fel"}`
      }
    });

    throw error;
  }
}
