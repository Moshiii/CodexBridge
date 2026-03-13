export type LogLevel = "debug" | "info" | "warn" | "error";

export type Logger = {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

export type LoggerOptions = {
  subsystem?: string;
  sink?: (line: string) => void;
};

function serialize(level: LogLevel, message: string, fields?: Record<string, unknown>): string {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(fields && Object.keys(fields).length > 0 ? { fields } : {})
  });
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const subsystem = options.subsystem?.trim();

  function emit(level: LogLevel, message: string, fields?: Record<string, unknown>) {
    sink(
      serialize(level, message, {
        ...(subsystem ? { subsystem } : {}),
        ...(fields ?? {})
      })
    );
  }

  return {
    debug(message, fields) {
      emit("debug", message, fields);
    },
    info(message, fields) {
      emit("info", message, fields);
    },
    warn(message, fields) {
      emit("warn", message, fields);
    },
    error(message, fields) {
      emit("error", message, fields);
    }
  };
}
