import Link from "next/link";

import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { closeExpiredRaffles } from "@/lib/raffle";
import { resolveRaffleState } from "@/lib/raffle-state";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await closeExpiredRaffles();

  const raffles = await prisma.raffle.findMany({
    orderBy: {
      matchDate: "asc"
    },
    take: 20
  });

  return (
    <main>
      <div className="container grid" style={{ gap: 20 }}>
        <section className="card hero">
          <div className="grid" style={{ gap: 12 }}>
            <span className="badge">Luleå Hockey Medlemslotteri</span>
            <h1>Biljettlotteri</h1>
            <p>
              Här finns aktuella lotterier för utvalda matcher. Endast verifierade medlemmar kan
              anmäla sig.
            </p>
            <div className="actions">
              <Link className="button" href="/admin">
                Adminpanel
              </Link>
            </div>
          </div>
          <div className="card" style={{ background: "rgba(5,5,5,0.45)" }}>
            <p className="label">Snabbfakta</p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>En deltagare per medlemsnummer och lotteri</li>
              <li>Verifiering mot medlemsregister (Google Sheets)</li>
              <li>Vinnare publiceras efter dragning</li>
            </ul>
          </div>
        </section>

        <section className="grid grid-2">
          {raffles.length === 0 ? (
            <div className="card notice">Inga lotterier skapade än.</div>
          ) : (
            raffles.map((raffle) => {
              const state = resolveRaffleState(raffle);
              const stateLabel =
                state === "open"
                  ? "Öppet"
                  : state === "not_open"
                    ? "Ej öppnat"
                    : state === "closed_waiting_draw"
                      ? "Stängt"
                      : state === "resolved"
                        ? "Avgjort"
                        : "Utkast";

              return (
                <article className="card" key={raffle.id}>
                  <div className="panel-title">
                    <h3>{raffle.matchName}</h3>
                    <span className="badge">{stateLabel}</span>
                  </div>
                  <p className="tiny">Matchdag: {formatDate(raffle.matchDate)}</p>
                  <p>{raffle.description || "Biljettlotteri för medlemmar."}</p>
                  <Link className="button" href={`/raffles/${raffle.slug}`}>
                    Öppna lotterisida
                  </Link>
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
