const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('strokeDesktop', {
  config: () => ipcRenderer.invoke('stroke:config'),
  openProject: () => ipcRenderer.invoke('stroke:openProject'),
  adoptProject: (id) => ipcRenderer.invoke('stroke:adoptProject', id),
  openVideo: () => ipcRenderer.invoke('stroke:openVideo'),
  saveProject: (text, name) => ipcRenderer.invoke('stroke:saveProject', text, name),
  saveImage: (data, name) => ipcRenderer.invoke('stroke:saveImage', data, name),
  resetProject: () => ipcRenderer.invoke('stroke:resetProject'),
  rememberVideo: (id) => ipcRenderer.invoke('stroke:rememberVideo', id),
  recover: () => ipcRenderer.invoke('stroke:recover'),
  snapshot: (text, dirty) => ipcRenderer.invoke('stroke:snapshot', text, dirty),
  dirty: (value) => ipcRenderer.send('stroke:dirty', value),
  theme: (value) => ipcRenderer.send('stroke:theme', value),
  installUpdate: () => ipcRenderer.invoke('stroke:installUpdate'),
  retryUpdate: () => ipcRenderer.invoke('stroke:retryUpdate'),
  onUpdate: (fn) => {
    const listener = (_event, update) => fn(update);
    ipcRenderer.on('stroke:update', listener);
    return () => ipcRenderer.removeListener('stroke:update', listener);
  },
});
