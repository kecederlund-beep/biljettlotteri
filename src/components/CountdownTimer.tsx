"use client";

import { useEffect, useMemo, useState } from "react";

function formatRemaining(ms: number) {
  if (ms <= 0) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0
    };
  }

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / (24 * 3600));
  const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { days, hours, minutes, seconds };
}

type CountdownTimerProps = {
  targetIso: string;
  label: string;
  initialNowIso?: string;
};

export function CountdownTimer({ targetIso, label, initialNowIso }: CountdownTimerProps) {
  const [now, setNow] = useState(() =>
    initialNowIso ? new Date(initialNowIso).getTime() : Date.now()
  );
  const target = useMemo(() => new Date(targetIso).getTime(), [targetIso]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const remaining = formatRemaining(target - now);
  const isDone = target - now <= 0;

  return (
    <div className="card">
      <span className="label">{label}</span>
      <div className="countdown" aria-live="polite">
        <div>
          <strong>{remaining.days.toString().padStart(2, "0")}</strong>
          <span>dagar</span>
        </div>
        <div>
          <strong>{remaining.hours.toString().padStart(2, "0")}</strong>
          <span>timmar</span>
        </div>
        <div>
          <strong>{remaining.minutes.toString().padStart(2, "0")}</strong>
          <span>minuter</span>
        </div>
        <div>
          <strong>{remaining.seconds.toString().padStart(2, "0")}</strong>
          <span>sekunder</span>
        </div>
      </div>
      {isDone ? <p className="notice">Tiden har passerat.</p> : null}
    </div>
  );
}
