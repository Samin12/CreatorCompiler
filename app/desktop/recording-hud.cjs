const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {randomUUID}=require('node:crypto');

const COMMANDS=new Set(['pause','resume','stop','show-editor']);
function cleanState(value,initial=false){
 if(!value||typeof value!=='object')throw new Error('Invalid recording preview state.');
 const out={};
 for(const [key,max] of [['projectName',240],['script',100000],['cameraLabel',240],['microphoneLabel',240],['systemAudioLabel',240]])if(key in value){if(typeof value[key]!=='string'||value[key].length>max)throw new Error('Invalid '+key);out[key]=value[key];}
 if('countdown'in value){if(value.countdown!==null&&(!Number.isInteger(value.countdown)||value.countdown<1||value.countdown>3))throw new Error('Invalid recording countdown.');out.countdown=value.countdown;}
 if('status'in value){if(!['starting','recording','paused','saving','idle'].includes(value.status))throw new Error('Invalid recording status.');out.status=value.status;}
 if('elapsed'in value){if(!Number.isFinite(value.elapsed)||value.elapsed<0||value.elapsed>604800)throw new Error('Invalid recording clock.');out.elapsed=value.elapsed;}
 for(const key of ['cameraEnabled','mirror','hideMain'])if(key in value){if(typeof value[key]!=='boolean')throw new Error('Invalid '+key);out[key]=value[key];}
 if('cameraFrame'in value){if(value.cameraFrame!==null&&(typeof value.cameraFrame!=='string'||value.cameraFrame.length>350000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value.cameraFrame)))throw new Error('Invalid preview frame.');out.cameraFrame=value.cameraFrame;}
 if(initial)return {projectName:'Recording',script:'',cameraEnabled:false,mirror:false,hideMain:true,status:'starting',elapsed:0,...out};
 return out;
}

// Electron does not emit 'hide' for BrowserWindow.hide() on macOS, so the HUD reports
// each editor hide/show it makes through onMainVisibility instead of relying on that event.
function createRecordingHud({BrowserWindow,ipcMain,screen,getMainWindow,verifyMain,onMainVisibility=()=>{}}){
 let hud=null,state=null,hiddenMain=false,ready=null,ending=false,sessionId=null,synced=false;
 const documentURL=pathToFileURL(path.join(__dirname,'recording-hud.html')).href;
 const alive=w=>Boolean(w&&!w.isDestroyed());
 function verifyHud(e){if(!alive(hud)||e.sender!==hud.webContents||e.senderFrame!==hud.webContents.mainFrame||e.senderFrame.url!==documentURL)throw new Error('Untrusted recording preview.');}
 function restore(){const main=getMainWindow();if(hiddenMain&&alive(main)){main.show();main.focus();hiddenMain=false;onMainVisibility();}hiddenMain=false;}
 function end({restoreMain=true,id}={}){if(id&&id!==sessionId)return;ending=true;if(restoreMain)restore();else hiddenMain=false;if(alive(hud))hud.destroy();hud=null;state=null;ready=null;sessionId=null;synced=false;ending=false;}
 // The loaded HUD gets the full state once, then only changed fields (it merges);
 // the script is not re-sent with every clock tick.
 function publish(patch){if(!state||!alive(hud))return;if(synced||!patch){hud.webContents.send('recording-hud-state',synced&&patch?patch:state);synced=true;}const main=getMainWindow();if(!hiddenMain&&state.hideMain&&['recording','paused'].includes(state.status)&&alive(main)){main.hide();hiddenMain=true;onMainVisibility();}if(['saving','idle'].includes(state.status))restore();}
 async function begin(value){
  const next=cleanState(value,true);if(alive(hud))end();sessionId=randomUUID();synced=false;const id=sessionId;
  state=next;const main=getMainWindow(),display=screen.getDisplayMatching(alive(main)?main.getBounds():screen.getPrimaryDisplay().bounds),area=display.workArea;
  const width=Math.min(340,area.width),height=Math.min(660,area.height-24);
  hud=new BrowserWindow({width,height,minWidth:280,minHeight:240,maxWidth:620,x:Math.round(area.x+area.width-width-20),y:Math.round(area.y+Math.max(12,(area.height-height)/2)),title:'SceneForge recording preview',type:'panel',frame:false,transparent:true,backgroundColor:'#00000000',vibrancy:'under-window',visualEffectState:'active',show:false,resizable:true,alwaysOnTop:true,skipTaskbar:true,roundedCorners:true,webPreferences:{preload:path.join(__dirname,'recording-hud-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  // Defense in depth only. macOS ScreenCaptureKit also explicitly excludes this
  // application's PID in native-recording.swift; this flag alone is insufficient.
  hud.setContentProtection(true);hud.setAlwaysOnTop(true,'floating');
  // A panel joins full-screen Spaces without the Dock hide/show process transform.
  hud.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true,skipTransformProcessType:true});
  hud.webContents.setWindowOpenHandler(()=>({action:'deny'}));hud.webContents.on('will-navigate',e=>e.preventDefault());
  hud.on('close',e=>{if(!ending&&state&&['starting','recording','paused'].includes(state.status)){e.preventDefault();if(alive(getMainWindow()))getMainWindow().webContents.send('recording-hud-command','stop');}});
  hud.on('closed',()=>{hud=null;if(!ending)restore();});
  const current=hud;ready=current.loadFile(path.join(__dirname,'recording-hud.html')).then(()=>{if(hud===current&&alive(current)){current.showInactive();publish();}});
  try{await ready;return {id,visible:sessionId===id&&alive(hud)};}catch(e){end({id});throw e;}
 }
 const handlers={
  'begin-recording-hud':async(e,value)=>{verifyMain(e);return begin(value);},
  'update-recording-hud':(e,value,id)=>{verifyMain(e);const patch=cleanState(value);if(state&&(!id||id===sessionId)){state={...state,...patch};publish(patch);}return {visible:(!id||id===sessionId)&&alive(hud)};},
  'end-recording-hud':(e,id)=>{verifyMain(e);end({id});},
  'recording-hud-read':e=>{verifyHud(e);return state;},
  'recording-hud-command':(e,command)=>{verifyHud(e);if(!COMMANDS.has(command))throw new Error('Unknown recording action.');const main=getMainWindow();if(command==='show-editor'){if(state)state.hideMain=false;if(alive(main)){main.show();main.focus();hiddenMain=false;onMainVisibility();}return;}if(alive(main))main.webContents.send('recording-hud-command',command);}
 };
 for(const [name,handler]of Object.entries(handlers))ipcMain.handle(name,handler);
 // The HUD opens its own live camera preview: video only, from its exact document.
 function allowsCamera(contents,permission,details){return permission==='media'&&alive(hud)&&contents===hud.webContents&&details?.requestingUrl===documentURL&&details?.isMainFrame!==false&&Array.isArray(details?.mediaTypes)&&details.mediaTypes.length===1&&details.mediaTypes[0]==='video';}
 return {end,allowsCamera,dispose(){end({restoreMain:false});for(const name of Object.keys(handlers))ipcMain.removeHandler(name);}};
}
module.exports={createRecordingHud,cleanState};
