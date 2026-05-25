"use client";

import { FormEvent, useMemo, useState } from "react";

type EntryFormProps = {
  slug: string;
  disabled?: boolean;
};

type FeedbackState = {
  kind: "idle" | "success" | "error";
  message: string;
  code?: string;
  signupUrl?: string;
};

export function EntryForm({ slug, disabled }: EntryFormProps) {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>({ kind: "idle", message: "" });

  const effectiveDisabled = useMemo(() => disabled || isSubmitting, [disabled, isSubmitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSubmitting(true);
    setFeedback({ kind: "idle", message: "" });

    try {
      const response = await fetch(`/api/raffles/${slug}/enter`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email
        })
      });

      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        code?: string;
        signupUrl?: string;
      };

      if (!response.ok || !payload.ok) {
        if (payload.code === "DUPLICATE") {
          setFeedback({
            kind: "error",
            message: "Den här e-postadressen är redan registrerad i lotteriet.",
            code: payload.code
          });
        } else if (payload.code === "RAFFLE_CLOSED") {
          setFeedback({
            kind: "error",
            message: "Lotteriet är inte öppet för registrering just nu.",
            code: payload.code
          });
        } else if (payload.code === "NOT_MEMBER") {
          setFeedback({
            kind: "error",
            message: payload.message || "Vi hittar inget aktivt medlemskap.",
            code: payload.code,
            signupUrl: payload.signupUrl
          });
        } else if (payload.code === "AMBIGUOUS_MEMBER") {
          setFeedback({
            kind: "error",
            message:
              payload.message ||
              "Vi hittar flera möjliga medlemsprofiler för e-postadressen.",
            code: payload.code
          });
        } else if (payload.code === "UNKNOWN_MEMBERSHIP") {
          setFeedback({
            kind: "error",
            message:
              payload.message ||
              "Vi kunde inte verifiera medlemskap just nu. Försök igen om en stund.",
            code: payload.code
          });
        } else {
          setFeedback({
            kind: "error",
            message: "Vi kunde inte verifiera medlemskap just nu. Försök igen om en stund.",
            code: payload.code
          });
        }

        return;
      }

      setFeedback({
        kind: "success",
        message: payload.message || "Du är verifierad medlem. Din anmälan är registrerad."
      });
      setEmail("");
    } catch {
      setFeedback({ kind: "error", message: "Tillfälligt tekniskt fel. Försök igen strax." });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="card entry-form">
      <h3>Anmäl dig till lotteriet</h3>
      <form className="grid" onSubmit={handleSubmit}>
        <label>
          <span className="label">E-post</span>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={effectiveDisabled}
            autoComplete="email"
          />
        </label>

        <button type="submit" className="button" disabled={effectiveDisabled}>
          {isSubmitting ? "Skickar..." : "Skicka anmälan"}
        </button>
      </form>

      {feedback.kind !== "idle" ? (
        <div className={feedback.kind === "success" ? "status success" : "status error"}>
          <p style={{ margin: 0 }}>{feedback.message}</p>
          {feedback.code === "NOT_MEMBER" && feedback.signupUrl ? (
            <p style={{ margin: "8px 0 0" }}>
              Lös medlemskap här:{" "}
              <a href={feedback.signupUrl} target="_blank" rel="noreferrer">
                {feedback.signupUrl}
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
