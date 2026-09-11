const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('strokeDesktop', {
  config: () => ipcRenderer.invoke('stroke:config'),
  openProject: () => ipcRenderer.invoke('stroke:openProject'),
  adoptProject: (id) => ipcRenderer.invoke('stroke:adoptProject', id),
  openVideo: () => ipcRenderer.invoke('stroke:openVideo'),
  saveProject: (text, name) => ipcRenderer.invoke('stroke:saveProject', text, name),
  resetProject: () => ipcRenderer.invoke('stroke:resetProject'),
  rememberVideo: (id) => ipcRenderer.invoke('stroke:rememberVideo', id),
  recover: () => ipcRenderer.invoke('stroke:recover'),
  snapshot: (text, dirty) => ipcRenderer.invoke('stroke:snapshot', text, dirty),
  dirty: (value) => ipcRenderer.send('stroke:dirty', value),
  theme: (value) => ipcRenderer.send('stroke:theme', value),
});
