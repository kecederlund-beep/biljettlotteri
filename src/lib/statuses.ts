export const RAFFLE_STATUS = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  CLOSED: "CLOSED",
  RESOLVED: "RESOLVED"
} as const;

export type RaffleStatus = (typeof RAFFLE_STATUS)[keyof typeof RAFFLE_STATUS];

export const VERIFICATION_STATUS = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  INVALIDATED: "INVALIDATED",
  MANUAL_INVALID: "MANUAL_INVALID"
} as const;

export type VerificationStatus =
  (typeof VERIFICATION_STATUS)[keyof typeof VERIFICATION_STATUS];

export const MEMBERSHIP_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  UNKNOWN: "UNKNOWN"
} as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUS)[keyof typeof MEMBERSHIP_STATUS];
