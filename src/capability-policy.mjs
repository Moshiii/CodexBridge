function normalizeId(value) {
  return String(value || "").trim();
}

export function isDirectEnvelope(envelope = {}) {
  return Boolean(envelope.isDirect || envelope.chatType === "direct");
}

export function isGroupEnvelope(envelope = {}) {
  return Boolean(envelope.isGroup || envelope.chatType === "group");
}

export function isOwnerOrAdmin(envelope = {}, config = {}) {
  const requesterId = normalizeId(envelope.userId);
  if (!requesterId) {
    return false;
  }
  const botOwnerId = normalizeId(config.ownerUserId);
  if (botOwnerId && requesterId === botOwnerId) {
    return true;
  }
  const adminIds = Array.isArray(config.adminUserIds)
    ? config.adminUserIds.map(normalizeId).filter(Boolean)
    : [];
  return adminIds.includes(requesterId);
}

export function canUseGoal(envelope = {}, _config = {}) {
  return isDirectEnvelope(envelope) || isOwnerOrAdmin(envelope, _config);
}

export function canUseSchedule(envelope = {}, _config = {}) {
  return isDirectEnvelope(envelope) || isOwnerOrAdmin(envelope, _config);
}

export function canStopTask(envelope = {}, task = {}, config = {}) {
  const requesterId = normalizeId(envelope.userId);
  const ownerId = normalizeId(task.ownerUserId);
  if (!requesterId || !ownerId) {
    return false;
  }
  if (requesterId === ownerId) {
    return true;
  }
  return isOwnerOrAdmin(envelope, config);
}
