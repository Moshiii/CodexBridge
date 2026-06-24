import { SystemError } from "./errors.mjs";

export async function withBotHomeEnv(botHome, work) {
  const nextBotHome = String(botHome || "").trim();
  if (!nextBotHome) {
    throw new SystemError("Bot home is required for scoped BOT_HOME execution.", {
      code: "bot_home_required",
    });
  }
  const previousBotHome = process.env.BOT_HOME;
  process.env.BOT_HOME = nextBotHome;
  try {
    return await work();
  } finally {
    if (previousBotHome == null) {
      delete process.env.BOT_HOME;
    } else {
      process.env.BOT_HOME = previousBotHome;
    }
  }
}
