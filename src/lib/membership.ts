import { extractPhoneLast7, normalizeLastName, normalizeMembershipNumber } from "@/lib/normalize";
import { prisma } from "@/lib/prisma";
import { MEMBERSHIP_STATUS } from "@/lib/statuses";

export type VerificationInput = {
  membershipNumber: string;
  lastName: string;
  phone: string;
};

export async function verifyMembership(input: VerificationInput) {
  const membershipNumber = normalizeMembershipNumber(input.membershipNumber);
  const lastName = normalizeLastName(input.lastName);
  const phoneLast7 = extractPhoneLast7(input.phone);

  if (!membershipNumber || !lastName || phoneLast7.length !== 7) {
    return {
      ok: false,
      normalized: {
        membershipNumber,
        lastName,
        phoneLast7
      }
    };
  }

  const registry = await prisma.membershipRegistry.findUnique({
    where: {
      membershipNumber
    }
  });

  if (!registry) {
    return {
      ok: false,
      normalized: {
        membershipNumber,
        lastName,
        phoneLast7
      }
    };
  }

  if (registry.status !== MEMBERSHIP_STATUS.ACTIVE) {
    return {
      ok: false,
      normalized: {
        membershipNumber,
        lastName,
        phoneLast7
      }
    };
  }

  if (registry.lastName !== lastName) {
    return {
      ok: false,
      normalized: {
        membershipNumber,
        lastName,
        phoneLast7
      }
    };
  }

  if (registry.phoneLast7 !== phoneLast7) {
    return {
      ok: false,
      normalized: {
        membershipNumber,
        lastName,
        phoneLast7
      }
    };
  }

  return {
    ok: true,
    normalized: {
      membershipNumber,
      lastName,
      phoneLast7
    },
    registry
  };
}

export async function revalidateEntryAgainstRegistry(entry: {
  membershipNumber: string;
  lastName: string;
  phoneLast7: string;
}) {
  const registry = await prisma.membershipRegistry.findUnique({
    where: {
      membershipNumber: entry.membershipNumber
    }
  });

  if (!registry) {
    return false;
  }

  if (registry.status !== MEMBERSHIP_STATUS.ACTIVE) {
    return false;
  }

  return registry.lastName === entry.lastName && registry.phoneLast7 === entry.phoneLast7;
}

export async function resolveActiveMemberByTwoFactors(entry: {
  membershipNumber: string;
  lastName: string;
  phoneLast7: string;
}) {
  const membershipNumber = normalizeMembershipNumber(entry.membershipNumber);
  const lastName = normalizeLastName(entry.lastName);
  const phoneLast7 = extractPhoneLast7(entry.phoneLast7);

  if (membershipNumber) {
    const byMembership = await prisma.membershipRegistry.findUnique({
      where: {
        membershipNumber
      }
    });

    if (byMembership && byMembership.status === MEMBERSHIP_STATUS.ACTIVE) {
      if (phoneLast7 && byMembership.phoneLast7 === phoneLast7) {
        return {
          registry: byMembership,
          matchedBy: "membership+phone" as const
        };
      }

      if (lastName && byMembership.lastName === lastName) {
        return {
          registry: byMembership,
          matchedBy: "membership+lastname" as const
        };
      }
    }
  }

  if (phoneLast7 && lastName) {
    const byPhoneLastName = await prisma.membershipRegistry.findMany({
      where: {
        phoneLast7,
        lastName,
        status: MEMBERSHIP_STATUS.ACTIVE
      },
      take: 2
    });

    if (byPhoneLastName.length === 1) {
      return {
        registry: byPhoneLastName[0],
        matchedBy: "phone+lastname" as const
      };
    }
  }

  return null;
}
