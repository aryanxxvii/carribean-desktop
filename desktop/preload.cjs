const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('carribean', {
  call: (action, payload) => ipcRenderer.invoke('carribean:library', action, payload)
});
