export function normalizeMembershipNumber(value: string) {
  return value.replace(/\s+/g, "").trim();
}

export function normalizeLastName(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("sv-SE");
}

export function extractPhoneLast7(value: string) {
  const digits = value.replace(/\D+/g, "");
  if (digits.length < 7) {
    return "";
  }

  return digits.slice(-7);
}

export function normalizeSlug(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("sv-SE")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function parseBooleanString(value: string | undefined | null) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLocaleLowerCase("sv-SE");
  return ["1", "true", "yes", "ja", "active", "aktiv"].includes(normalized);
}
