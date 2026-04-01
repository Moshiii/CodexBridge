function parseNumber(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid cron value: ${value}`);
  }
  return parsed;
}

function expandPart(part, min, max) {
  if (part === "*") {
    return null;
  }

  const values = new Set();
  for (const segment of part.split(",")) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }

    let base = trimmed;
    let step = 1;

    if (trimmed.includes("/")) {
      const [left, right] = trimmed.split("/");
      base = left;
      step = parseNumber(right, 1, max - min + 1);
    }

    let rangeStart = min;
    let rangeEnd = max;

    if (base !== "*") {
      if (base.includes("-")) {
        const [startRaw, endRaw] = base.split("-");
        rangeStart = parseNumber(startRaw, min, max);
        rangeEnd = parseNumber(endRaw, min, max);
        if (rangeEnd < rangeStart) {
          throw new Error(`Invalid cron range: ${base}`);
        }
      } else {
        rangeStart = parseNumber(base, min, max);
        rangeEnd = rangeStart;
      }
    }

    for (let value = rangeStart; value <= rangeEnd; value += step) {
      values.add(value);
    }
  }

  return values;
}

export function parseCronExpression(expression) {
  const parts = String(expression || "").trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("Cron expression must have 5 fields: minute hour day month weekday");
  }

  return {
    expression: parts.join(" "),
    minute: expandPart(parts[0], 0, 59),
    hour: expandPart(parts[1], 0, 23),
    dayOfMonth: expandPart(parts[2], 1, 31),
    month: expandPart(parts[3], 1, 12),
    dayOfWeek: expandPart(parts[4], 0, 6),
  };
}

function matchesField(setOrNull, value) {
  return setOrNull == null || setOrNull.has(value);
}

export function cronMatchesDate(cron, date) {
  return (
    matchesField(cron.minute, date.getMinutes()) &&
    matchesField(cron.hour, date.getHours()) &&
    matchesField(cron.dayOfMonth, date.getDate()) &&
    matchesField(cron.month, date.getMonth() + 1) &&
    matchesField(cron.dayOfWeek, date.getDay())
  );
}

export function minuteKey(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
