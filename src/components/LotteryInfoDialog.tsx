"use client";

import { useEffect, useState } from "react";

export function LotteryInfoDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button type="button" className="text-link" onClick={() => setOpen(true)}>
        Så funkar lotteriet
      </button>

      {open ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lottery-info-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="lottery-info-title">Så fungerar lotteriet</h3>
            <ul>
              <li>Lotteriet är öppet för medlemmar i Luleå Hockey.</li>
              <li>En anmälan per medlem gäller.</li>
              <li>Varje vinnare kan vinna två (2) biljetter.</li>
              <li>Vinnarna kontaktas via e-post.</li>
            </ul>
            <button type="button" className="button secondary inline" onClick={() => setOpen(false)}>
              Stäng
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
