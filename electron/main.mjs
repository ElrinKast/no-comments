import { app, BrowserWindow, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import { join } from "node:path";
import { startServer } from "../server.js";

let server;
let mainWindow;

async function readConfig() {
  try {
    const raw = await fs.readFile(join(app.getPath("userData"), "config.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeConfig(config) {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(join(app.getPath("userData"), "config.json"), JSON.stringify(config, null, 2));
}

async function createWindow() {
  const config = await readConfig();
  const configuredUrl = process.env.SERVER_URL || config.serverUrl;
  let appUrl = configuredUrl;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: "#111318",
    title: "No Comment`s",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(import.meta.dirname, "preload.mjs")
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (appUrl) {
    await mainWindow.loadURL(appUrl);
    return;
  }

  await mainWindow.loadFile(join(import.meta.dirname, "connect.html"));
}

async function loadLocalServer() {
  if (!server) {
    const port = Number(process.env.PORT || 3000);
    server = await startServer(port);
  }

  await mainWindow.loadURL(`http://localhost:${server.port}`);
}

ipcMain.handle("connect:remote", async (_event, serverUrl) => {
  const url = String(serverUrl || "").trim().replace(/\/$/, "");
  if (!/^https?:\/\/.+/i.test(url)) {
    return { ok: false, error: "Введите адрес с http:// или https://." };
  }

  await writeConfig({ serverUrl: url });
  await mainWindow.loadURL(url);
  return { ok: true };
});

ipcMain.handle("connect:local", async () => {
  await loadLocalServer();
  return { ok: true };
});

ipcMain.handle("connect:reset", async () => {
  await writeConfig({});
  await mainWindow.loadFile(join(import.meta.dirname, "connect.html"));
  return { ok: true };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", async () => {
  if (process.platform !== "darwin") {
    await server?.close();
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
