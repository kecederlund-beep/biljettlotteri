import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteEntryAction, invalidateEntryAction } from "@/app/admin/actions";
import { ensureAdmin } from "@/lib/admin-session";
import { formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type AdminRaffleEntriesPageProps = {
  params: Promise<{ id: string }>;
};

function formatVerificationReason(reason: string | null) {
  if (!reason) {
    return "-";
  }

  if (reason === "membership+phone") {
    return "membership+phone";
  }

  if (reason === "membership+lastname") {
    return "membership+lastname";
  }

  if (reason === "phone+lastname") {
    return "phone+lastname";
  }

  return reason;
}

export default async function AdminRaffleEntriesPage({ params }: AdminRaffleEntriesPageProps) {
  await ensureAdmin();
  const { id } = await params;

  const raffle = await prisma.raffle.findUnique({
    where: { id },
    include: {
      entries: {
        orderBy: {
          createdAt: "desc"
        }
      }
    }
  });

  if (!raffle) {
    notFound();
  }

  return (
    <main>
      <div className="container grid" style={{ gap: 20 }}>
        <header className="header card">
          <div>
            <span className="badge">Admin / Deltagare</span>
            <h1>{raffle.matchName}</h1>
          </div>
          <div className="actions">
            <Link className="button secondary" href="/admin">
              Tillbaka till admin
            </Link>
            <Link className="button" href={`/admin/raffles/${raffle.id}/export`}>
              Exportera CSV
            </Link>
          </div>
        </header>

        <section className="card">
          <div className="panel-title">
            <h2>Deltagarlista</h2>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Inskickad e-post</th>
                  <th>Medlemsnummer</th>
                  <th>Verifiering</th>
                  <th>Matchning</th>
                  <th>Skapad</th>
                  <th>Åtgärd</th>
                </tr>
              </thead>
              <tbody>
                {raffle.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.submittedEmail || "-"}</td>
                    <td>{entry.membershipNumber}</td>
                    <td>{entry.verificationStatus}</td>
                    <td>
                      {entry.verificationMatchReason ? (
                        <span className="badge">{formatVerificationReason(entry.verificationMatchReason)}</span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{formatDateTime(entry.createdAt)}</td>
                    <td>
                      <div className="actions">
                        {entry.verificationStatus === "VERIFIED" ? (
                          <form action={invalidateEntryAction}>
                            <input type="hidden" name="entryId" value={entry.id} />
                            <button className="button secondary inline" type="submit">
                              Markera ogiltig
                            </button>
                          </form>
                        ) : (
                          <span className="tiny">Ingen</span>
                        )}

                        <form action={deleteEntryAction}>
                          <input type="hidden" name="entryId" value={entry.id} />
                          <button className="button secondary inline" type="submit">
                            Ta bort
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
