import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import crypto from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const INVITE_CODE = process.env.FRIENDS_INVITE_CODE || "";
const MAX_HISTORY = 80;
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

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

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      members: new Map(),
      messages: []
    });
  }

  return rooms.get(roomId);
}

function roomUsers(roomId) {
  return [...getRoom(roomId).members.values()].map((member) => ({
    id: member.id,
    name: member.name,
    status: member.status,
    color: member.color,
    avatar: member.avatar,
    inCall: member.inCall,
    sharingScreen: member.sharingScreen
  }));
}

function emitPresence(io, roomId) {
  io.to(roomId).emit("presence:update", roomUsers(roomId));
}

function attachRealtime(io) {
  io.on("connection", (socket) => {
    socket.on("room:join", (payload = {}, ack) => {
    const roomId = String(payload.roomId || "lounge").trim().slice(0, 40) || "lounge";
    const name = String(payload.name || "Friend").trim().slice(0, 28) || "Friend";
    const inviteCode = String(payload.inviteCode || "");

    if (INVITE_CODE && inviteCode !== INVITE_CODE) {
      ack?.({ ok: false, error: "Неверный код приглашения." });
      return;
    }

    const member = {
      id: socket.id,
      name,
      roomId,
      status: String(payload.status || "В сети").trim().slice(0, 64),
      color: String(payload.color || "#4f8cff").slice(0, 16),
      avatar: String(payload.avatar || name[0] || "F").trim().slice(0, 2).toUpperCase(),
      inCall: false,
      sharingScreen: false
    };

    socket.data.member = member;
    socket.join(roomId);
    getRoom(roomId).members.set(socket.id, member);

    ack?.({
      ok: true,
      selfId: socket.id,
      roomId,
      messages: getRoom(roomId).messages,
      users: roomUsers(roomId)
    });

    socket.to(roomId).emit("system:notice", `${member.name} подключился`);
    emitPresence(io, roomId);
    });

    socket.on("profile:update", (profile = {}) => {
    const member = socket.data.member;
    if (!member) return;

    member.name = String(profile.name || member.name).trim().slice(0, 28) || member.name;
    member.status = String(profile.status || member.status).trim().slice(0, 64);
    member.color = String(profile.color || member.color).slice(0, 16);
    member.avatar = String(profile.avatar || member.avatar).trim().slice(0, 2).toUpperCase() || member.avatar;
    emitPresence(io, member.roomId);
    });

    socket.on("chat:message", (text) => {
    const member = socket.data.member;
    if (!member) return;

    const cleanText = String(text || "").trim().slice(0, 1200);
    if (!cleanText) return;

    const message = {
      id: crypto.randomUUID(),
      userId: member.id,
      name: member.name,
      color: member.color,
      avatar: member.avatar,
      text: cleanText,
      createdAt: new Date().toISOString()
    };

    const room = getRoom(member.roomId);
    room.messages.push(message);
    room.messages = room.messages.slice(-MAX_HISTORY);
    io.to(member.roomId).emit("chat:message", message);
    });

    socket.on("call:join", () => {
    const member = socket.data.member;
    if (!member) return;

    member.inCall = true;
    socket.to(member.roomId).emit("call:user-joined", { id: member.id });
    emitPresence(io, member.roomId);
    });

    socket.on("call:leave", () => {
    const member = socket.data.member;
    if (!member) return;

    member.inCall = false;
    member.sharingScreen = false;
    socket.to(member.roomId).emit("call:user-left", { id: member.id });
    emitPresence(io, member.roomId);
    });

    socket.on("call:screen", (sharingScreen) => {
    const member = socket.data.member;
    if (!member) return;

    member.sharingScreen = Boolean(sharingScreen);
    emitPresence(io, member.roomId);
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

    const room = getRoom(member.roomId);
    room.members.delete(socket.id);
    socket.to(member.roomId).emit("call:user-left", { id: socket.id });
    socket.to(member.roomId).emit("system:notice", `${member.name} отключился`);
    emitPresence(io, member.roomId);
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

  app.use(express.static(join(__dirname, "public")));
  app.get("/config.json", (_req, res) => {
    res.json({
      iceServers: iceServers()
    });
  });
  attachRealtime(io);

  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      const address = httpServer.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      console.log(`No Comment\`s is running on http://localhost:${resolvedPort}`);
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
