import { createHash, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE_NAME = "lh_admin_session";

function buildSecret() {
  const fallback = "local-dev-secret";
  const source = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || fallback;
  return createHash("sha256").update(source).digest("hex");
}

export function expectedAdminSessionToken() {
  return createHash("sha256").update(`session:${buildSecret()}`).digest("hex");
}

export function isValidAdminPassword(input: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return false;
  }

  const left = Buffer.from(input);
  const right = Buffer.from(expected);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function isAdminSession(token: string | undefined) {
  if (!token) {
    return false;
  }

  const expected = expectedAdminSessionToken();
  const left = Buffer.from(token);
  const right = Buffer.from(expected);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}
