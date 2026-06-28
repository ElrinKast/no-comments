let socket;

const els = {
  authScreen: document.querySelector("#authScreen"),
  appShell: document.querySelector("#appShell"),
  loginTab: document.querySelector("#loginTab"),
  registerTab: document.querySelector("#registerTab"),
  authForm: document.querySelector("#authForm"),
  usernameLabel: document.querySelector("#usernameLabel"),
  usernameInput: document.querySelector("#usernameInput"),
  emailInput: document.querySelector("#emailInput"),
  passwordInput: document.querySelector("#passwordInput"),
  authSubmit: document.querySelector("#authSubmit"),
  authError: document.querySelector("#authError"),
  profileForm: document.querySelector("#profileForm"),
  displayNameInput: document.querySelector("#displayNameInput"),
  statusInput: document.querySelector("#statusInput"),
  profileError: document.querySelector("#profileError"),
  logoutButton: document.querySelector("#logoutButton"),
  channelList: document.querySelector("#channelList"),
  peopleList: document.querySelector("#peopleList"),
  onlineCount: document.querySelector("#onlineCount"),
  serverLabel: document.querySelector("#serverLabel"),
  roomLabel: document.querySelector("#roomLabel"),
  channelTitle: document.querySelector("#channelTitle"),
  messageForm: document.querySelector("#messageForm"),
  messageInput: document.querySelector("#messageInput"),
  messages: document.querySelector("#messages"),
  callButton: document.querySelector("#callButton"),
  muteButton: document.querySelector("#muteButton"),
  screenButton: document.querySelector("#screenButton"),
  videoGrid: document.querySelector("#videoGrid"),
  swatches: document.querySelectorAll(".swatch")
};

const state = {
  authMode: "login",
  token: localStorage.getItem("noCommentsToken") || "",
  user: null,
  selfId: "",
  serverId: "home",
  channelId: "general",
  channels: [],
  color: "#4f8cff",
  users: new Map(),
  peers: new Map(),
  localStream: null,
  screenStream: null,
  inCall: false,
  muted: false,
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

loadConfig();
boot();

els.loginTab.addEventListener("click", () => setAuthMode("login"));
els.registerTab.addEventListener("click", () => setAuthMode("register"));

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.authError.textContent = "";

  const path = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
  const payload = {
    email: els.emailInput.value,
    password: els.passwordInput.value
  };

  if (state.authMode === "register") {
    payload.username = els.usernameInput.value;
  }

  const response = await api(path, { method: "POST", body: payload, skipAuth: true });
  if (response.error) {
    els.authError.textContent = response.error;
    return;
  }

  setSession(response.token, response.user);
  await enterApp();
});

els.profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.profileError.textContent = "";

  const response = await api("/api/me", {
    method: "PATCH",
    body: {
      displayName: els.displayNameInput.value,
      status: els.statusInput.value,
      color: state.color,
      avatar: (els.displayNameInput.value || state.user?.displayName || "NC").slice(0, 2)
    }
  });

  if (response.error) {
    els.profileError.textContent = response.error;
    return;
  }

  state.user = response.user;
  socket.emit("profile:update", response.user);
});

els.logoutButton.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  leaveCall();
  socket?.disconnect();
  localStorage.removeItem("noCommentsToken");
  state.token = "";
  state.user = null;
  els.authScreen.hidden = false;
  els.appShell.hidden = true;
});

els.swatches.forEach((button) => {
  button.addEventListener("click", () => setColor(button.dataset.color));
});

els.messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = els.messageInput.value;
  socket.emit("chat:message", text);
  els.messageInput.value = "";
  els.messageInput.focus();
});

els.callButton.addEventListener("click", () => {
  if (state.inCall) {
    leaveCall();
  } else {
    joinCall();
  }
});

els.muteButton.addEventListener("click", () => {
  state.muted = !state.muted;
  for (const track of state.localStream?.getAudioTracks() || []) {
    track.enabled = !state.muted;
  }
  els.muteButton.classList.toggle("active", state.muted);
  els.muteButton.textContent = state.muted ? "muted" : "mic";
});

els.screenButton.addEventListener("click", () => {
  if (state.screenStream) {
    stopScreenShare();
  } else {
    startScreenShare();
  }
});

async function boot() {
  if (!state.token) return;

  const response = await api("/api/me");
  if (response.error) {
    localStorage.removeItem("noCommentsToken");
    return;
  }

  state.user = response.user;
  await enterApp();
}

async function enterApp() {
  els.authScreen.hidden = true;
  els.appShell.hidden = false;
  hydrateProfile();

  const workspace = await api("/api/workspace");
  if (!workspace.error) {
    state.channels = workspace.channels;
    const server = workspace.servers[0];
    state.serverId = server?.id || "home";
    els.serverLabel.textContent = server?.name || "Сервер";
    renderChannels();
  }

  connectSocket();
  joinChannel(state.channelId);
}

function setSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("noCommentsToken", token);
}

function setAuthMode(mode) {
  state.authMode = mode;
  els.loginTab.classList.toggle("active", mode === "login");
  els.registerTab.classList.toggle("active", mode === "register");
  els.usernameLabel.hidden = mode !== "register";
  els.usernameInput.required = mode === "register";
  els.authSubmit.textContent = mode === "register" ? "Создать аккаунт" : "Войти";
  els.passwordInput.autocomplete = mode === "register" ? "new-password" : "current-password";
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.token && !options.skipAuth) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { error: data.error || "Ошибка запроса." };
  return data;
}

function connectSocket() {
  socket?.disconnect();
  socket = io({ auth: { token: state.token } });

  socket.on("connect_error", () => {
    els.profileError.textContent = "Не удалось подключиться к realtime-серверу.";
  });

  socket.on("presence:update", (users) => {
    state.users = new Map(users.map((user) => [user.id, user]));
    renderPeople(users);

    if (state.inCall) {
      for (const user of users) {
        if (user.id !== state.selfId && user.inCall && !state.peers.has(user.id)) {
          createPeer(user.id, true);
        }
      }
    }
  });

  socket.on("chat:message", addMessage);
  socket.on("system:notice", addNotice);
  socket.on("call:user-joined", ({ id }) => {
    if (state.inCall && id !== state.selfId) createPeer(id, true);
  });
  socket.on("call:user-left", ({ id }) => removePeer(id));
  socket.on("signal:offer", handleOffer);
  socket.on("signal:answer", handleAnswer);
  socket.on("signal:ice", handleIce);
}

function joinChannel(channelId) {
  if (state.inCall) leaveCall();
  state.channelId = channelId;
  const channel = state.channels.find((item) => item.id === channelId);
  els.roomLabel.textContent = `# ${channel?.name || channelId}`;
  els.channelTitle.textContent = channel?.name || channelId;
  renderChannels();

  socket.emit("room:join", { channelId }, (response) => {
    if (!response?.ok) {
      addNotice(response?.error || "Не получилось войти в канал.");
      return;
    }

    state.selfId = response.selfId;
    state.channelId = response.channelId;
    els.messages.replaceChildren();
    response.messages.forEach(addMessage);
    renderPeople(response.users);
    addNotice("Вы вошли в канал");
  });
}

function hydrateProfile() {
  els.displayNameInput.value = state.user?.displayName || "";
  els.statusInput.value = state.user?.status || "В сети";
  setColor(state.user?.color || "#4f8cff");
}

function setColor(color) {
  state.color = color;
  document.documentElement.style.setProperty("--accent", color);
  els.swatches.forEach((button) => button.classList.toggle("active", button.dataset.color === color));
}

function renderChannels() {
  els.channelList.replaceChildren(
    ...state.channels.map((channel) => {
      const button = document.createElement("button");
      button.className = "channel-button";
      button.type = "button";
      button.classList.toggle("active", channel.id === state.channelId);
      button.textContent = `# ${channel.name}`;
      button.addEventListener("click", () => joinChannel(channel.id));

      const item = document.createElement("li");
      item.append(button);
      return item;
    })
  );
}

async function joinCall() {
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    state.inCall = true;
    addVideoTile(state.selfId, state.localStream, "Вы");
    socket.emit("call:join");
    els.callButton.textContent = "Выйти";
    els.callButton.classList.add("active");

    for (const user of state.users.values()) {
      if (user.id !== state.selfId && user.inCall) createPeer(user.id, true);
    }
  } catch {
    addNotice("Нет доступа к камере или микрофону.");
  }
}

function leaveCall() {
  if (!state.inCall && !state.localStream) return;

  socket?.emit("call:leave");
  stopScreenShare();
  state.localStream?.getTracks().forEach((track) => track.stop());
  state.localStream = null;
  state.inCall = false;
  state.muted = false;
  els.callButton.textContent = "Позвонить";
  els.callButton.classList.remove("active");
  els.muteButton.classList.remove("active");
  els.muteButton.textContent = "mic";

  for (const id of [...state.peers.keys()]) removePeer(id);
  document.querySelector(`[data-video-id="${CSS.escape(state.selfId)}"]`)?.remove();
  renderVideoEmptyState();
}

async function startScreenShare() {
  if (!state.inCall) return;

  try {
    state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = state.screenStream.getVideoTracks()[0];
    replaceVideoTrack(screenTrack);
    addVideoTile(state.selfId, state.screenStream, "Вы показываете экран");
    els.screenButton.classList.add("active");
    socket.emit("call:screen", true);
    screenTrack.addEventListener("ended", stopScreenShare, { once: true });
  } catch {
    addNotice("Демонстрация экрана отменена.");
  }
}

function stopScreenShare() {
  if (!state.screenStream) return;

  state.screenStream.getTracks().forEach((track) => track.stop());
  state.screenStream = null;
  const cameraTrack = state.localStream?.getVideoTracks()[0];
  if (cameraTrack) {
    replaceVideoTrack(cameraTrack);
    addVideoTile(state.selfId, state.localStream, "Вы");
  }
  els.screenButton.classList.remove("active");
  socket?.emit("call:screen", false);
}

function replaceVideoTrack(track) {
  for (const peer of state.peers.values()) {
    const sender = peer.getSenders().find((item) => item.track?.kind === "video");
    sender?.replaceTrack(track);
  }
}

function createPeer(id, politeOffer) {
  if (state.peers.has(id)) return state.peers.get(id);

  const peer = new RTCPeerConnection({ iceServers: state.iceServers });
  state.peers.set(id, peer);
  state.localStream?.getTracks().forEach((track) => peer.addTrack(track, state.localStream));

  peer.onicecandidate = (event) => {
    if (event.candidate) socket.emit("signal:ice", { to: id, candidate: event.candidate });
  };

  peer.ontrack = (event) => {
    const user = state.users.get(id);
    addVideoTile(id, event.streams[0], user?.name || "Друг");
  };

  peer.onconnectionstatechange = () => {
    if (["failed", "disconnected", "closed"].includes(peer.connectionState)) removePeer(id);
  };

  if (politeOffer) {
    peer.onnegotiationneeded = async () => {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socket.emit("signal:offer", { to: id, description: peer.localDescription });
    };
  }

  return peer;
}

async function handleOffer({ from, description }) {
  const peer = createPeer(from, false);
  await peer.setRemoteDescription(description);
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  socket.emit("signal:answer", { to: from, description: peer.localDescription });
}

async function handleAnswer({ from, description }) {
  const peer = state.peers.get(from);
  if (peer) await peer.setRemoteDescription(description);
}

async function handleIce({ from, candidate }) {
  const peer = state.peers.get(from);
  if (peer && candidate) await peer.addIceCandidate(candidate);
}

function removePeer(id) {
  state.peers.get(id)?.close();
  state.peers.delete(id);
  document.querySelector(`[data-video-id="${CSS.escape(id)}"]`)?.remove();
  renderVideoEmptyState();
}

function addVideoTile(id, stream, label) {
  document.querySelector(".empty-call")?.remove();
  let tile = document.querySelector(`[data-video-id="${CSS.escape(id)}"]`);

  if (!tile) {
    tile = document.createElement("article");
    tile.className = "video-tile";
    tile.dataset.videoId = id;
    tile.innerHTML = `<video autoplay playsinline></video><span class="video-label"></span>`;
    els.videoGrid.append(tile);
  }

  const video = tile.querySelector("video");
  video.srcObject = stream;
  video.muted = id === state.selfId;
  tile.querySelector(".video-label").textContent = label;
}

function renderVideoEmptyState() {
  if (els.videoGrid.children.length) return;

  const empty = document.createElement("div");
  empty.className = "empty-call";
  empty.innerHTML = "<strong>Звонок пока пуст</strong><span>Нажмите “Позвонить”, чтобы зайти в голос.</span>";
  els.videoGrid.append(empty);
}

function renderPeople(users) {
  els.onlineCount.textContent = users.length;
  els.peopleList.replaceChildren(
    ...users.map((user) => {
      const item = document.createElement("li");
      item.className = "person";
      item.innerHTML = `
        <div class="avatar" style="background:${escapeHtml(user.color)}">${escapeHtml(user.avatar)}</div>
        <div>
          <div class="person-name">${escapeHtml(user.name)}${user.id === state.selfId ? " · вы" : ""}</div>
          <div class="person-status">${escapeHtml(user.status || "В сети")}</div>
          <div class="badges">
            ${user.inCall ? '<span class="badge">в звонке</span>' : ""}
            ${user.sharingScreen ? '<span class="badge">экран</span>' : ""}
          </div>
        </div>
      `;
      return item;
    })
  );
}

function addMessage(message) {
  const item = document.createElement("article");
  item.className = "message";
  item.innerHTML = `
    <div class="avatar" style="background:${escapeHtml(message.color)}">${escapeHtml(message.avatar)}</div>
    <div>
      <div class="message-head">
        <span class="message-author">${escapeHtml(message.name)}</span>
        <time class="meta">${new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
      </div>
      <div class="message-text">${linkify(escapeHtml(message.text))}</div>
    </div>
  `;
  els.messages.append(item);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function addNotice(text) {
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.textContent = text;
  els.messages.append(notice);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    }[char];
  });
}

function linkify(value) {
  return value.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');
}

async function loadConfig() {
  try {
    const response = await fetch("/config.json");
    const config = await response.json();
    if (Array.isArray(config.iceServers) && config.iceServers.length) {
      state.iceServers = config.iceServers;
    }
  } catch {
    state.iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  }
}
