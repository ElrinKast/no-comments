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

export async function createUser({ username, email, password }) {
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

  const user = {
    id: crypto.randomUUID(),
    username: cleanUsername,
    displayName: cleanUsername,
    email: cleanEmail,
    passwordHash: await hashPassword(password),
    status: "В сети",
    color: "#4f8cff",
    avatar: cleanUsername.slice(0, 2).toUpperCase(),
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
