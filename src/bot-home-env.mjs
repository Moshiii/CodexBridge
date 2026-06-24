export async function withBotHomeEnv(botHome, work) {
  const previousBotHome = process.env.BOT_HOME;
  process.env.BOT_HOME = botHome;
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
