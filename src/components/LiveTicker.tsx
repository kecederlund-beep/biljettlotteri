"use client";

import { useEffect, useState } from "react";

type LiveTickerProps = {
  slug: string;
  initialCount: number;
};

export function LiveTicker({ slug, initialCount }: LiveTickerProps) {
  const [count, setCount] = useState(initialCount);
  const [updatedAt, setUpdatedAt] = useState<string>(new Date().toISOString());

  useEffect(() => {
    let active = true;

    const pull = async () => {
      try {
        const response = await fetch(`/api/raffles/${slug}/count`, {
          cache: "no-store"
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { count: number; updatedAt: string };

        if (active) {
          setCount(payload.count);
          setUpdatedAt(payload.updatedAt);
        }
      } catch {
        // Keep the last value if network fails temporarily.
      }
    };

    pull();

    const interval = setInterval(pull, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [slug]);

  return (
    <div className="card">
      <span className="label">Deltagare just nu</span>
      <div className="ticker-number">{count}</div>
      <p className="tiny">
        Senast uppdaterad: {new Date(updatedAt).toLocaleTimeString("sv-SE")}
      </p>
    </div>
  );
}
