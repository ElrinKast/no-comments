import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import crypto from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMailerConfigured, sendVerificationCode } from "./src/mailer.js";
import {
  addChannelMessage,
  channelExists,
  createSession,
  createUser,
  DEFAULT_CHANNEL_ID,
  deleteSession,
  deleteUser,
  getChannelMessages,
  getUserByToken,
  getWorkspace,
  publicUser,
  updateUserAccount,
  updateUserProfile,
  validateNewUser
} from "./src/store.js";

const PORT = Number(process.env.PORT || 3000);
const MAX_HISTORY = 80;
const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_RESEND_MS = 60 * 1000;
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

const channelMembers = new Map();
const pendingEmailCodes = new Map();

function boolEnv(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function emailVerificationEnabled() {
  return boolEnv(process.env.EMAIL_VERIFICATION_ENABLED, false);
}

function verificationSecret() {
  return process.env.EMAIL_CODE_SECRET || process.env.SMTP_PASSWORD || "kolink-local-email-code-secret";
}

function createEmailCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashEmailCode(email, code) {
  return crypto.createHash("sha256").update(`${email}:${code}:${verificationSecret()}`).digest("hex");
}

function pruneEmailCodes() {
  const now = Date.now();
  for (const [email, pending] of pendingEmailCodes) {
    if (pending.expiresAt <= now) pendingEmailCodes.delete(email);
  }
}

async function sendRegistrationCode(payload) {
  const user = await validateNewUser(payload);
  pruneEmailCodes();

  if (!isMailerConfigured()) {
    const error = new Error("Почта для отправки кодов еще не настроена.");
    error.statusCode = 503;
    throw error;
  }

  const existing = pendingEmailCodes.get(user.email);
  const now = Date.now();
  if (existing && now - existing.sentAt < EMAIL_CODE_RESEND_MS) {
    return { email: user.email, resent: false };
  }

  const code = createEmailCode();
  pendingEmailCodes.set(user.email, {
    codeHash: hashEmailCode(user.email, code),
    attempts: 0,
    sentAt: now,
    expiresAt: now + EMAIL_CODE_TTL_MS
  });
  await sendVerificationCode({ to: user.email, code });
  return { email: user.email, resent: Boolean(existing) };
}

function verifyRegistrationCode(email, code) {
  pruneEmailCodes();
  const cleanCode = String(code || "").trim();
  const pending = pendingEmailCodes.get(email);
  if (!pending) return false;

  pending.attempts += 1;
  if (pending.attempts > 5) {
    pendingEmailCodes.delete(email);
    return false;
  }

  const expected = Buffer.from(pending.codeHash, "hex");
  const actual = Buffer.from(hashEmailCode(email, cleanCode), "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return false;

  pendingEmailCodes.delete(email);
  return true;
}

function iceServers() {
  if (!process.env.TURN_URL) return DEFAULT_ICE_SERVERS;

  return [
    ...DEFAULT_ICE_SERVERS,
    {
      urls: process.env.TURN_URL,
      username: process.env.TURN_USER || "",
      credential: process.env.TURN_PASSWORD || ""
    }
  ];
}

function getChannel(channelId) {
  if (!channelMembers.has(channelId)) {
    channelMembers.set(channelId, new Map());
  }

  return channelMembers.get(channelId);
}

function channelUsers(channelId) {
  return [...getChannel(channelId).values()].map((member) => ({
    id: member.socketId,
    userId: member.user.id,
    name: member.user.displayName,
    username: member.user.username,
    status: member.user.status,
    color: member.user.color,
    avatar: member.user.avatar,
    inCall: member.inCall,
    cameraOn: member.cameraOn,
    sharingScreen: member.sharingScreen
  }));
}

function emitPresence(io, channelId) {
  io.to(channelId).emit("presence:update", channelUsers(channelId));
}

function joinSocketChannel(io, socket, channelId, user, options = {}) {
  const { silent = false } = options;
  const existingMember = socket.data.member;
  if (existingMember?.channelId === channelId) {
    existingMember.user = user;
    getChannel(channelId).set(socket.id, existingMember);
    emitPresence(io, channelId);
    return existingMember;
  }

  if (existingMember) {
    const oldChannel = getChannel(existingMember.channelId);
    oldChannel.delete(socket.id);
    socket.leave(existingMember.channelId);
    emitPresence(io, existingMember.channelId);
  }

  const member = {
    socketId: socket.id,
    channelId,
    user,
    inCall: false,
    cameraOn: false,
    sharingScreen: false
  };

  socket.data.member = member;
  socket.join(channelId);
  getChannel(channelId).set(socket.id, member);

  if (!silent) {
    socket.to(channelId).emit("system:notice", `${user.displayName} подключился`);
  }
  emitPresence(io, channelId);
  return member;
}

function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");

  getUserByToken(token)
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: "Нужно войти в аккаунт." });
        return;
      }

      req.token = token;
      req.user = user;
      next();
    })
    .catch(next);
}

function attachApi(app) {
  app.use(express.json({ limit: "64kb" }));

  app.get("/config.json", (_req, res) => {
    res.json({
      iceServers: iceServers()
    });
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const cleanUser = await validateNewUser(req.body);
      if (emailVerificationEnabled()) {
        const code = String(req.body.code || "").trim();
        if (!code) {
          const verification = await sendRegistrationCode(req.body);
          res.status(202).json({
            verificationRequired: true,
            email: verification.email,
            resent: verification.resent
          });
          return;
        }

        if (!verifyRegistrationCode(cleanUser.email, code)) {
          res.status(400).json({ error: "Неверный или устаревший код подтверждения." });
          return;
        }
      }

      const user = await createUser(req.body);
      const session = await createSession({ email: req.body.email, password: req.body.password });
      res.status(201).json({ token: session.token, user });
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      res.json(await createSession(req.body));
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  });

  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    await deleteSession(req.token);
    res.json({ ok: true });
  });

  app.get("/api/me", requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  app.patch("/api/me", requireAuth, async (req, res) => {
    try {
      res.json({ user: await updateUserProfile(req.user.id, req.body) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/account", requireAuth, async (req, res) => {
    try {
      res.json({ user: await updateUserAccount(req.user.id, req.body) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/account", requireAuth, async (req, res) => {
    try {
      await deleteUser(req.user.id, req.body || {});
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/workspace", requireAuth, async (_req, res) => {
    res.json(await getWorkspace());
  });

  app.get("/api/presence", requireAuth, async (req, res) => {
    const requestedChannel = String(req.query.channelId || DEFAULT_CHANNEL_ID).trim();
    const channelId = (await channelExists(requestedChannel)) ? requestedChannel : DEFAULT_CHANNEL_ID;
    res.json({ users: channelUsers(channelId) });
  });
}

function attachRealtime(io) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    const user = await getUserByToken(token);

    if (!user) {
      next(new Error("unauthorized"));
      return;
    }

    socket.data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    joinSocketChannel(io, socket, DEFAULT_CHANNEL_ID, socket.data.user, { silent: true });

    socket.on("room:join", async (payload = {}, ack) => {
      const requestedChannel = String(payload.channelId || payload.roomId || DEFAULT_CHANNEL_ID).trim();
      const channelId = (await channelExists(requestedChannel)) ? requestedChannel : DEFAULT_CHANNEL_ID;
      const user = await getUserByToken(socket.handshake.auth?.token);

      if (!user) {
        ack?.({ ok: false, error: "Сессия устарела. Войдите заново." });
        return;
      }

      joinSocketChannel(io, socket, channelId, user);

      ack?.({
        ok: true,
        selfId: socket.id,
        channelId,
        messages: await getChannelMessages(channelId, MAX_HISTORY),
        users: channelUsers(channelId)
      });
    });

    socket.on("profile:update", async (profile = {}) => {
      const member = socket.data.member;
      if (!member) return;

      member.user = await updateUserProfile(member.user.id, profile);
      emitPresence(io, member.channelId);
    });

    socket.on("chat:message", async (text) => {
      const member = socket.data.member;
      if (!member) return;

      const cleanText = String(text || "").trim().slice(0, 1200);
      if (!cleanText) return;

      const message = {
        id: crypto.randomUUID(),
        userId: member.user.id,
        name: member.user.displayName,
        color: member.user.color,
        avatar: member.user.avatar,
        text: cleanText,
        createdAt: new Date().toISOString()
      };

      await addChannelMessage(member.channelId, message);
      io.to(member.channelId).emit("chat:message", message);
    });

    socket.on("call:join", (media = {}) => {
      const member = socket.data.member;
      if (!member) return;

      member.inCall = true;
      member.cameraOn = Boolean(media.cameraOn);
      member.sharingScreen = Boolean(media.sharingScreen);
      socket.to(member.channelId).emit("call:user-joined", { id: member.socketId });
      emitPresence(io, member.channelId);
    });

    socket.on("call:leave", () => {
      const member = socket.data.member;
      if (!member) return;

      member.inCall = false;
      member.cameraOn = false;
      member.sharingScreen = false;
      socket.to(member.channelId).emit("call:user-left", { id: member.socketId });
      emitPresence(io, member.channelId);
    });

    socket.on("call:media", (media = {}) => {
      const member = socket.data.member;
      if (!member) return;

      if (Object.hasOwn(media, "cameraOn")) member.cameraOn = Boolean(media.cameraOn);
      if (Object.hasOwn(media, "sharingScreen")) member.sharingScreen = Boolean(media.sharingScreen);
      emitPresence(io, member.channelId);
    });

    socket.on("call:screen", (sharingScreen) => {
      const member = socket.data.member;
      if (!member) return;

      member.sharingScreen = Boolean(sharingScreen);
      emitPresence(io, member.channelId);
    });

    socket.on("signal:offer", ({ to, description }) => {
      socket.to(to).emit("signal:offer", { from: socket.id, description });
    });

    socket.on("signal:answer", ({ to, description }) => {
      socket.to(to).emit("signal:answer", { from: socket.id, description });
    });

    socket.on("signal:ice", ({ to, candidate }) => {
      socket.to(to).emit("signal:ice", { from: socket.id, candidate });
    });

    socket.on("disconnect", () => {
      const member = socket.data.member;
      if (!member) return;

      getChannel(member.channelId).delete(socket.id);
      socket.to(member.channelId).emit("call:user-left", { id: socket.id });
      socket.to(member.channelId).emit("system:notice", `${member.user.displayName} отключился`);
      emitPresence(io, member.channelId);
    });
  });
}

export function startServer(port = PORT) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: true
    }
  });

  attachApi(app);
  app.use(express.static(join(__dirname, "public")));
  attachRealtime(io);

  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      const address = httpServer.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      console.log(`Kolink is running on http://localhost:${resolvedPort}`);
      resolve({
        port: resolvedPort,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            httpServer.close((error) => (error ? closeReject(error) : closeResolve()));
          })
      });
    });
  });
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  startServer(PORT);
}
