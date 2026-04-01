function normalizeHour(hour, dayPart) {
  let normalized = hour;
  if (dayPart === "下午" || dayPart === "晚上") {
    if (normalized < 12) {
      normalized += 12;
    }
  } else if (dayPart === "中午") {
    if (normalized >= 1 && normalized <= 6) {
      normalized += 12;
    }
  } else if ((dayPart === "凌晨" || dayPart === "早上" || dayPart === "上午") && normalized === 12) {
    normalized = 0;
  }
  return normalized;
}

export function parseNaturalLanguageSchedule(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return null;
  }

  const daily = raw.match(
    /^每天(?:(凌晨|早上|上午|中午|下午|晚上))?\s*(\d{1,2})(?:(?:[:点](\d{1,2}))|点半|点)?(?:分|点钟|点)?[\s,，]*(.+)$/u,
  );

  if (!daily) {
    return null;
  }

  const [, dayPart = "", hourRaw, minuteRaw, objectiveRaw] = daily;
  const hour = Number.parseInt(hourRaw, 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return null;
  }

  let minute = 0;
  if (raw.includes("点半")) {
    minute = 30;
  } else if (minuteRaw != null && minuteRaw !== "") {
    minute = Number.parseInt(minuteRaw, 10);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }

  const objective = String(objectiveRaw || "").trim();
  if (!objective) {
    return null;
  }

  const normalizedHour = normalizeHour(hour, dayPart);
  if (normalizedHour < 0 || normalizedHour > 23) {
    return null;
  }

  return {
    kind: "daily",
    cron: `${minute} ${normalizedHour} * * *`,
    objective,
    displayText: `每天 ${String(normalizedHour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${objective}`,
  };
}
