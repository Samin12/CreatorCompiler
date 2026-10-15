const{contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('recordingPreview',{
 read:()=>ipcRenderer.invoke('recording-hud-read'),
 command:value=>ipcRenderer.invoke('recording-hud-command',value),
 layout:value=>ipcRenderer.invoke('recording-hud-layout',value),
 subscribe:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('recording-hud-state',listener);return()=>ipcRenderer.removeListener('recording-hud-state',listener);}
});
