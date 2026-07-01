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
  verificationCodeLabel: document.querySelector("#verificationCodeLabel"),
  verificationCodeInput: document.querySelector("#verificationCodeInput"),
  authSubmit: document.querySelector("#authSubmit"),
  authError: document.querySelector("#authError"),
  profileForm: document.querySelector("#profileForm"),
  displayNameInput: document.querySelector("#displayNameInput"),
  statusInput: document.querySelector("#statusInput"),
  profileError: document.querySelector("#profileError"),
  accountSettingsButton: document.querySelector("#accountSettingsButton"),
  accountModal: document.querySelector("#accountModal"),
  accountCloseButton: document.querySelector("#accountCloseButton"),
  accountTabs: document.querySelectorAll("[data-account-tab]"),
  accountTabPanel: document.querySelector("#accountTabPanel"),
  deleteTabPanel: document.querySelector("#deleteTabPanel"),
  accountAvatar: document.querySelector("#accountAvatar"),
  accountDisplayName: document.querySelector("#accountDisplayName"),
  accountEmailText: document.querySelector("#accountEmailText"),
  accountForm: document.querySelector("#accountForm"),
  accountUsernameInput: document.querySelector("#accountUsernameInput"),
  accountEmailInput: document.querySelector("#accountEmailInput"),
  accountNewPasswordInput: document.querySelector("#accountNewPasswordInput"),
  accountCurrentPasswordInput: document.querySelector("#accountCurrentPasswordInput"),
  accountError: document.querySelector("#accountError"),
  deleteAccountForm: document.querySelector("#deleteAccountForm"),
  deletePasswordInput: document.querySelector("#deletePasswordInput"),
  deleteConfirmInput: document.querySelector("#deleteConfirmInput"),
  deleteAccountError: document.querySelector("#deleteAccountError"),
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
  cameraButton: document.querySelector("#cameraButton"),
  screenButton: document.querySelector("#screenButton"),
  audioDeviceSelect: document.querySelector("#audioDeviceSelect"),
  videoDeviceSelect: document.querySelector("#videoDeviceSelect"),
  outputDeviceSelect: document.querySelector("#outputDeviceSelect"),
  videoGrid: document.querySelector("#videoGrid"),
  swatches: document.querySelectorAll(".swatch")
};

const state = {
  authMode: "register",
  emailVerificationPending: false,
  token: localStorage.getItem("kolinkToken") || localStorage.getItem("noCommentsToken") || "",
  user: null,
  selfId: "",
  serverId: "home",
  channelId: "general",
  channels: [],
  color: "#4f8cff",
  users: new Map(),
  presenceTimer: null,
  peers: new Map(),
  remoteStreams: new Map(),
  speakingUsers: new Set(),
  voiceAnalysers: new Map(),
  connectionStates: new Map(),
  connectionWarnings: new Set(),
  voiceTimer: null,
  connectionTimer: null,
  audioContext: null,
  localStream: null,
  screenStream: null,
  inCall: false,
  muted: false,
  cameraEnabled: false,
  audioDeviceId: localStorage.getItem("kolinkAudioDeviceId") || "",
  videoDeviceId: localStorage.getItem("kolinkVideoDeviceId") || "",
  outputDeviceId: localStorage.getItem("kolinkOutputDeviceId") || "",
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

loadConfig();
setupScreenShareSupport();
updateCameraButton();
refreshMediaDevices();
navigator.mediaDevices?.addEventListener?.("devicechange", refreshMediaDevices);
boot();

els.loginTab.addEventListener("click", () => setAuthMode("login"));
els.registerTab.addEventListener("click", () => setAuthMode("register"));

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.authError.textContent = "";
  els.authSubmit.disabled = true;

  try {
    const path = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const payload = {
      email: els.emailInput.value,
      password: els.passwordInput.value
    };

    if (state.authMode === "register") {
      payload.username = els.usernameInput.value;
      if (state.emailVerificationPending) payload.code = els.verificationCodeInput.value;
    }

    const response = await api(path, { method: "POST", body: payload, skipAuth: true });
    if (response.verificationRequired) {
      showEmailVerificationStep(response.email);
      return;
    }

    if (response.error) {
      els.authError.textContent = response.error;
      return;
    }

    resetEmailVerificationStep();
    setSession(response.token, response.user);
    await enterApp();
  } finally {
    els.authSubmit.disabled = false;
  }
});

[els.usernameInput, els.emailInput, els.passwordInput].forEach((input) => {
  input.addEventListener("input", () => {
    if (state.emailVerificationPending) resetEmailVerificationStep();
  });
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
      avatar: (els.displayNameInput.value || state.user?.displayName || "K").slice(0, 2)
    }
  });

  if (response.error) {
    els.profileError.textContent = response.error;
    return;
  }

  state.user = response.user;
  socket.emit("profile:update", response.user);
});

els.accountSettingsButton.addEventListener("click", () => openAccountModal());
els.accountCloseButton.addEventListener("click", () => closeAccountModal());
els.accountModal.addEventListener("click", (event) => {
  if (event.target === els.accountModal) closeAccountModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.accountModal.hidden) closeAccountModal();
});

els.accountTabs.forEach((button) => {
  button.addEventListener("click", () => setAccountTab(button.dataset.accountTab));
});

els.accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.accountError.textContent = "";

  const response = await api("/api/account", {
    method: "PATCH",
    body: {
      username: els.accountUsernameInput.value,
      email: els.accountEmailInput.value,
      newPassword: els.accountNewPasswordInput.value,
      currentPassword: els.accountCurrentPasswordInput.value
    }
  });

  if (response.error) {
    els.accountError.textContent = response.error;
    return;
  }

  state.user = response.user;
  els.accountNewPasswordInput.value = "";
  els.accountCurrentPasswordInput.value = "";
  hydrateProfile();
  hydrateAccountModal();
  socket?.emit("profile:update", response.user);
  els.accountError.textContent = "Изменения сохранены.";
});

els.deleteAccountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.deleteAccountError.textContent = "";

  if (els.deleteConfirmInput.value.trim() !== "УДАЛИТЬ") {
    els.deleteAccountError.textContent = "Введите УДАЛИТЬ для подтверждения.";
    return;
  }

  const response = await api("/api/account", {
    method: "DELETE",
    body: {
      currentPassword: els.deletePasswordInput.value
    }
  });

  if (response.error) {
    els.deleteAccountError.textContent = response.error;
    return;
  }

  closeAccountModal();
  leaveCall();
  socket?.disconnect();
  stopPresencePolling();
  clearSession();
  els.authScreen.hidden = false;
  els.appShell.hidden = true;
  setAuthMode("register");
  els.authError.textContent = "Аккаунт удален.";
});

els.logoutButton.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  leaveCall();
  socket?.disconnect();
  stopPresencePolling();
  clearSession();
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
  updateVoiceState(state.selfId, false);
  updateParticipantIndicators(state.selfId);
});

els.cameraButton.addEventListener("click", () => {
  toggleCamera();
});

els.audioDeviceSelect.addEventListener("change", () => {
  state.audioDeviceId = els.audioDeviceSelect.value;
  localStorage.setItem("kolinkAudioDeviceId", state.audioDeviceId);
});

els.videoDeviceSelect.addEventListener("change", () => {
  state.videoDeviceId = els.videoDeviceSelect.value;
  localStorage.setItem("kolinkVideoDeviceId", state.videoDeviceId);
});

els.outputDeviceSelect.addEventListener("change", () => {
  state.outputDeviceId = els.outputDeviceSelect.value;
  localStorage.setItem("kolinkOutputDeviceId", state.outputDeviceId);
  applyOutputDevice();
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
    localStorage.removeItem("kolinkToken");
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

  await refreshMediaDevices();
  connectSocket();
  joinChannel(state.channelId);
  startPresencePolling();
}

function setSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("kolinkToken", token);
  localStorage.removeItem("noCommentsToken");
}

function clearSession() {
  localStorage.removeItem("kolinkToken");
  localStorage.removeItem("noCommentsToken");
  state.token = "";
  state.user = null;
}

function setAuthMode(mode) {
  state.authMode = mode;
  resetEmailVerificationStep();
  els.loginTab.classList.toggle("active", mode === "login");
  els.registerTab.classList.toggle("active", mode === "register");
  els.usernameLabel.hidden = mode !== "register";
  els.usernameInput.required = mode === "register";
  els.authSubmit.textContent = mode === "register" ? "Создать аккаунт" : "Войти";
  els.passwordInput.autocomplete = mode === "register" ? "new-password" : "current-password";
}

function showEmailVerificationStep(email) {
  state.emailVerificationPending = true;
  els.verificationCodeLabel.hidden = false;
  els.verificationCodeInput.required = true;
  els.verificationCodeInput.value = "";
  els.authSubmit.textContent = "Подтвердить код";
  els.authError.textContent = `Код отправлен на ${email}.`;
  els.verificationCodeInput.focus();
}

function resetEmailVerificationStep() {
  state.emailVerificationPending = false;
  els.verificationCodeLabel.hidden = true;
  els.verificationCodeInput.required = false;
  els.verificationCodeInput.value = "";
  els.authSubmit.textContent = state.authMode === "register" ? "Создать аккаунт" : "Войти";
}

function openAccountModal() {
  hydrateAccountModal();
  setAccountTab("account");
  els.accountModal.hidden = false;
  els.accountUsernameInput.focus();
}

function closeAccountModal() {
  els.accountModal.hidden = true;
  els.accountError.textContent = "";
  els.deleteAccountError.textContent = "";
  els.accountCurrentPasswordInput.value = "";
  els.accountNewPasswordInput.value = "";
  els.deletePasswordInput.value = "";
  els.deleteConfirmInput.value = "";
}

function hydrateAccountModal() {
  const user = state.user || {};
  els.accountAvatar.textContent = user.avatar || "K";
  els.accountAvatar.style.background = user.color || state.color;
  els.accountDisplayName.textContent = user.displayName || user.username || "Kolink";
  els.accountEmailText.textContent = user.email || "";
  els.accountUsernameInput.value = user.username || "";
  els.accountEmailInput.value = user.email || "";
}

function setAccountTab(tab) {
  const isDelete = tab === "delete";
  els.accountTabs.forEach((button) => button.classList.toggle("active", button.dataset.accountTab === tab));
  els.accountTabPanel.hidden = isDelete;
  els.deleteTabPanel.hidden = !isDelete;
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

  socket.on("connect", () => {
    if (state.user && !els.appShell.hidden && state.selfId) {
      joinChannel(state.channelId, { preserveCall: true, silent: true });
    }
  });

  socket.on("connect_error", () => {
    els.profileError.textContent = "Не удалось подключиться к realtime-серверу.";
  });

  socket.on("presence:update", (users) => {
    applyPresence(users);

    if (state.inCall) {
      for (const user of state.users.values()) {
        if (user.id !== state.selfId && user.inCall && !state.peers.has(user.id)) {
          createPeer(user.id, shouldOfferPeer(user.id));
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

function applyPresence(users = []) {
  const visibleUsers = normalizePresence(users);
  state.users = new Map(visibleUsers.map((user) => [user.id, user]));
  renderPeople(visibleUsers);
  syncRemoteVideoTiles(visibleUsers);
}

function normalizePresence(users = []) {
  const byAccount = new Map();
  const selfUserId = state.user?.id;

  for (const user of users) {
    const accountId = user.userId || user.id;
    const current = byAccount.get(accountId);
    if (!current || shouldReplacePresenceUser(current, user, selfUserId)) {
      byAccount.set(accountId, user);
    }
  }

  return [...byAccount.values()];
}

function shouldReplacePresenceUser(current, next, selfUserId) {
  if (selfUserId && next.userId === selfUserId && next.id === state.selfId) return true;
  if (selfUserId && current.userId === selfUserId && current.id === state.selfId) return false;
  if (next.inCall !== current.inCall) return Boolean(next.inCall);
  if (next.sharingScreen !== current.sharingScreen) return Boolean(next.sharingScreen);
  if (next.cameraOn !== current.cameraOn) return Boolean(next.cameraOn);
  return true;
}

function startPresencePolling() {
  stopPresencePolling();
  state.presenceTimer = window.setInterval(refreshPresence, 5000);
}

function stopPresencePolling() {
  if (!state.presenceTimer) return;
  window.clearInterval(state.presenceTimer);
  state.presenceTimer = null;
}

async function refreshPresence() {
  if (!state.token || els.appShell.hidden) return;

  const response = await api(`/api/presence?channelId=${encodeURIComponent(state.channelId)}`);
  if (!response.error) applyPresence(response.users);
}

function joinChannel(channelId, options = {}) {
  const { preserveCall = false, silent = false } = options;
  if (state.inCall && !preserveCall) leaveCall();
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
    applyPresence(response.users);
    if (!silent) addNotice("Вы вошли в канал");

    if (preserveCall && state.inCall) {
      socket.emit("call:join", { cameraOn: state.cameraEnabled, sharingScreen: Boolean(state.screenStream) });
    }
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
    const media = await getCallMedia();
    state.localStream = media.stream;
    state.inCall = true;
    state.cameraEnabled = media.video;
    setLocalCameraEnabled(state.cameraEnabled);
    addVideoTile(state.selfId, state.localStream, media.video ? "Вы" : "Вы · только голос");
    startVoiceActivity(state.selfId, state.localStream);
    startConnectionDiagnostics();
    socket.emit("call:join", { cameraOn: state.cameraEnabled, sharingScreen: false });
    els.callButton.textContent = "Выйти";
    els.callButton.classList.add("active");
    setDeviceControlsDisabled(true);
    updateCameraButton();
    if (!media.video) addNotice("Камера недоступна, вы вошли в звонок с микрофоном.");

    for (const user of state.users.values()) {
      if (user.id !== state.selfId && user.inCall) createPeer(user.id, shouldOfferPeer(user.id));
    }
  } catch (error) {
    addNotice(mediaErrorMessage(error));
  }
}

async function getCallMedia() {
  const audio = selectedDeviceConstraints("audio");
  const video = selectedDeviceConstraints("video");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video });
    await refreshMediaDevices();
    return { stream, video: true };
  } catch (cameraError) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      await refreshMediaDevices();
      return { stream, video: false };
    } catch (audioError) {
      throw audioError?.name ? audioError : cameraError;
    }
  }
}

function mediaErrorMessage(error) {
  const name = error?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Браузер запретил доступ к микрофону. Разрешите доступ в настройках сайта.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Микрофон или камера не найдены. Подключите устройство или выберите его в браузере.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Устройство занято другой программой. Закройте Discord, OBS, браузерные вкладки или перезапустите браузер.";
  }
  return "Не получилось получить доступ к микрофону или камере.";
}

async function toggleCamera() {
  if (!state.inCall) return;

  const cameraTrack = getCameraTrack();
  if (!cameraTrack) {
    addNotice("Камера недоступна на этом устройстве или не была разрешена браузером.");
    updateCameraButton();
    return;
  }

  state.cameraEnabled = !state.cameraEnabled;
  setLocalCameraEnabled(state.cameraEnabled);
  if (!state.screenStream) {
    await setOutboundVideoTrack(state.cameraEnabled ? cameraTrack : null);
  }
  socket?.emit("call:media", { cameraOn: state.cameraEnabled });
  updateLocalVideoTile();
  updateCameraButton();
}

function getCameraTrack() {
  return state.localStream?.getVideoTracks()[0] || null;
}

function setLocalCameraEnabled(enabled) {
  const cameraTrack = getCameraTrack();
  if (cameraTrack) cameraTrack.enabled = enabled;
}

function updateCameraButton() {
  const hasCamera = Boolean(getCameraTrack());
  els.cameraButton.disabled = !state.inCall || !hasCamera;
  els.cameraButton.classList.toggle("active", state.cameraEnabled && hasCamera);
  els.cameraButton.textContent = state.cameraEnabled && hasCamera ? "cam" : "off";
  els.cameraButton.title = state.cameraEnabled && hasCamera ? "Выключить камеру" : "Включить камеру";
}

function updateLocalVideoTile() {
  if (!state.inCall) return;
  if (state.screenStream) {
    addVideoTile(state.selfId, state.screenStream, "Вы показываете экран");
    return;
  }

  const label = getCameraTrack() && state.cameraEnabled ? "Вы" : "Вы · только голос";
  addVideoTile(state.selfId, state.localStream, label);
}

function leaveCall() {
  if (!state.inCall && !state.localStream) return;

  socket?.emit("call:leave");
  stopScreenShare({ renegotiate: false });
  state.localStream?.getTracks().forEach((track) => track.stop());
  state.localStream = null;
  state.inCall = false;
  state.muted = false;
  state.cameraEnabled = false;
  stopCallDiagnostics();
  els.callButton.textContent = "Позвонить";
  els.callButton.classList.remove("active");
  els.muteButton.classList.remove("active");
  els.muteButton.textContent = "mic";
  setDeviceControlsDisabled(false);
  updateCameraButton();

  for (const id of [...state.peers.keys()]) removePeer(id);
  document.querySelector(`[data-video-id="${CSS.escape(state.selfId)}"]`)?.remove();
  renderVideoEmptyState();
}

function selectedDeviceConstraints(kind) {
  const deviceId = kind === "audio" ? state.audioDeviceId : state.videoDeviceId;
  if (kind === "audio") {
    return {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {})
    };
  }

  return deviceId ? { deviceId: { exact: deviceId } } : true;
}

async function refreshMediaDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    renderDeviceOptions(els.audioDeviceSelect, [], state.audioDeviceId, "Микрофон");
    renderDeviceOptions(els.videoDeviceSelect, [], state.videoDeviceId, "Камера");
    renderDeviceOptions(els.outputDeviceSelect, [], state.outputDeviceId, "Динамики");
    updateOutputDeviceSupport();
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((device) => device.kind === "audioinput");
    const videoInputs = devices.filter((device) => device.kind === "videoinput");
    const audioOutputs = devices.filter((device) => device.kind === "audiooutput");
    state.audioDeviceId = normalizeSelectedDevice(state.audioDeviceId, audioInputs);
    state.videoDeviceId = normalizeSelectedDevice(state.videoDeviceId, videoInputs);
    state.outputDeviceId = normalizeSelectedDevice(state.outputDeviceId, audioOutputs);
    renderDeviceOptions(els.audioDeviceSelect, audioInputs, state.audioDeviceId, "Микрофон");
    renderDeviceOptions(els.videoDeviceSelect, videoInputs, state.videoDeviceId, "Камера");
    renderDeviceOptions(els.outputDeviceSelect, audioOutputs, state.outputDeviceId, "Динамики");
    updateOutputDeviceSupport();
    applyOutputDevice();
  } catch (error) {
    console.warn(error);
  }
}

function normalizeSelectedDevice(selectedId, devices) {
  return devices.some((device) => device.deviceId === selectedId) ? selectedId : "";
}

function renderDeviceOptions(select, devices, selectedId, fallbackLabel) {
  select.replaceChildren();

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = `${fallbackLabel}: по умолчанию`;
  select.append(defaultOption);

  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `${fallbackLabel} ${index + 1}`;
    option.selected = device.deviceId === selectedId;
    select.append(option);
  });
}

function canSelectOutputDevice() {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

function updateOutputDeviceSupport() {
  els.outputDeviceSelect.disabled = !canSelectOutputDevice();
  els.outputDeviceSelect.title = canSelectOutputDevice()
    ? "Выберите устройство вывода звука"
    : "Браузер не поддерживает выбор устройства вывода";
}

function applyOutputDevice() {
  document.querySelectorAll(".video-tile audio").forEach((audio) => setAudioOutput(audio));
}

async function setAudioOutput(audio) {
  if (!audio || !canSelectOutputDevice()) return;

  try {
    await audio.setSinkId(state.outputDeviceId || "");
  } catch (error) {
    console.warn(error);
  }
}

function setDeviceControlsDisabled(disabled) {
  els.audioDeviceSelect.disabled = disabled;
  els.videoDeviceSelect.disabled = disabled;
  updateOutputDeviceSupport();
}

function ensureAudioContext() {
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    state.audioContext = new AudioContextClass();
  }

  if (state.audioContext.state === "suspended") state.audioContext.resume?.().catch(() => {});
  return state.audioContext;
}

function startVoiceActivity(id, stream) {
  const audioTrack = stream?.getAudioTracks?.()[0];
  if (!id || !audioTrack) return;

  stopVoiceActivity(id);
  const audioContext = ensureAudioContext();
  if (!audioContext) return;

  try {
    const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    state.voiceAnalysers.set(id, {
      analyser,
      source,
      samples: new Uint8Array(analyser.fftSize),
      lastActiveAt: 0
    });
    startVoiceLoop();
  } catch (error) {
    console.warn(error);
  }
}

function stopVoiceActivity(id) {
  const entry = state.voiceAnalysers.get(id);
  if (entry) {
    try {
      entry.source.disconnect();
    } catch (error) {
      console.warn(error);
    }
  }
  state.voiceAnalysers.delete(id);
  updateVoiceState(id, false);
  if (!state.voiceAnalysers.size) stopVoiceLoop();
}

function startVoiceLoop() {
  if (state.voiceTimer) return;

  state.voiceTimer = window.setInterval(() => {
    const now = performance.now();
    for (const [id, entry] of state.voiceAnalysers) {
      entry.analyser.getByteTimeDomainData(entry.samples);
      let total = 0;
      for (const sample of entry.samples) {
        const centered = (sample - 128) / 128;
        total += centered * centered;
      }
      const level = Math.sqrt(total / entry.samples.length);
      const isLocalMuted = id === state.selfId && state.muted;
      if (!isLocalMuted && level > 0.035) entry.lastActiveAt = now;
      updateVoiceState(id, !isLocalMuted && now - entry.lastActiveAt < 450);
    }
  }, 120);
}

function stopVoiceLoop() {
  if (!state.voiceTimer) return;
  window.clearInterval(state.voiceTimer);
  state.voiceTimer = null;
}

function updateVoiceState(id, speaking) {
  if (!id) return;
  const changed = speaking ? !state.speakingUsers.has(id) : state.speakingUsers.has(id);
  if (speaking) state.speakingUsers.add(id);
  else state.speakingUsers.delete(id);
  if (changed) updateParticipantIndicators(id);
}

function startConnectionDiagnostics() {
  if (state.connectionTimer) return;

  state.connectionTimer = window.setInterval(updateConnectionDiagnostics, 2000);
  updateConnectionDiagnostics();
}

function stopCallDiagnostics() {
  stopVoiceLoop();
  for (const id of [...state.voiceAnalysers.keys()]) stopVoiceActivity(id);
  state.speakingUsers.clear();
  state.connectionStates.clear();
  state.connectionWarnings.clear();
  if (state.connectionTimer) {
    window.clearInterval(state.connectionTimer);
    state.connectionTimer = null;
  }
}

async function updateConnectionDiagnostics() {
  if (!state.inCall) return;

  await Promise.allSettled(
    [...state.peers.entries()].map(async ([id, peer]) => {
      if (peer.connectionState === "closed") return;

      const stats = [...(await peer.getStats()).values()];
      const pair = stats.find((item) => item.type === "candidate-pair" && item.state === "succeeded" && (item.selected || item.nominated))
        || stats.find((item) => item.type === "candidate-pair" && item.state === "succeeded");
      const local = pair ? stats.find((item) => item.id === pair.localCandidateId) : null;
      const remote = pair ? stats.find((item) => item.id === pair.remoteCandidateId) : null;
      const previous = state.connectionStates.get(id) || { bytesReceived: 0, lastBytesAt: performance.now() };
      const bytesReceived = pair?.bytesReceived || 0;
      const hasNewBytes = bytesReceived > previous.bytesReceived;
      const lastBytesAt = hasNewBytes ? performance.now() : previous.lastBytesAt;
      const relay = local?.candidateType === "relay" || remote?.candidateType === "relay";
      const rttMs = typeof pair?.currentRoundTripTime === "number"
        ? Math.max(1, Math.round(pair.currentRoundTripTime * 1000))
        : null;
      const isFailed = peer.connectionState === "failed" || peer.iceConnectionState === "failed";
      const isDisconnected = peer.connectionState === "disconnected" || peer.iceConnectionState === "disconnected";
      const isConnecting = ["new", "connecting"].includes(peer.connectionState)
        || ["new", "checking"].includes(peer.iceConnectionState)
        || !pair;
      const noIncomingData = !isConnecting && performance.now() - lastBytesAt > 7000;
      const unstable = isFailed || isDisconnected || noIncomingData;
      const label = isFailed
        ? "соединение потеряно"
        : isDisconnected
          ? "переподключение"
          : noIncomingData
            ? "нет входящих данных"
            : isConnecting
              ? "подключение"
              : relay
                ? "через сервер"
                : "прямое соединение";
      const next = {
        label: rttMs && !unstable && !isConnecting ? `${label} · ${rttMs} мс` : label,
        tone: unstable ? "warn" : relay ? "relay" : isConnecting ? "pending" : "ok",
        bytesReceived,
        lastBytesAt,
        rttMs
      };

      state.connectionStates.set(id, next);
      updateParticipantIndicators(id);
      if (unstable && !state.connectionWarnings.has(id)) {
        state.connectionWarnings.add(id);
        addNotice(`${label}: если звук или видео пропали, обновите страницу и проверьте устройство, сеть и TURN/порты.`);
      }
    })
  );
}

async function startScreenShare() {
  if (!state.inCall) {
    addNotice("Сначала войдите в звонок, потом включите демонстрацию экрана.");
    return;
  }
  if (!canShareScreen()) {
    addNotice("Этот браузер не умеет запускать демонстрацию экрана. Включите демонстрацию с ПК, а с телефона ее можно смотреть.");
    return;
  }

  try {
    state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const screenTrack = state.screenStream.getVideoTracks()[0];
    await setOutboundVideoTrack(screenTrack);
    addVideoTile(state.selfId, state.screenStream, "Вы показываете экран");
    els.screenButton.classList.add("active");
    els.screenButton.textContent = "stop";
    socket.emit("call:screen", true);
    socket.emit("call:media", { sharingScreen: true });
    screenTrack.addEventListener("ended", stopScreenShare, { once: true });
  } catch (error) {
    addNotice(screenShareErrorMessage(error));
  }
}

function setupScreenShareSupport() {
  if (canShareScreen()) return;

  els.screenButton.disabled = true;
  els.screenButton.title = "Демонстрация экрана доступна в браузере на компьютере";
}

function canShareScreen() {
  return Boolean(navigator.mediaDevices?.getDisplayMedia);
}

function screenShareErrorMessage(error) {
  const name = error?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Браузер не дал доступ к демонстрации экрана. Разрешите доступ или выберите окно заново.";
  }
  if (name === "NotFoundError" || name === "AbortError") {
    return "Демонстрация экрана отменена.";
  }
  if (name === "NotReadableError") {
    return "Не получилось захватить выбранное окно. Попробуйте выбрать весь экран или другое окно.";
  }
  return "Этот браузер не смог запустить демонстрацию экрана.";
}

async function stopScreenShare(options = {}) {
  const { renegotiate = true } = options;
  if (!state.screenStream) return;

  state.screenStream.getTracks().forEach((track) => track.stop());
  state.screenStream = null;
  const cameraTrack = state.localStream?.getVideoTracks()[0];
  if (cameraTrack && state.cameraEnabled) {
    if (renegotiate) await setOutboundVideoTrack(cameraTrack);
    addVideoTile(state.selfId, state.localStream, "Вы");
  } else {
    if (renegotiate) await setOutboundVideoTrack(null);
    addVideoTile(state.selfId, state.localStream, "Вы · только голос");
  }
  els.screenButton.classList.remove("active");
  els.screenButton.textContent = "screen";
  socket?.emit("call:screen", false);
  socket?.emit("call:media", { sharingScreen: false });
}

async function setOutboundVideoTrack(track) {
  const replacements = [];
  for (const [id, peer] of state.peers) {
    const sender = getVideoSender(peer);
    if (sender) {
      replacements.push(sender.replaceTrack(track));
    } else {
      const transceiver = peer.addTransceiver("video", { direction: "sendrecv" });
      peer._videoSender = transceiver.sender;
      replacements.push(transceiver.sender.replaceTrack(track));
      if (peer._shouldOffer) replacements.push(renegotiatePeer(id, peer));
    }
  }
  await Promise.allSettled(replacements);
  for (const [id, peer] of state.peers) {
    if (peer._shouldOffer) queuePeerNegotiation(id, peer);
  }
}

async function renegotiatePeer(id, peer) {
  if (peer.signalingState !== "stable" || peer._makingOffer) return;
  try {
    peer._makingOffer = true;
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit("signal:offer", { to: id, description: peer.localDescription });
  } finally {
    peer._makingOffer = false;
  }
}

function addOutboundTransceivers(peer) {
  const audioTrack = state.localStream?.getAudioTracks()[0] || null;
  const videoTrack = getCurrentVideoTrack();

  const audio = ensureOutboundTransceiver(peer, "audio", audioTrack, state.localStream);
  const video = ensureOutboundTransceiver(peer, "video", videoTrack, getCurrentVideoStream());

  peer._audioSender = audio.transceiver.sender;
  peer._videoSender = video.transceiver.sender;

  return Promise.allSettled([audio.replacement, video.replacement]);
}

function ensureOutboundTransceiver(peer, kind, track, stream) {
  let transceiver = getOutboundTransceiver(peer, kind);
  if (!transceiver) {
    transceiver = track
      ? peer.addTransceiver(track, { direction: "sendrecv", streams: stream ? [stream] : [] })
      : peer.addTransceiver(kind, { direction: "sendrecv" });
    if (kind === "audio") peer._audioTransceiver = transceiver;
    if (kind === "video") peer._videoTransceiver = transceiver;
    return { transceiver, replacement: Promise.resolve() };
  }

  transceiver.direction = "sendrecv";
  if (kind === "audio") peer._audioTransceiver = transceiver;
  if (kind === "video") peer._videoTransceiver = transceiver;
  return {
    transceiver,
    replacement: transceiver.sender.track === track ? Promise.resolve() : transceiver.sender.replaceTrack(track)
  };
}

function getOutboundTransceiver(peer, kind) {
  const cached = kind === "audio" ? peer._audioTransceiver : peer._videoTransceiver;
  if (cached && peer.getTransceivers().includes(cached)) return cached;

  const transceiver = peer.getTransceivers().find((item) => {
    return item.sender.track?.kind === kind || item.receiver.track?.kind === kind;
  });
  if (kind === "audio") peer._audioTransceiver = transceiver || null;
  if (kind === "video") peer._videoTransceiver = transceiver || null;
  return transceiver || null;
}

function getCurrentVideoTrack() {
  if (state.screenStream) return state.screenStream.getVideoTracks()[0] || null;
  const cameraTrack = getCameraTrack();
  return cameraTrack && state.cameraEnabled ? cameraTrack : null;
}

function getCurrentVideoStream() {
  return state.screenStream || state.localStream;
}

function getVideoSender(peer) {
  if (peer._videoSender) return peer._videoSender;
  peer._videoSender = peer.getSenders().find((sender) => sender.track?.kind === "video") || null;
  return peer._videoSender;
}

function queuePeerNegotiation(id, peer) {
  if (!peer._shouldOffer || peer._queuedOffer || peer.signalingState === "closed") return;
  peer._queuedOffer = true;
  queueMicrotask(async () => {
    peer._queuedOffer = false;
    try {
      await renegotiatePeer(id, peer);
    } catch (error) {
      addNotice("Не удалось обновить медиа-соединение. Попробуйте перезайти в звонок.");
      console.error(error);
    }
  });
}

function createPeer(id, shouldOffer) {
  if (state.peers.has(id)) {
    const peer = state.peers.get(id);
    if (shouldOffer && !peer._shouldOffer) {
      peer._shouldOffer = true;
      addOutboundTransceivers(peer);
      queuePeerNegotiation(id, peer);
    }
    return peer;
  }

  const peer = new RTCPeerConnection({ iceServers: state.iceServers });
  peer._shouldOffer = shouldOffer;
  peer._makingOffer = false;
  peer._ignoreOffer = false;
  peer._queuedOffer = false;
  peer._disconnectTimer = null;
  peer._pendingIce = [];
  state.peers.set(id, peer);

  peer.onnegotiationneeded = async () => {
    if (peer._shouldOffer) await renegotiatePeer(id, peer);
  };

  peer.onicecandidate = (event) => {
    if (event.candidate) socket.emit("signal:ice", { to: id, candidate: event.candidate });
  };

  peer.ontrack = (event) => {
    const user = state.users.get(id);
    const stream = getRemoteStream(id);
    if (!stream.getTracks().some((track) => track.id === event.track.id)) {
      stream.addTrack(event.track);
    }
    addVideoTile(id, stream, videoLabelForUser(user));
    if (event.track.kind === "audio") startVoiceActivity(id, stream);
    event.track.addEventListener("ended", () => {
      stream.removeTrack(event.track);
      if (event.track.kind === "audio") stopVoiceActivity(id);
      refreshRemoteVideoTile(id);
    });
    event.track.addEventListener("mute", () => refreshRemoteVideoTile(id));
    event.track.addEventListener("unmute", () => refreshRemoteVideoTile(id));
  };

  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "connected") {
      clearPeerDisconnectTimer(peer);
      return;
    }

    if (peer.connectionState === "disconnected") {
      clearPeerDisconnectTimer(peer);
      peer._disconnectTimer = window.setTimeout(() => {
        if (peer.connectionState === "disconnected") {
          removePeer(id);
          if (state.inCall && state.users.get(id)?.inCall) createPeer(id, shouldOfferPeer(id));
        }
      }, 5000);
      return;
    }

    if (["failed", "closed"].includes(peer.connectionState)) {
      removePeer(id);
      if (peer.connectionState === "failed" && state.inCall && state.users.get(id)?.inCall) {
        createPeer(id, shouldOfferPeer(id));
      }
    }
  };

  if (shouldOffer) {
    addOutboundTransceivers(peer);
    queuePeerNegotiation(id, peer);
  }

  return peer;
}

function shouldOfferPeer(id) {
  return Boolean(state.selfId && id && state.selfId.localeCompare(id) < 0);
}

async function handleOffer({ from, description }) {
  const peer = createPeer(from, false);
  peer._shouldOffer = false;

  if (peer.signalingState !== "stable") {
    try {
      await peer.setLocalDescription({ type: "rollback" });
    } catch (error) {
      console.warn(error);
    }
  }

  await peer.setRemoteDescription(description);
  await flushPendingIce(peer);
  await addOutboundTransceivers(peer);
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  socket.emit("signal:answer", { to: from, description: peer.localDescription });
}

async function handleAnswer({ from, description }) {
  const peer = state.peers.get(from);
  if (!peer) return;

  await peer.setRemoteDescription(description);
  await flushPendingIce(peer);
}

async function handleIce({ from, candidate }) {
  if (!candidate) return;

  const peer = state.peers.get(from) || createPeer(from, false);
  if (peer._ignoreOffer) return;

  if (!peer.remoteDescription) {
    peer._pendingIce.push(candidate);
    return;
  }

  await addIceCandidate(peer, candidate);
}

async function flushPendingIce(peer) {
  if (!peer._pendingIce?.length) return;

  const pending = peer._pendingIce.splice(0);
  for (const candidate of pending) {
    await addIceCandidate(peer, candidate);
  }
}

async function addIceCandidate(peer, candidate) {
  try {
    await peer.addIceCandidate(candidate);
  } catch (error) {
    if (!peer._ignoreOffer) throw error;
  }
}

function removePeer(id) {
  const peer = state.peers.get(id);
  if (peer) {
    clearPeerDisconnectTimer(peer);
    peer.close();
  }
  state.peers.delete(id);
  state.remoteStreams.delete(id);
  stopVoiceActivity(id);
  state.connectionStates.delete(id);
  state.connectionWarnings.delete(id);
  document.querySelector(`[data-video-id="${CSS.escape(id)}"]`)?.remove();
  renderVideoEmptyState();
}

function clearPeerDisconnectTimer(peer) {
  if (!peer?._disconnectTimer) return;
  window.clearTimeout(peer._disconnectTimer);
  peer._disconnectTimer = null;
}

function getRemoteStream(id) {
  if (!state.remoteStreams.has(id)) {
    state.remoteStreams.set(id, new MediaStream());
  }
  return state.remoteStreams.get(id);
}

function refreshRemoteVideoTile(id) {
  const user = state.users.get(id);
  const stream = state.remoteStreams.get(id);
  if (!stream || !stream.getTracks().length) {
    document.querySelector(`[data-video-id="${CSS.escape(id)}"]`)?.remove();
    renderVideoEmptyState();
    return;
  }
  addVideoTile(id, stream, videoLabelForUser(user));
}

function syncRemoteVideoTiles(users) {
  const liveUserIds = new Set(users.filter((user) => user.inCall).map((user) => user.id));
  for (const id of [...state.remoteStreams.keys()]) {
    if (!liveUserIds.has(id)) removePeer(id);
  }

  for (const user of users) {
    if (user.id === state.selfId || !user.inCall) continue;

    const stream = state.remoteStreams.get(user.id);
    if (stream || user.sharingScreen) addVideoTile(user.id, stream || new MediaStream(), videoLabelForUser(user));
  }
}

function videoLabelForUser(user) {
  if (!user) return "Друг";
  return user.sharingScreen ? `${user.name || "Друг"} показывает экран` : user.name || "Друг";
}

function addVideoTile(id, stream, label) {
  document.querySelector(".empty-call")?.remove();
  let tile = document.querySelector(`[data-video-id="${CSS.escape(id)}"]`);
  const hasVideo = hasDisplayableVideo(id, stream);

  if (!tile) {
    tile = document.createElement("article");
    tile.className = "video-tile";
    tile.dataset.videoId = id;
    tile.innerHTML = `<video autoplay playsinline></video><audio autoplay playsinline></audio><div class="audio-only-tile">VOICE</div><button class="fullscreen-button" type="button" title="Открыть на весь экран">⛶</button><span class="video-label"></span><span class="voice-label"></span><span class="connection-label"></span>`;
    tile.querySelector(".fullscreen-button").addEventListener("click", (event) => {
      event.stopPropagation();
      openTileFullscreen(tile);
    });
    tile.addEventListener("dblclick", () => openTileFullscreen(tile));
    els.videoGrid.append(tile);
  }

  const video = tile.querySelector("video");
  video.srcObject = new MediaStream(stream?.getVideoTracks() || []);
  video.muted = true;
  video.hidden = !hasVideo;
  video.play?.().catch(() => {});
  const audio = tile.querySelector("audio");
  audio.srcObject = new MediaStream(id === state.selfId ? [] : stream?.getAudioTracks() || []);
  audio.muted = id === state.selfId;
  setAudioOutput(audio);
  audio.play?.().catch(() => {});
  tile.querySelector(".audio-only-tile").hidden = hasVideo;
  tile.querySelector(".fullscreen-button").hidden = !hasVideo;
  tile.querySelector(".video-label").textContent = label;
  updateParticipantIndicators(id);
}

async function openTileFullscreen(tile) {
  const video = tile.querySelector("video");
  try {
    if (tile.requestFullscreen) {
      await tile.requestFullscreen();
      return;
    }
    if (tile.webkitRequestFullscreen) {
      tile.webkitRequestFullscreen();
      return;
    }
    if (video?.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
    }
  } catch {
    addNotice("Не удалось открыть видео на весь экран. Попробуйте нажать на само видео.");
  }
}

function hasDisplayableVideo(id, stream) {
  const mediaState = id === state.selfId
    ? { cameraOn: state.cameraEnabled, sharingScreen: Boolean(state.screenStream) }
    : state.users.get(id);
  const hasKnownMediaState = typeof mediaState?.cameraOn === "boolean" || typeof mediaState?.sharingScreen === "boolean";
  if (hasKnownMediaState && !mediaState.cameraOn && !mediaState.sharingScreen) return false;

  return stream?.getVideoTracks().some((track) => {
    return track.readyState === "live" && track.enabled !== false;
  }) || false;
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
      item.dataset.personId = user.id;
      item.innerHTML = `
        <div class="avatar" style="background:${escapeHtml(user.color)}">${escapeHtml(user.avatar)}</div>
        <div>
          <div class="person-name">${escapeHtml(user.name)}${user.id === state.selfId ? " · вы" : ""}</div>
          <div class="person-status">${escapeHtml(user.status || "В сети")}</div>
          <div class="badges">
            ${user.inCall ? '<span class="badge">в звонке</span>' : ""}
            ${user.sharingScreen ? '<span class="badge">экран</span>' : ""}
            <span class="badge voice-badge" hidden></span>
          </div>
        </div>
      `;
      window.setTimeout(() => updateParticipantIndicators(user.id), 0);
      return item;
    })
  );
}

function updateParticipantIndicators(id) {
  const speaking = state.speakingUsers.has(id);
  const muted = id === state.selfId && state.muted;
  const connection = state.connectionStates.get(id);
  const tile = document.querySelector(`[data-video-id="${CSS.escape(id)}"]`);
  if (tile) {
    tile.classList.toggle("speaking", speaking);
    tile.classList.toggle("muted", muted);
    const voiceLabel = tile.querySelector(".voice-label");
    if (voiceLabel) {
      voiceLabel.hidden = !speaking && !muted;
      voiceLabel.textContent = muted ? "микрофон выключен" : "говорит";
    }
    const connectionLabel = tile.querySelector(".connection-label");
    if (connectionLabel) {
      connectionLabel.hidden = !connection || id === state.selfId;
      connectionLabel.textContent = connection?.label || "";
      connectionLabel.dataset.tone = connection?.tone || "";
    }
  }

  const person = document.querySelector(`[data-person-id="${CSS.escape(id)}"]`);
  if (!person) return;
  person.classList.toggle("speaking", speaking);
  const voiceBadge = person.querySelector(".voice-badge");
  if (voiceBadge) {
    voiceBadge.hidden = !speaking && !muted;
    voiceBadge.textContent = muted ? "микрофон выкл." : "говорит";
  }
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
