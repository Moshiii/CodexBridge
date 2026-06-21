import { resolveBotHome } from "../config.mjs";
import {
  getUser,
  readUsersState,
  setPrivateEnabled,
  setUserStatus,
  upsertUser,
  writeUsersState,
} from "../users-state.mjs";

export async function listUsers({ botHome = resolveBotHome() } = {}) {
  return Object.values((await readUsersState(botHome)).users);
}

export async function findUser(userId, { botHome = resolveBotHome() } = {}) {
  return await getUser(userId, botHome);
}

export async function saveUser(user, { botHome = resolveBotHome() } = {}) {
  return await upsertUser(user, botHome);
}

export async function updateUserStatus(userId, status, { botHome = resolveBotHome() } = {}) {
  return await setUserStatus(userId, status, botHome);
}

export async function updateUserPrivateEnabled(userId, privateEnabled, { botHome = resolveBotHome() } = {}) {
  return await setPrivateEnabled(userId, privateEnabled, botHome);
}

export async function replaceUsersState(state, { botHome = resolveBotHome() } = {}) {
  await writeUsersState(state, botHome);
  return await readUsersState(botHome);
}
