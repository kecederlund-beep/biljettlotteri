import { normalizeMembershipNumber } from "@/lib/normalize";

export type MemberCheckStatus = "eligible" | "not_member" | "unknown" | "ambiguous";
export type MemberCheckMethod = "email";

export type MemberCheckInput = {
  email?: string;
};

export type MemberSnapshot = {
  contactId: string;
  membershipNumber: string | null;
  matchedBy: MemberCheckMethod;
};

export type MemberCheckResult = {
  status: MemberCheckStatus;
  reasonCode: string;
  checkedAt: string;
  memberSnapshot: MemberSnapshot | null;
};

type ItargetConfig = {
  baseUrl: string;
  clientId: string;
  token: string;
  timeoutMs: number;
  retries: number;
  cacheTtlMs: number;
  emailField: string;
};

type CacheItem = {
  expiresAt: number;
  value: MemberCheckResult;
};

type ItargetErrorCode =
  | "AUTH"
  | "TIMEOUT"
  | "SERVER"
  | "NETWORK"
  | "BAD_RESPONSE"
  | "NOT_FOUND";

class ItargetError extends Error {
  code: ItargetErrorCode;

  constructor(code: ItargetErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 7_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_CACHE_TTL_MS = 30_000;

const checkCache = new Map<string, CacheItem>();

function normalizeEmail(value: string | undefined | null) {
  return value?.trim().toLocaleLowerCase("sv-SE") || "";
}

function loadConfig(): ItargetConfig | null {
  const baseUrl = process.env.ITARGET_API_BASE?.trim() || "";
  const clientId = process.env.ITARGET_CLIENT_ID?.trim() || "";
  const token = process.env.ITARGET_TOKEN?.trim() || "";

  if (!baseUrl || !clientId || !token) {
    return null;
  }

  const timeoutMs = Number(process.env.ITARGET_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const retries = Number(process.env.ITARGET_RETRIES || DEFAULT_RETRIES);
  const cacheTtlMs = Number(process.env.ITARGET_CACHE_TTL_MS || DEFAULT_CACHE_TTL_MS);

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    clientId,
    token,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    retries: Number.isFinite(retries) && retries >= 0 ? retries : DEFAULT_RETRIES,
    cacheTtlMs: Number.isFinite(cacheTtlMs) && cacheTtlMs >= 0 ? cacheTtlMs : DEFAULT_CACHE_TTL_MS,
    emailField: process.env.ITARGET_EMAIL_FIELD?.trim() || "email"
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getFromPath(payload: unknown, path: Array<string | number>): unknown {
  let current: unknown = payload;

  for (const step of path) {
    if (typeof step === "number") {
      if (!Array.isArray(current) || step >= current.length) {
        return undefined;
      }
      current = current[step];
      continue;
    }

    if (!isObject(current) || !(step in current)) {
      return undefined;
    }

    current = current[step];
  }

  return current;
}

function pickString(payload: unknown, paths: Array<Array<string | number>>) {
  for (const path of paths) {
    const value = getFromPath(payload, path);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function pickBoolean(payload: unknown, paths: Array<Array<string | number>>) {
  for (const path of paths) {
    const value = getFromPath(payload, path);
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLocaleLowerCase("sv-SE");
      if (["true", "1", "yes", "ja", "active", "aktiv"].includes(normalized)) {
        return true;
      }
      if (["false", "0", "no", "nej", "inactive", "inaktiv"].includes(normalized)) {
        return false;
      }
    }
  }

  return null;
}

function extractContacts(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const directCandidates = [
    getFromPath(payload, ["contacts"]),
    getFromPath(payload, ["data"]),
    getFromPath(payload, ["data", "contacts"]),
    getFromPath(payload, ["results"])
  ];

  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  const singleCandidates = [
    getFromPath(payload, ["contact"]),
    getFromPath(payload, ["data", "contact"]),
    getFromPath(payload, ["result"]),
    payload
  ];

  for (const candidate of singleCandidates) {
    if (
      isObject(candidate) &&
      (typeof candidate.id === "string" ||
        typeof candidate.id === "number" ||
        typeof candidate.contact_id === "string" ||
        typeof candidate.contact_id === "number")
    ) {
      return [candidate];
    }
  }

  return [];
}

function extractContactId(contactPayload: unknown): string | null {
  const fromString = pickString(contactPayload, [
    ["id"],
    ["contact_id"],
    ["contact", "id"],
    ["contact", "contact_id"],
    ["data", "id"],
    ["data", "contact_id"],
    ["data", "contact", "id"]
  ]);

  if (fromString) {
    return fromString;
  }

  const numberCandidates = [
    getFromPath(contactPayload, ["id"]),
    getFromPath(contactPayload, ["contact_id"]),
    getFromPath(contactPayload, ["contact", "id"]),
    getFromPath(contactPayload, ["contact", "contact_id"]),
    getFromPath(contactPayload, ["data", "id"]),
    getFromPath(contactPayload, ["data", "contact_id"]),
    getFromPath(contactPayload, ["data", "contact", "id"])
  ];

  for (const candidate of numberCandidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }

  return null;
}

function extractMembershipNumber(payload: unknown): string | null {
  const raw = pickString(payload, [
    ["membership", "membership_number"],
    ["membership", "membershipNumber"],
    ["membership", "member_number"],
    ["membership", "number"],
    ["membership_number"],
    ["membershipNumber"],
    ["member_number"],
    ["memberNumber"],
    ["membership_no"],
    ["membershipNo"],
    ["member_no"],
    ["memberNo"],
    ["memberships", 0, "membership_number"],
    ["memberships", 0, "membershipNumber"],
    ["memberships", 0, "member_number"],
    ["memberships", 0, "number"],
    ["memberships", 0, "membership_no"],
    ["memberships", 0, "membershipNo"],
    ["memberships", 0, "member_no"],
    ["memberships", 0, "memberNo"]
  ]);

  if (!raw) {
    return null;
  }

  return normalizeMembershipNumber(raw) || null;
}

function extractMembershipActiveFromContact(payload: unknown): boolean | null {
  return pickBoolean(payload, [
    ["membership", "is_active"],
    ["membership", "isActive"],
    ["membership", "active"],
    ["membership", "status"],
    ["is_active"],
    ["isActive"]
  ]);
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function isMembershipRowActive(row: unknown, now: Date) {
  if (!isObject(row)) {
    return false;
  }

  const explicitFlag = pickBoolean(row, [["is_active"], ["isActive"], ["active"], ["status"]]);
  if (explicitFlag === true) {
    return true;
  }

  const startDate = parseDate(
    pickString(row, [["start"], ["start_date"], ["valid_from"], ["from"]])
  );
  const endDate = parseDate(
    pickString(row, [["end"], ["end_date"], ["valid_to"], ["to"], ["expires_at"]])
  );

  const startsOk = !startDate || startDate.getTime() <= now.getTime();
  const endsOk = !endDate || endDate.getTime() >= now.getTime();

  return startsOk && endsOk && explicitFlag !== false;
}

function extractMembershipRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const candidates = [
    getFromPath(payload, ["memberships"]),
    getFromPath(payload, ["data"]),
    getFromPath(payload, ["data", "memberships"])
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function mapUnknownReasonFromError(error: unknown) {
  if (error instanceof ItargetError) {
    if (error.code === "AUTH") {
      return "upstream_auth_error";
    }

    if (error.code === "TIMEOUT") {
      return "upstream_timeout";
    }

    if (error.code === "SERVER" || error.code === "NETWORK") {
      return "upstream_unavailable";
    }

    if (error.code === "BAD_RESPONSE") {
      return "upstream_invalid_response";
    }
  }

  return "upstream_error";
}

function buildCacheKey(input: MemberCheckInput) {
  return normalizeEmail(input.email);
}

async function itargetFetchJson(
  config: ItargetConfig,
  path: string,
  init: RequestInit & { body?: string }
) {
  const url = `${config.baseUrl}${path}`;
  let latestError: unknown = null;

  for (let attempt = 0; attempt <= config.retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
          ...(init.headers || {})
        },
        cache: "no-store",
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.status === 404) {
        throw new ItargetError("NOT_FOUND", "Not found");
      }

      if (response.status === 401 || response.status === 403) {
        throw new ItargetError("AUTH", "Unauthorized");
      }

      if (response.status === 204) {
        return null;
      }

      if (response.status >= 500 || response.status === 429) {
        if (attempt < config.retries) {
          continue;
        }
        throw new ItargetError("SERVER", `Server status ${response.status}`);
      }

      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          throw new ItargetError("NOT_FOUND", `Client status ${response.status}`);
        }
        throw new ItargetError("SERVER", `HTTP status ${response.status}`);
      }

      const text = await response.text();
      if (!text.trim()) {
        return null;
      }

      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ItargetError("BAD_RESPONSE", "Invalid JSON");
      }
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof ItargetError) {
        latestError = error;
        if (error.code === "SERVER" && attempt < config.retries) {
          continue;
        }
        throw error;
      }

      const asRecord = error as { name?: string };
      if (asRecord?.name === "AbortError") {
        latestError = new ItargetError("TIMEOUT", "Request timeout");
        if (attempt < config.retries) {
          continue;
        }
        throw latestError;
      }

      latestError = new ItargetError("NETWORK", "Network error");
      if (attempt < config.retries) {
        continue;
      }
      throw latestError;
    }
  }

  throw latestError instanceof Error ? latestError : new Error("Unknown iTarget fetch error");
}

async function findContactsByEmail(config: ItargetConfig, email: string) {
  const path = `/clients/${encodeURIComponent(config.clientId)}/contacts/findByEmail`;

  const payload = await itargetFetchJson(config, path, {
    method: "POST",
    body: JSON.stringify({
      [config.emailField]: email
    })
  });

  return extractContacts(payload);
}

async function fetchContact(config: ItargetConfig, contactId: string) {
  const path = `/clients/${encodeURIComponent(config.clientId)}/contacts/${encodeURIComponent(contactId)}`;
  return itargetFetchJson(config, path, {
    method: "GET"
  });
}

async function fetchMemberships(config: ItargetConfig, contactId: string) {
  const path = `/clients/${encodeURIComponent(config.clientId)}/contacts/${encodeURIComponent(contactId)}/memberships`;
  return itargetFetchJson(config, path, {
    method: "GET"
  });
}

function shouldCacheResult(status: MemberCheckStatus) {
  return status !== "unknown";
}

export function maskForLog(value: string | undefined | null) {
  if (!value) {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const clean = trimmed.replace(/\s+/g, "");
  if (clean.length <= 4) {
    return "*".repeat(clean.length);
  }

  return `${"*".repeat(Math.max(0, clean.length - 4))}${clean.slice(-4)}`;
}

export async function checkMemberEligibility(input: MemberCheckInput): Promise<MemberCheckResult> {
  const checkedAt = new Date().toISOString();
  const normalizedEmail = normalizeEmail(input.email);
  const cacheKey = buildCacheKey(input);
  const cached = checkCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const config = loadConfig();

  if (!config) {
    return {
      status: "unknown",
      reasonCode: "config_missing",
      checkedAt,
      memberSnapshot: null
    };
  }

  if (!normalizedEmail) {
    return {
      status: "unknown",
      reasonCode: "missing_email",
      checkedAt,
      memberSnapshot: null
    };
  }

  let contacts: unknown[] = [];

  try {
    contacts = await findContactsByEmail(config, normalizedEmail);
  } catch (error) {
    if (!(error instanceof ItargetError && error.code === "NOT_FOUND")) {
      return {
        status: "unknown",
        reasonCode: mapUnknownReasonFromError(error),
        checkedAt,
        memberSnapshot: null
      };
    }
  }

  if (contacts.length > 1) {
    return {
      status: "ambiguous",
      reasonCode: "multiple_contacts",
      checkedAt,
      memberSnapshot: null
    };
  }

  if (contacts.length === 0) {
    const result: MemberCheckResult = {
      status: "not_member",
      reasonCode: "no_contact_match",
      checkedAt,
      memberSnapshot: null
    };

    if (shouldCacheResult(result.status)) {
      checkCache.set(cacheKey, {
        value: result,
        expiresAt: Date.now() + config.cacheTtlMs
      });
    }

    return result;
  }

  const contactId = extractContactId(contacts[0]);
  if (!contactId) {
    return {
      status: "unknown",
      reasonCode: "upstream_invalid_response",
      checkedAt,
      memberSnapshot: null
    };
  }

  let contactPayload: unknown;
  try {
    contactPayload = await fetchContact(config, contactId);
  } catch (error) {
    return {
      status: "unknown",
      reasonCode: mapUnknownReasonFromError(error),
      checkedAt,
      memberSnapshot: null
    };
  }

  const membershipNumberFromContact = extractMembershipNumber(contactPayload);
  const activeFromContact = extractMembershipActiveFromContact(contactPayload);
  const snapshot: MemberSnapshot = {
    contactId,
    membershipNumber: membershipNumberFromContact,
    matchedBy: "email"
  };

  let membershipPayload: unknown;
  try {
    membershipPayload = await fetchMemberships(config, contactId);
  } catch (error) {
    return {
      status: "unknown",
      reasonCode: mapUnknownReasonFromError(error),
      checkedAt,
      memberSnapshot: null
    };
  }

  const membershipRows = extractMembershipRows(membershipPayload);
  const now = new Date();
  const hasActiveMembership =
    activeFromContact === true || membershipRows.some((row) => isMembershipRowActive(row, now));
  const membershipNumberFromList = extractMembershipNumber(membershipPayload);
  const canonicalSnapshot: MemberSnapshot = {
    ...snapshot,
    membershipNumber: membershipNumberFromList || snapshot.membershipNumber || null
  };

  const result: MemberCheckResult = hasActiveMembership
    ? {
        status: "eligible",
        reasonCode: activeFromContact === true ? "active_membership" : "active_membership_window",
        checkedAt,
        memberSnapshot: canonicalSnapshot
      }
    : {
        status: "not_member",
        reasonCode: "inactive_or_missing_membership",
        checkedAt,
        memberSnapshot: canonicalSnapshot
      };

  if (shouldCacheResult(result.status)) {
    checkCache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + config.cacheTtlMs
    });
  }

  return result;
}

export function getMembershipSignupUrl() {
  return process.env.MEMBERSHIP_SIGNUP_URL?.trim() || "https://luleahockey.propublik.se/medlem";
}
