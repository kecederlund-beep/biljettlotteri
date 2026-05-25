import Link from "next/link";

import {
  closeRaffleNowAction,
  createRaffleAction,
  deleteRaffleAction,
  drawWinnersAction,
  publishWinnersAction,
  setRaffleStatusAction,
  setRaffleWinnersCountAction,
  syncRegistryAction,
  updateRaffleLogosAction,
  upsertSheetsConfigAction
} from "@/app/admin/actions";
import { logoutAction } from "@/app/admin/login/actions";
import { ensureAdmin } from "@/lib/admin-session";
import { formatDateTime } from "@/lib/format";
import { getMembershipSourceConfig } from "@/lib/google-sheets";
import { prisma } from "@/lib/prisma";
import { closeExpiredRaffles } from "@/lib/raffle";
import { resolveRaffleState } from "@/lib/raffle-state";

export const dynamic = "force-dynamic";

type AdminPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
  await ensureAdmin();
  await closeExpiredRaffles();

  const params = (await searchParams) || {};

  const [sourceConfig, memberCount, raffles] = await Promise.all([
    getMembershipSourceConfig(),
    prisma.membershipRegistry.count(),
    prisma.raffle.findMany({
      orderBy: {
        createdAt: "desc"
      },
      include: {
        _count: {
          select: {
            winners: true
          }
        }
      }
    })
  ]);

  return (
    <main>
      <div className="container grid" style={{ gap: 20 }}>
        <header className="header card">
          <div>
            <span className="badge">Adminpanel</span>
            <h1>Biljettlotteri</h1>
          </div>
          <div className="actions">
            <Link className="button secondary" href="/">
              Publik sida
            </Link>
            <form action={logoutAction}>
              <button className="button" type="submit">
                Logga ut
              </button>
            </form>
          </div>
        </header>

        {(params.created || params.synced || params.saved) && (
          <section className="notice ok">
            {params.created ? "Nytt lotteri skapat. " : ""}
            {params.synced ? "Medlemsregister synkat. " : ""}
            {params.saved ? "Google Sheets-inställning sparad." : ""}
          </section>
        )}

        <section className="card grid" style={{ gap: 16 }}>
          <div className="panel-title">
            <h2>Medlemsregister (Google Sheets)</h2>
            <span className="badge">Importerade medlemmar: {memberCount}</span>
          </div>

          <form className="grid grid-3" action={upsertSheetsConfigAction}>
            <label>
              <span className="label">Sheet ID</span>
              <input
                className="input"
                name="sheetId"
                defaultValue={sourceConfig.sheetId || ""}
                required
              />
            </label>

            <label>
              <span className="label">Bladnamn</span>
              <input
                className="input"
                name="sheetTab"
                defaultValue={sourceConfig.sheetTab || "Medlemmar"}
                required
              />
            </label>

            <label>
              <span className="label">API-nyckel (valfritt vid publikt sheet)</span>
              <input className="input" name="apiKey" defaultValue={sourceConfig.apiKey || ""} />
            </label>

            <div className="actions">
              <button className="button" type="submit">
                Spara källa
              </button>
            </div>
          </form>

          <div className="actions">
            <form action={syncRegistryAction}>
              <button className="button" type="submit">
                Synka medlemsregister nu
              </button>
            </form>
            <p className="tiny">
              Senaste synk: {sourceConfig.lastSyncAt ? formatDateTime(sourceConfig.lastSyncAt) : "Aldrig"}
              <br />
              Status: {sourceConfig.lastSyncStatus || "Ingen synk gjord"}
            </p>
          </div>
        </section>

        <section className="card grid" style={{ gap: 16 }}>
          <h2>Skapa nytt lotteri</h2>
          <form
            className="grid grid-2"
            action={createRaffleAction}
            encType="multipart/form-data"
          >
            <label>
              <span className="label">Matchnamn</span>
              <input className="input" name="matchName" required />
            </label>

            <label>
              <span className="label">Slug (valfritt)</span>
              <input className="input" name="slug" placeholder="lulea-vs-linkoping" />
            </label>

            <label>
              <span className="label">Hemmalag logotyp (URL)</span>
              <input className="input" name="homeLogoUrl" placeholder="https://..." />
            </label>

            <label>
              <span className="label">Hemmalag logotyp (fil)</span>
              <input className="input" type="file" accept="image/*" name="homeLogoFile" />
            </label>

            <label>
              <span className="label">Bortalag logotyp (URL)</span>
              <input className="input" name="awayLogoUrl" placeholder="https://..." />
            </label>

            <label>
              <span className="label">Bortalag logotyp (fil)</span>
              <input className="input" type="file" accept="image/*" name="awayLogoFile" />
            </label>

            <label>
              <span className="label">Matchdatum</span>
              <input className="input" type="datetime-local" name="matchDate" required />
            </label>

            <label>
              <span className="label">Arena</span>
              <input className="input" name="arena" placeholder="COOP Norrbotten Arena" />
            </label>

            <label>
              <span className="label">Öppnar</span>
              <input className="input" type="datetime-local" name="openAt" required />
            </label>

            <label>
              <span className="label">Stänger</span>
              <input className="input" type="datetime-local" name="closeAt" required />
            </label>

            <label>
              <span className="label">Dragningstid</span>
              <input className="input" type="datetime-local" name="drawAt" required />
            </label>

            <label>
              <span className="label">Antal vinnare</span>
              <input className="input" type="number" min={1} defaultValue={1} name="numberOfWinners" required />
            </label>

            <label>
              <span className="label">Status</span>
              <select className="input" name="status" defaultValue="DRAFT">
                <option value="DRAFT">Utkast</option>
                <option value="ACTIVE">Aktivt</option>
                <option value="CLOSED">Stängt</option>
                <option value="RESOLVED">Avgjort</option>
              </select>
            </label>

            <label style={{ gridColumn: "1/-1" }}>
              <span className="label">Beskrivning</span>
              <textarea className="input" rows={3} name="description" />
            </label>

            <button className="button" type="submit">
              Skapa lotteri
            </button>
          </form>
        </section>

        <section className="grid" style={{ gap: 12 }}>
          <h2>Lotterier</h2>
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
                <article className="card grid" style={{ gap: 12 }} key={raffle.id}>
                  <div className="panel-title">
                    <h3>{raffle.matchName}</h3>
                    <span className="badge">{stateLabel}</span>
                  </div>

                  <p className="tiny">
                    Slug: <code>{raffle.slug}</code>
                    <br />
                    Öppnar: {formatDateTime(raffle.openAt)}
                    <br />
                    Stänger: {formatDateTime(raffle.closeAt)}
                    <br />
                    Dragning: {formatDateTime(raffle.drawAt)}
                  </p>

                  <div className="actions">
                    <span className="badge">Antal vinnare: {raffle.numberOfWinners}</span>
                    <span className="badge">Vinnare: {raffle._count.winners}</span>
                    <span className="badge">Publik visning: {raffle.winnersPublicVisible ? "Ja" : "Nej"}</span>
                  </div>

                  <form className="actions" action={setRaffleWinnersCountAction}>
                    <input type="hidden" name="raffleId" value={raffle.id} />
                    <input
                      className="input"
                      type="number"
                      min={1}
                      name="numberOfWinners"
                      defaultValue={raffle.numberOfWinners}
                      style={{ maxWidth: 220 }}
                    />
                    <button className="button secondary inline" type="submit">
                      Spara antal vinnare
                    </button>
                  </form>

                  <form
                    className="grid grid-2"
                    action={updateRaffleLogosAction}
                    encType="multipart/form-data"
                  >
                    <input type="hidden" name="raffleId" value={raffle.id} />

                    <label>
                      <span className="label">Hemmalag logotyp (URL)</span>
                      <input
                        className="input"
                        name="homeLogoUrl"
                        defaultValue={raffle.homeLogoUrl || ""}
                        placeholder="https://..."
                      />
                    </label>

                    <label>
                      <span className="label">Hemmalag logotyp (fil)</span>
                      <input className="input" type="file" accept="image/*" name="homeLogoFile" />
                    </label>

                    <label>
                      <span className="label">Ta bort hemmalagets logotyp</span>
                      <input type="checkbox" name="removeHomeLogo" />
                    </label>

                    <label>
                      <span className="label">Bortalag logotyp (URL)</span>
                      <input
                        className="input"
                        name="awayLogoUrl"
                        defaultValue={raffle.awayLogoUrl || ""}
                        placeholder="https://..."
                      />
                    </label>

                    <label>
                      <span className="label">Bortalag logotyp (fil)</span>
                      <input className="input" type="file" accept="image/*" name="awayLogoFile" />
                    </label>

                    <label>
                      <span className="label">Ta bort bortalagets logotyp</span>
                      <input type="checkbox" name="removeAwayLogo" />
                    </label>

                    <div className="actions" style={{ gridColumn: "1/-1" }}>
                      <button className="button secondary inline" type="submit">
                        Spara logotyper
                      </button>
                    </div>
                  </form>

                  <div className="actions">
                    <Link className="button secondary inline" href={`/raffles/${raffle.slug}`}>
                      Öppna publik sida
                    </Link>
                    <Link className="button secondary inline" href={`/admin/raffles/${raffle.id}`}>
                      Deltagare och export
                    </Link>
                  </div>

                  <div className="actions">
                    <form className="inline-form" action={closeRaffleNowAction}>
                      <input type="hidden" name="raffleId" value={raffle.id} />
                      <button className="button inline" type="submit">
                        Stäng nu
                      </button>
                    </form>

                    <form className="inline-form" action={drawWinnersAction}>
                      <input type="hidden" name="raffleId" value={raffle.id} />
                      <button className="button secondary inline" type="submit">
                        Dra vinnare
                      </button>
                    </form>

                    <form className="inline-form" action={publishWinnersAction}>
                      <input type="hidden" name="raffleId" value={raffle.id} />
                      <button className="button secondary inline" type="submit">
                        Publicera vinnare
                      </button>
                    </form>

                    <form className="inline-form" action={deleteRaffleAction}>
                      <input type="hidden" name="raffleId" value={raffle.id} />
                      <button className="button secondary inline" type="submit">
                        Ta bort lotteri
                      </button>
                    </form>
                  </div>

                  <form className="actions" action={setRaffleStatusAction}>
                    <input type="hidden" name="raffleId" value={raffle.id} />
                    <select className="input" name="status" defaultValue={raffle.status} style={{ maxWidth: 220 }}>
                      <option value="DRAFT">Utkast</option>
                      <option value="ACTIVE">Aktivt</option>
                      <option value="CLOSED">Stängt</option>
                      <option value="RESOLVED">Avgjort</option>
                    </select>
                    <button className="button inline" type="submit">
                      Uppdatera status
                    </button>
                  </form>
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
