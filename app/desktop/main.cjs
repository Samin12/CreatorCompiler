const { app, BrowserWindow, ipcMain, dialog, shell, desktopCapturer, screen, session, utilityProcess, Menu, globalShortcut, systemPreferences, nativeTheme } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const {runtimeEnvironment}=require('./runtime.cjs');
const {createCaptureManager}=require('./capture.cjs');
const {createRecordingHud}=require('./recording-hud.cjs');
const {createNativeRecordingManager}=require('./native-recording.cjs');
const {createCaptureBorder}=require('./capture-border.cjs');
const {createMediaPermissionRequests}=require('./media-permissions.cjs');
let mainWindow, service, captureManager, recordingHud, nativeRecording, captureBorder, ownService = false, quitting = false;
const PORT=4174, base=`http://127.0.0.1:${PORT}`;
const projectRoot=path.resolve(__dirname,'..');
const emptyShortcutContext=()=>({workspace:'home',editable:false,timelineFocused:false,availableActions:[],bindings:{}});
let shortcutContext=emptyShortcutContext(),lastShortcutStatus='',lastMenuSignature='';
const registeredShortcuts=new Map();
const menuBindings={undo:['Z',['Mod']],redo:['Z',['Mod','Shift']],cut:['X',['Mod']],copy:['C',['Mod']],paste:['V',['Mod']],selectAll:['A',['Mod']],closeProject:['W',['Mod']],zoomIn:['=',['Mod']],zoomOut:['-',['Mod']]};
const globalBindings={record:'KeyR',stopRecord:'KeyE',pauseRecord:'KeyY',previousSentence:'ArrowUp',nextSentence:'ArrowDown',previousWord:'ArrowLeft',nextWord:'ArrowRight'};
const nativePermissionRequests=createMediaPermissionRequests({getStatus:getNativeMediaStatus,ask:kind=>systemPreferences.askForMediaAccess(kind),isActive:()=>!quitting&&Boolean(mainWindow&&!mainWindow.isDestroyed())});
const privacyPanes=Object.freeze({camera:'Privacy_Camera',microphone:'Privacy_Microphone',screen:'Privacy_ScreenCapture','system-audio':'Privacy_AudioCapture'});
function getNativeMediaStatus(kind){
 if(process.platform!=='darwin')return 'unsupported';
 try{const status=systemPreferences.getMediaAccessStatus(kind);return ['not-determined','granted','denied','restricted','unknown'].includes(status)?status:'unknown';}catch{return 'unknown';}
}
function getMediaPermissions(){
 return {platform:process.platform,camera:getNativeMediaStatus('camera'),microphone:getNativeMediaStatus('microphone'),screen:getNativeMediaStatus('screen'),systemAudio:process.platform==='darwin'?'unknown':'unsupported'};
}
async function requestMediaPermission(kind){
 return nativePermissionRequests.request(kind);
}
async function openPrivacySettings(section){
 if(typeof section!=='string'||!Object.hasOwn(privacyPanes,section))throw new Error('Unknown privacy settings section.');
 if(process.platform!=='darwin')throw new Error('Native privacy settings are only available on macOS.');
 await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?'+privacyPanes[section]);
}
function verifyDesktopSender(event){
 if(!mainWindow||mainWindow.isDestroyed()||event.sender!==mainWindow.webContents||event.senderFrame!==mainWindow.webContents.mainFrame)throw new Error('Untrusted window');
 try{if(new URL(event.senderFrame.url).origin===base)return;}catch{}
 throw new Error('Untrusted window');
}
function bindingList(action){
 if(Object.hasOwn(shortcutContext.bindings,action))return shortcutContext.bindings[action];
 if(globalBindings[action])return [{kind:'keyboard',code:globalBindings[action],modifiers:['Meta','Control','Shift']}];
 const entry=menuBindings[action];return entry?[{kind:'keyboard',key:entry[0],modifiers:entry[1]}]:[];
}
function acceleratorFor(binding){
 if(!binding||binding.kind!=='keyboard'||!Array.isArray(binding.modifiers))return null;
 const modifiers=[];
 for(const m of binding.modifiers){const value={Mod:process.platform==='darwin'?'Command':'Control',Meta:process.platform==='darwin'?'Command':'Super',Control:'Control',Alt:'Alt',Shift:'Shift'}[m];if(!value)return null;if(!modifiers.includes(value))modifiers.push(value);}
 let key=binding.code||binding.key;if(typeof key!=='string')return null;
 if(/^Key[A-Z]$/.test(key))key=key.slice(3);else if(/^Digit[0-9]$/.test(key))key=key.slice(5);
 key=({ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',' ':'Space','+':'Plus',Esc:'Escape'})[key]||key;
 if(!/^(?:[A-Za-z0-9=,./;\[\]\\'-]|Space|Tab|Enter|Escape|Backspace|Delete|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(key))return null;
 return [...modifiers,key.length===1?key.toUpperCase():key].join('+');
}
function available(action){return shortcutContext.availableActions.includes(action);}
function editorMenuActive(){return shortcutContext.workspace==='edit'&&shortcutContext.timelineFocused&&!shortcutContext.editable;}
function appUndoActive(action){return ['undo','redo'].includes(action)&&!shortcutContext.editable&&available(action);}
function emitShortcut(action){if(mainWindow&&!mainWindow.isDestroyed()&&available(action))mainWindow.webContents.send('shortcut-action',action);}
function reportShortcutStatus(conflicts=[]){
 const status={active:['record','teleprompter'].includes(shortcutContext.workspace),registered:[...registeredShortcuts].map(([accelerator,action])=>({action,accelerator})),conflicts};
 const serialized=JSON.stringify(status);if(serialized!==lastShortcutStatus&&mainWindow&&!mainWindow.isDestroyed()){lastShortcutStatus=serialized;mainWindow.webContents.send('shortcut-status',status)}return status;
}
function clearGlobalShortcuts(){for(const accelerator of registeredShortcuts.keys())globalShortcut.unregister(accelerator);registeredShortcuts.clear();}
function updateGlobalShortcuts(){
 const desired=new Map(),conflicts=[];
 if(['record','teleprompter'].includes(shortcutContext.workspace))for(const action of Object.keys(globalBindings)){
  if(!available(action))continue;
  for(const binding of bindingList(action).slice(0,3)){
   const accelerator=acceleratorFor(binding);
   if(!accelerator){conflicts.push({action,accelerator:'',reason:'Unsupported global keyboard binding.'});continue}
   if(desired.has(accelerator)&&desired.get(accelerator)!==action){conflicts.push({action,accelerator,reason:'Another recorder action uses this binding.'});continue}
   desired.set(accelerator,action);
  }
 }
 for(const [accelerator,action] of registeredShortcuts)if(desired.get(accelerator)!==action){globalShortcut.unregister(accelerator);registeredShortcuts.delete(accelerator)}
 for(const [accelerator,action] of desired)if(!registeredShortcuts.has(accelerator)){
  try{if(globalShortcut.register(accelerator,()=>emitShortcut(action)))registeredShortcuts.set(accelerator,action);else conflicts.push({action,accelerator,reason:'Unavailable: another application or macOS owns this shortcut.'})}
  catch(error){conflicts.push({action,accelerator,reason:error.message||'Registration failed.'})}
 }
 return reportShortcutStatus(conflicts);
}
function installMenu(){
 const signature=JSON.stringify({editor:editorMenuActive(),editable:shortcutContext.editable,available:shortcutContext.availableActions,bindings:shortcutContext.bindings});if(signature===lastMenuSignature)return;lastMenuSignature=signature;
 const editItem=(action,label)=>editorMenuActive()||appUndoActive(action)?{id:action,label,accelerator:bindingList(action).map(acceleratorFor).find(Boolean)||undefined,enabled:available(action),click:()=>emitShortcut(action)}:{role:action};
 const viewZoom=editorMenuActive()?[{id:'zoomIn',label:'Zoom Timeline In',accelerator:bindingList('zoomIn').map(acceleratorFor).find(Boolean)||undefined,enabled:available('zoomIn'),click:()=>emitShortcut('zoomIn')},{id:'zoomOut',label:'Zoom Timeline Out',accelerator:bindingList('zoomOut').map(acceleratorFor).find(Boolean)||undefined,enabled:available('zoomOut'),click:()=>emitShortcut('zoomOut')}]:[{role:'zoomIn'},{role:'zoomOut'}];
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'SceneForge',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{type:'separator'},{role:'quit'}]},{label:'File',submenu:[{id:'closeProject',label:'Close Project',accelerator:bindingList('closeProject').map(acceleratorFor).find(Boolean)||undefined,enabled:available('closeProject'),click:()=>emitShortcut('closeProject')}]},{label:'Edit',submenu:[editItem('undo','Undo'),editItem('redo','Redo'),{type:'separator'},editItem('cut','Cut'),editItem('copy','Copy'),editItem('paste','Paste'),editItem('selectAll','Select All')]},{label:'View',submenu:[{role:'reload'},{role:'toggleDevTools'},{type:'separator'},{role:'resetZoom'},...viewZoom,{role:'togglefullscreen'}]},{label:'Window',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}]}]));
}
function inputMatches(input,binding){
 if(binding?.kind!=='keyboard')return false;
 const physical=m=>m==='Mod'?(process.platform==='darwin'?'Meta':'Control'):m;
 const expected=new Set((Array.isArray(binding.modifiers)?binding.modifiers:[]).map(physical));const actual=[input.meta&&'Meta',input.control&&'Control',input.alt&&'Alt',input.shift&&'Shift'].filter(Boolean);
 if(actual.length!==expected.size||actual.some(m=>!expected.has(m)))return false;
 if(binding.code)return input.code===binding.code;
 const normalize=s=>s===' '?'Space':typeof s==='string'&&s.length===1?s.toUpperCase():s;
 return normalize(input.key)===normalize(binding.key);
}
function routeNativeInput(event,input){
 if(input.type!=='keyDown')return;
 // OS-registered shortcuts are already dispatched by globalShortcut, not a DOM key event.
 for(const [accelerator,action] of registeredShortcuts)if(bindingList(action).some(b=>acceleratorFor(b)===accelerator&&inputMatches(input,b))){event.preventDefault();return;}
 const actions=Object.keys(menuBindings).filter(action=>action==='closeProject'||editorMenuActive()||appUndoActive(action));
 for(const action of actions)if(available(action)&&bindingList(action).some(binding=>inputMatches(input,binding))){event.preventDefault();if(!input.isAutoRepeat)emitShortcut(action);return;}
}
function setShortcutContext(value){
 const workspaces=['home','script','record','edit','teleprompter'];
 if(!value||!workspaces.includes(value.workspace))throw new Error('Invalid shortcut workspace.');
 const actions=Array.isArray(value.availableActions)?value.availableActions.filter(a=>typeof a==='string'&&a.length<80).slice(0,100):[];
 const bindings={};if(value.bindings&&typeof value.bindings==='object')for(const action of new Set([...Object.keys(menuBindings),...Object.keys(globalBindings)]))if(Object.hasOwn(value.bindings,action)){
  if(!Array.isArray(value.bindings[action]))throw new Error('Shortcut bindings must be arrays.');bindings[action]=value.bindings[action].slice(0,3);
 }
 shortcutContext={workspace:value.workspace,editable:value.editable===true,timelineFocused:value.timelineFocused===true,availableActions:actions,bindings};installMenu();return updateGlobalShortcuts();
}
function resetShortcutContext(){shortcutContext=emptyShortcutContext();clearGlobalShortcuts();installMenu();reportShortcutStatus();}
app.setName('SceneForge');
const gotLock=app.requestSingleInstanceLock();
if(!gotLock)app.quit();
app.on('second-instance',()=>{if(mainWindow){mainWindow.show();mainWindow.focus();}});
// /api/ready answers as soon as the service listens (no media probing); an older
// already-running service only has /api/health. A port holder that never answers
// times out so the start deadline still applies.
async function serviceAnswers(){
 for(const route of ['/api/ready','/api/health']){const r=await fetch(base+route,{signal:AbortSignal.timeout(route==='/api/ready'?2000:10000)});if(route==='/api/ready'&&r.status===404){await r.body?.cancel();continue;}const health=await r.json();return r.ok&&health.application==='SceneForge'&&health.version==='0.1.0';}
 return false;
}
async function startService(){
 try {if(await serviceAnswers())return;}catch{}
 const entry=path.join(projectRoot,'server-dist/index.mjs');
 const env=runtimeEnvironment({root:projectRoot,data:path.join(app.getPath('userData'),'studio'),port:PORT});
 if(fs.existsSync(entry))service=utilityProcess.fork(entry,[],{env,stdio:'pipe',serviceName:'SceneForge media service'});
 else service=spawn(process.env.SCENEFORGE_NODE||process.env.npm_node_execpath||'node',['--import','tsx',path.join(projectRoot,'server/index.ts')],{cwd:projectRoot,env,stdio:'pipe'});
 ownService=true;
 service.stdout?.on('data',d=>console.log(d.toString()));service.stderr?.on('data',d=>console.error(d.toString()));
 for(const deadline=Date.now()+30000;Date.now()<deadline;){try{if(await serviceAnswers())return;}catch{}await new Promise(r=>setTimeout(r,40));}
 throw new Error('The local media service did not start. Reopen SceneForge and check that port 4174 is available.');
}
// Hidden/minimized editor: the renderer pauses decorative work, the recorder stops previews.
// Focus re-checks too, so a stale value cannot outlive the window coming forward.
let mainVisibility=null;
function publishMainVisibility(){
 if(!mainWindow||mainWindow.isDestroyed())return;const visible=mainWindow.isVisible()&&!mainWindow.isMinimized();if(visible===mainVisibility)return;mainVisibility=visible;
 mainWindow.webContents.send('main-window-visibility',visible);nativeRecording?.setPreviewEnabled?.(visible);
}
app.whenReady().then(async()=>{
 // The window and its renderer process start while the service boots; the page
 // itself is served by the service, so it loads once the service answers.
 const serviceReady=startService();serviceReady.catch(()=>{});
 mainWindow=new BrowserWindow({width:1480,height:960,minWidth:1000,minHeight:680,title:'SceneForge',show:false,backgroundColor:nativeTheme.shouldUseDarkColors?'#0a0a0a':'#f7f7fa',titleBarStyle:'hiddenInset',trafficLightPosition:{x:16,y:20},webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 const trusted=(url)=>{try{return new URL(url).origin===base;}catch{return false;}};
 session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(!quitting&&(trusted(contents.getURL())&&['media','display-capture'].includes(permission)||Boolean(recordingHud?.allowsCamera(contents,permission,details)))));
 captureManager=createCaptureManager({BrowserWindow,desktopCapturer,screen,ipcMain,session,systemPreferences,getMainWindow:()=>mainWindow,origin:base});
 // The system picker bypasses this handler. Our explicit source choice still requires
 // macOS Screen Recording consent, and never falls back to a different source.
 session.defaultSession.setDisplayMediaRequestHandler((request,callback)=>captureManager.handleRequest(request,callback),{useSystemPicker:false});
 ipcMain.handle('list-capture-sources',e=>captureManager.list(e));
 ipcMain.handle('choose-capture-source',(e,options)=>captureManager.choose(e,options));
 ipcMain.handle('restore-capture-source',(e,selection)=>captureManager.restore(e,selection));
 ipcMain.handle('cancel-capture-selection',(e,token)=>captureManager.cancel(e,token));
 recordingHud=createRecordingHud({BrowserWindow,ipcMain,screen,getMainWindow:()=>mainWindow,verifyMain:verifyDesktopSender});
 captureBorder=createCaptureBorder({BrowserWindow});
 nativeRecording=createNativeRecordingManager({ipcMain,getMainWindow:()=>mainWindow,origin:base,dataDir:path.join(app.getPath('userData'),'studio'),onState:event=>captureBorder.update(event),onPrepare:event=>{if(event.recordVideo)captureBorder.prewarm();}});
 const verify=(e)=>{if(!trusted(e.senderFrame.url))throw new Error('Untrusted window');};
 ipcMain.handle('shortcut-context',(e,value)=>{verify(e);if(e.sender!==mainWindow.webContents)throw new Error('Untrusted shortcut sender');return setShortcutContext(value);});
 ipcMain.handle('media-permissions',e=>{verifyDesktopSender(e);return getMediaPermissions();});
 ipcMain.handle('request-media-permission',(e,kind)=>{verifyDesktopSender(e);return requestMediaPermission(kind);});
 ipcMain.handle('open-privacy-settings',(e,section)=>{verifyDesktopSender(e);return openPrivacySettings(section);});
 ipcMain.handle('choose-folder',async e=>{verifyDesktopSender(e);const result=await dialog.showOpenDialog(mainWindow,{title:'Choose a project or media folder',properties:['openDirectory','createDirectory']});return result.canceled?null:result.filePaths[0]??null;});
 mainWindow.webContents.on('before-input-event',routeNativeInput);
 mainWindow.webContents.on('did-start-loading',resetShortcutContext);
 mainWindow.webContents.on('did-start-loading',()=>{captureManager.reset();recordingHud.end();void nativeRecording.reset?.();});
 mainWindow.webContents.on('render-process-gone',resetShortcutContext);
 mainWindow.webContents.on('render-process-gone',()=>{captureManager.reset();recordingHud.end();void nativeRecording.reset?.();});
 mainWindow.webContents.on('did-start-loading',()=>{mainVisibility=null;});
 for(const name of ['show','hide','minimize','restore','focus'])mainWindow.on(name,publishMainVisibility);
 mainWindow.once('ready-to-show',()=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.show();});
 mainWindow.on('closed',()=>{recordingHud.end({restoreMain:false});void nativeRecording.reset?.();captureManager.reset();clearGlobalShortcuts();shortcutContext=emptyShortcutContext();mainWindow=null;});
 ipcMain.handle('choose-media',async e=>{verify(e);const result=await dialog.showOpenDialog(mainWindow,{title:'Import media',properties:['openFile','multiSelections'],filters:[{name:'Video, audio and images',extensions:['mp4','mov','webm','mkv','wav','mp3','m4a','aac','flac','png','jpg','jpeg','webp','gif']} ]});return result.canceled?[]:result.filePaths;});
 ipcMain.handle('choose-borumi',async e=>{verify(e);const result=await dialog.showOpenDialog(mainWindow,{title:'Import a Borumi project',properties:['openFile','openDirectory','treatPackageAsDirectory'],filters:[{name:'Borumi project',extensions:['bmproj','bmprojbundle']}]});return result.canceled?null:result.filePaths[0];});
 ipcMain.handle('reveal',async(e,file)=>{verify(e);if(typeof file!=='string'||!path.isAbsolute(file))throw new Error('Invalid path');shell.showItemInFolder(file);});
 mainWindow.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url))shell.openExternal(url);return {action:'deny'};});
 mainWindow.webContents.on('will-navigate',(e,url)=>{if(!trusted(url)){e.preventDefault();if(/^https?:/.test(url))shell.openExternal(url);}});
 installMenu();
 try{await serviceReady;}catch(e){if(quitting)return;dialog.showErrorBox('SceneForge could not start',e.message);if(mainWindow&&!mainWindow.isDestroyed())mainWindow.destroy();app.quit();return;}
 if(!mainWindow||mainWindow.isDestroyed())return;
 try{await mainWindow.loadURL(base);}finally{if(mainWindow&&!mainWindow.isDestroyed()&&!mainWindow.isVisible())mainWindow.show();}
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',e=>{if(quitting)return;e.preventDefault();quitting=true;captureBorder?.clear();recordingHud?.dispose();captureManager?.dispose();clearGlobalShortcuts();Promise.resolve(nativeRecording?.dispose()).catch(console.error).finally(()=>{if(ownService)service?.kill();app.quit();});});
