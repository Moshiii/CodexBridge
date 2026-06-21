import { resolveBotHome } from "../config.mjs";
import {
  adjustPaidCredits,
  chargeUsage,
  getUserCredits,
  grantPaidCredits,
  refundPaidCredits,
} from "../user-credits.mjs";

export async function findCreditAccount(userId, { botHome = resolveBotHome() } = {}) {
  return await getUserCredits(userId, botHome);
}

export async function chargeCredits(input = {}, { botHome = resolveBotHome() } = {}) {
  return await chargeUsage({ ...input, botHome });
}

export async function grantCredits(input = {}, { botHome = resolveBotHome() } = {}) {
  return await grantPaidCredits({ ...input, botHome });
}

export async function adjustCredits(input = {}, { botHome = resolveBotHome() } = {}) {
  return await adjustPaidCredits({ ...input, botHome });
}

export async function refundCredits(input = {}, { botHome = resolveBotHome() } = {}) {
  return await refundPaidCredits({ ...input, botHome });
}
