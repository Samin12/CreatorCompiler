'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('capturePicker', {
 getData: () => ipcRenderer.invoke('capture-ui-data'),
 finish: value => ipcRenderer.invoke('capture-ui-finish', value),
 cancel: () => ipcRenderer.invoke('capture-ui-finish', null)
});
