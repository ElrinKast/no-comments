import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("noComments", {
  connectRemote: (serverUrl) => ipcRenderer.invoke("connect:remote", serverUrl),
  connectLocal: () => ipcRenderer.invoke("connect:local"),
  resetConnection: () => ipcRenderer.invoke("connect:reset")
});
