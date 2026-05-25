import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_COOKIE_NAME, isAdminSession } from "@/lib/auth";

export async function isAdminLoggedIn() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  return isAdminSession(token);
}

export async function ensureAdmin() {
  const loggedIn = await isAdminLoggedIn();
  if (!loggedIn) {
    redirect("/admin/login");
  }
}
