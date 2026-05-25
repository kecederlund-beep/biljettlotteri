import Link from "next/link";
import { redirect } from "next/navigation";

import { loginAction } from "@/app/admin/login/actions";
import { isAdminLoggedIn } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: Promise<{ error?: string }>;
};

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  if (await isAdminLoggedIn()) {
    redirect("/admin");
  }

  const params = (await searchParams) || {};

  return (
    <main>
      <div className="container" style={{ maxWidth: 520 }}>
        <section className="card grid" style={{ gap: 16 }}>
          <span className="badge">Admin</span>
          <h1>Logga in</h1>
          <p>Ange adminlösenord för att hantera lotterier, synk och dragning.</p>

          {params.error ? <p className="status error">Fel lösenord. Försök igen.</p> : null}

          <form className="grid" action={loginAction}>
            <label>
              <span className="label">Lösenord</span>
              <input className="input" type="password" name="password" required />
            </label>
            <button className="button" type="submit">
              Logga in
            </button>
          </form>

          <Link href="/" className="button secondary">
            Till startsidan
          </Link>
        </section>
      </div>
    </main>
  );
}
