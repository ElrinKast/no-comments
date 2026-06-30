import crypto from "node:crypto";
import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const scrypt = promisify(crypto.scrypt);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "db.json");
const DEFAULT_SERVER_ID = "home";
const DEFAULT_CHANNEL_ID = "general";

const defaultDb = {
  users: [],
  sessions: [],
  servers: [
    {
      id: DEFAULT_SERVER_ID,
      name: "Kolink",
      ownerId: null,
      createdAt: new Date().toISOString()
    }
  ],
  channels: [
    {
      id: DEFAULT_CHANNEL_ID,
      serverId: DEFAULT_SERVER_ID,
      name: "general",
      type: "text",
      createdAt: new Date().toISOString()
    }
  ],
  messages: {
    [DEFAULT_CHANNEL_ID]: []
  }
};

let db;

async function ensureDb() {
  if (db) return db;

  await fs.mkdir(dirname(DB_PATH), { recursive: true });

  try {
    db = JSON.parse(await fs.readFile(DB_PATH, "utf8"));
  } catch {
    db = structuredClone(defaultDb);
    await saveDb();
  }

  db.users ||= [];
  db.sessions ||= [];
  db.servers ||= structuredClone(defaultDb.servers);
  db.channels ||= structuredClone(defaultDb.channels);
  db.messages ||= { [DEFAULT_CHANNEL_ID]: [] };
  return db;
}

async function saveDb() {
  await fs.mkdir(dirname(DB_PATH), { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    color: user.color,
    avatar: user.avatar,
    createdAt: user.createdAt
  };
}

function normalizeUsername(username) {
  return String(username || "").trim().replace(/\s+/g, " ").slice(0, 28);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(String(password), salt, 64);
  return `${salt}:${key.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [salt, storedKey] = String(storedHash || "").split(":");
  if (!salt || !storedKey) return false;

  const key = await scrypt(String(password), salt, 64);
  const expected = Buffer.from(storedKey, "hex");
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

export async function validateNewUser({ username, email, password }) {
  const store = await ensureDb();
  const cleanUsername = normalizeUsername(username);
  const cleanEmail = normalizeEmail(email);

  if (cleanUsername.length < 3) {
    throw new Error("Имя должно быть минимум 3 символа.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error("Введите корректный email.");
  }

  if (String(password || "").length < 8) {
    throw new Error("Пароль должен быть минимум 8 символов.");
  }

  const taken = store.users.some(
    (user) => user.username.toLowerCase() === cleanUsername.toLowerCase() || user.email === cleanEmail
  );
  if (taken) {
    throw new Error("Пользователь с таким именем или email уже есть.");
  }

  return { username: cleanUsername, email: cleanEmail, password: String(password || "") };
}

export async function createUser({ username, email, password }) {
  const store = await ensureDb();
  const cleanUser = await validateNewUser({ username, email, password });

  const user = {
    id: crypto.randomUUID(),
    username: cleanUser.username,
    displayName: cleanUser.username,
    email: cleanUser.email,
    passwordHash: await hashPassword(cleanUser.password),
    status: "В сети",
    color: "#4f8cff",
    avatar: cleanUser.username.slice(0, 2).toUpperCase(),
    createdAt: new Date().toISOString()
  };

  store.users.push(user);
  if (!store.servers[0].ownerId) store.servers[0].ownerId = user.id;
  await saveDb();
  return publicUser(user);
}

export async function createSession({ email, password }) {
  const store = await ensureDb();
  const cleanEmail = normalizeEmail(email);
  const user = store.users.find((item) => item.email === cleanEmail);

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new Error("Неверный email или пароль.");
  }

  const session = {
    token: crypto.randomBytes(32).toString("hex"),
    userId: user.id,
    createdAt: new Date().toISOString()
  };

  store.sessions.push(session);
  await saveDb();
  return { token: session.token, user: publicUser(user) };
}

export async function getUserByToken(token) {
  const store = await ensureDb();
  const session = store.sessions.find((item) => item.token === token);
  if (!session) return null;

  return store.users.find((user) => user.id === session.userId) || null;
}

export async function deleteSession(token) {
  const store = await ensureDb();
  store.sessions = store.sessions.filter((session) => session.token !== token);
  await saveDb();
}

export async function updateUserProfile(userId, profile) {
  const store = await ensureDb();
  const user = store.users.find((item) => item.id === userId);
  if (!user) throw new Error("Пользователь не найден.");

  const displayName = normalizeUsername(profile.displayName || user.displayName);
  user.displayName = displayName || user.displayName;
  user.status = String(profile.status || user.status).trim().slice(0, 64);
  user.color = String(profile.color || user.color).slice(0, 16);
  user.avatar = String(profile.avatar || user.avatar).trim().slice(0, 2).toUpperCase() || user.avatar;
  await saveDb();
  return publicUser(user);
}

export async function updateUserAccount(userId, account) {
  const store = await ensureDb();
  const user = store.users.find((item) => item.id === userId);
  if (!user) throw new Error("Пользователь не найден.");

  if (!(await verifyPassword(account.currentPassword, user.passwordHash))) {
    throw new Error("Введите текущий пароль.");
  }

  const cleanUsername = normalizeUsername(account.username || user.username);
  const cleanEmail = normalizeEmail(account.email || user.email);
  const newPassword = String(account.newPassword || "");

  if (cleanUsername.length < 3) {
    throw new Error("Имя должно быть минимум 3 символа.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error("Введите корректный email.");
  }

  if (newPassword && newPassword.length < 8) {
    throw new Error("Новый пароль должен быть минимум 8 символов.");
  }

  const taken = store.users.some((item) => {
    if (item.id === userId) return false;
    return item.username.toLowerCase() === cleanUsername.toLowerCase() || item.email === cleanEmail;
  });
  if (taken) {
    throw new Error("Пользователь с таким именем или email уже есть.");
  }

  const oldUsername = user.username;
  user.username = cleanUsername;
  user.email = cleanEmail;

  if (!user.displayName || user.displayName === oldUsername) {
    user.displayName = cleanUsername;
  }

  if (!user.avatar || user.avatar === oldUsername.slice(0, 2).toUpperCase()) {
    user.avatar = cleanUsername.slice(0, 2).toUpperCase();
  }

  if (newPassword) {
    user.passwordHash = await hashPassword(newPassword);
  }

  await saveDb();
  return publicUser(user);
}

export async function deleteUser(userId, { currentPassword }) {
  const store = await ensureDb();
  const user = store.users.find((item) => item.id === userId);
  if (!user) throw new Error("Пользователь не найден.");

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new Error("Введите текущий пароль.");
  }

  store.users = store.users.filter((item) => item.id !== userId);
  store.sessions = store.sessions.filter((session) => session.userId !== userId);

  for (const server of store.servers) {
    if (server.ownerId === userId) {
      server.ownerId = store.users[0]?.id || null;
    }
  }

  await saveDb();
}

export async function getWorkspace() {
  const store = await ensureDb();
  return {
    servers: store.servers,
    channels: store.channels
  };
}

export async function getChannelMessages(channelId, limit = 80) {
  const store = await ensureDb();
  return (store.messages[channelId] || []).slice(-limit);
}

export async function addChannelMessage(channelId, message) {
  const store = await ensureDb();
  store.messages[channelId] ||= [];
  store.messages[channelId].push(message);
  store.messages[channelId] = store.messages[channelId].slice(-300);
  await saveDb();
  return message;
}

export async function channelExists(channelId) {
  const store = await ensureDb();
  return store.channels.some((channel) => channel.id === channelId);
}

export { DEFAULT_CHANNEL_ID, publicUser };
