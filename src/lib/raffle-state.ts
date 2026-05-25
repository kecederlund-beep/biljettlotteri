import { RAFFLE_STATUS } from "@/lib/statuses";

export type RafflePublicState =
  | "draft"
  | "not_open"
  | "open"
  | "closed_waiting_draw"
  | "resolved";

type RaffleStateInput = {
  status: string;
  openAt: Date;
  closeAt: Date;
};

export function resolveRaffleState(
  raffle: RaffleStateInput,
  now: Date = new Date()
): RafflePublicState {
  if (raffle.status === RAFFLE_STATUS.DRAFT) {
    return "draft";
  }

  if (raffle.status === RAFFLE_STATUS.RESOLVED) {
    return "resolved";
  }

  if (raffle.status === RAFFLE_STATUS.CLOSED) {
    return "closed_waiting_draw";
  }

  if (now < raffle.openAt) {
    return "not_open";
  }

  if (now >= raffle.closeAt) {
    return "closed_waiting_draw";
  }

  return "open";
}

export function isRaffleOpen(raffle: RaffleStateInput, now: Date = new Date()) {
  return resolveRaffleState(raffle, now) === "open";
}
