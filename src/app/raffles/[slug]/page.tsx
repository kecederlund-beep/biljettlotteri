import Image from "next/image";
import { notFound } from "next/navigation";

import { CountdownTimer } from "@/components/CountdownTimer";
import { EntryForm } from "@/components/EntryForm";
import { LotteryInfoDialog } from "@/components/LotteryInfoDialog";
import { formatDate, formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { closeExpiredRaffles } from "@/lib/raffle";
import { resolveRaffleState } from "@/lib/raffle-state";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function RafflePage({ params }: PageProps) {
  const { slug } = await params;

  await closeExpiredRaffles();

  const raffle = await prisma.raffle.findUnique({
    where: { slug },
    include: {
      winners: {
        orderBy: {
          position: "asc"
        }
      }
    }
  });

  if (!raffle) {
    notFound();
  }

  const state = resolveRaffleState(raffle);
  const serverNowIso = new Date().toISOString();
  const homeLogo = raffle.homeLogoUrl || raffle.logoUrl;
  const awayLogo = raffle.awayLogoUrl;

  const stateLabelMap = {
    draft: "Ej publicerat",
    not_open: "Ej öppnat än",
    open: "Öppet för anmälan",
    closed_waiting_draw: "Stängt - väntar på dragning",
    resolved: "Avgjort"
  };

  const stateNotice =
    state === "not_open"
      ? `Lotteriet öppnar ${formatDateTime(raffle.openAt)}.`
      : state === "open"
        ? `Anmälan stänger ${formatDateTime(raffle.closeAt)}.`
        : state === "closed_waiting_draw"
          ? `Anmälan är stängd. Dragning planerad ${formatDateTime(raffle.drawAt)}.`
          : state === "resolved"
            ? "Lotteriet är avgjort."
            : "Lotteriet är i utkastläge.";

  return (
    <main>
      <div className="container grid" style={{ gap: 20 }}>
        <section className="card grid match-hero" style={{ gap: 14 }}>
          <div className="grid match-headline" style={{ gap: 10 }}>
            <span className="badge">{stateLabelMap[state]}</span>
            {homeLogo || awayLogo ? (
              <div className="match-logos">
                {homeLogo ? (
                  <div className="team-logo">
                    <Image
                      src={homeLogo}
                      alt="Hemmalagets logotyp"
                      className="match-logo"
                      width={128}
                      height={128}
                      unoptimized
                    />
                  </div>
                ) : null}
                {awayLogo ? (
                  <div className="team-logo">
                    <Image
                      src={awayLogo}
                      alt="Bortalagets logotyp"
                      className="match-logo"
                      width={128}
                      height={128}
                      unoptimized
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            <h1 className="match-title">{raffle.matchName}</h1>
            <p>{formatDate(raffle.matchDate)}</p>
            {raffle.arena ? <p>Arena: {raffle.arena}</p> : null}
            {raffle.description ? <p>{raffle.description}</p> : null}
            <div className="notice">{stateNotice}</div>
          </div>

          {state === "not_open" ? (
            <CountdownTimer
              targetIso={raffle.openAt.toISOString()}
              initialNowIso={serverNowIso}
              label="Nedräkning till öppning"
            />
          ) : null}
          {state === "open" ? (
            <CountdownTimer
              targetIso={raffle.drawAt.toISOString()}
              initialNowIso={serverNowIso}
              label="nedräkning till dragning"
            />
          ) : null}
          {state === "closed_waiting_draw" ? (
            <CountdownTimer
              targetIso={raffle.drawAt.toISOString()}
              initialNowIso={serverNowIso}
              label="Nedräkning till dragning"
            />
          ) : null}
        </section>

        {state === "open" ? <EntryForm slug={raffle.slug} /> : null}

        <section className="card">
          <p>Vinnare kontaktas via e-post följande dag.</p>
          <LotteryInfoDialog />
        </section>

        {state === "closed_waiting_draw" ? (
          <section className="card">
            <h3>Lotteriet är stängt</h3>
            <p>Inga fler anmälningar tas emot. Vinnare publiceras efter dragningen.</p>
          </section>
        ) : null}

        {state === "resolved" ? (
          <section className="card">
            <h3>Vinnare</h3>
            {raffle.winnersPublicVisible ? (
              raffle.winners.length > 0 ? (
                <div className="grid grid-2">
                  {raffle.winners.map((winner) => (
                    <article className="card" key={winner.id}>
                      <p style={{ margin: 0, fontSize: "1.35rem" }}>
                        Medlemsnummer: <strong>{winner.membershipNumber}</strong>
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <p>Inga vinnare registrerade.</p>
              )
            ) : (
              <div className="notice">Dragning är gjord men vinnarna är inte publicerade än.</div>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}
