export type AutoAideRuntimeConfig = {
  appName: string;
  host: string;
  port: number;
};

function parsePort(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AutoAideRuntimeConfig {
  return {
    appName: env.AUTOAIDE_APP_NAME?.trim() || "AutoAide",
    host: env.AUTOAIDE_HOST?.trim() || "127.0.0.1",
    port: parsePort(env.AUTOAIDE_PORT, 3010)
  };
}
