'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

function nativeOptions(input, directory, hostPid) {
 if (!input || typeof input !== 'object' || typeof input.systemAudio !== 'boolean') throw Error('Choose native recording sources.');
 const recordVideo = input.recordVideo !== false;
 if (!recordVideo && !input.systemAudio) throw Error('Choose screen recording or system audio.');
 const options = { command: 'start', directory, excludePids: [hostPid], recordVideo, systemAudio: input.systemAudio, fps: 30, maxDimension: 1920 };
 if (input.fps !== undefined) { if (!Number.isInteger(input.fps) || input.fps < 10 || input.fps > 60) throw Error('Capture FPS must be 10–60.'); options.fps = input.fps; }
 if (input.maxDimension !== undefined) { if (!Number.isInteger(input.maxDimension) || input.maxDimension < 320 || input.maxDimension > 4096) throw Error('Capture size must be 320–4096.'); options.maxDimension = input.maxDimension; }
 const selection = input.selection;
 if (!selection) { if (recordVideo) throw Error('Choose a screen, window or region first.'); return options; }
 if (!['display','region','window'].includes(selection.kind)) throw Error('Invalid capture selection.');
 if (selection.kind === 'window') {
  const match = /^window:(\d+):\d+$/.exec(selection.sourceId || '');
  if (!match) throw Error('The window selection is invalid.'); options.windowId = Number(match[1]);
 } else {
  if (!/^\d+$/.test(String(selection.displayId || ''))) throw Error('The display selection is invalid.');
  options.displayId = Number(selection.displayId);
  if (selection.kind === 'region') {
   const r = selection.crop?.normalized;
   if (!r || !['x','y','width','height'].every(k => typeof r[k] === 'number' && Number.isFinite(r[k])) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x+r.width > 1.000001 || r.y+r.height > 1.000001) throw Error('The capture region is invalid.');
   options.region = {x:r.x,y:r.y,width:r.width,height:r.height};
  }
 }
 return options;
}

function createNativeRecordingManager({ipcMain,getMainWindow,origin,dataDir,helperPath=path.resolve(__dirname,'../server-dist/sceneforge-screen-recorder'),spawnProcess=spawn,hostPid=process.pid,platform=process.platform,onState,onPrepare,spareIdleMs=120000}) {
 let current, disposed = false, resetting, generation = 0, spare = null, previewWanted = true;
 const verify = event => { const window = getMainWindow(); if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('Untrusted native recording request.'); let actual; try { actual = new URL(event.senderFrame.url).origin; } catch {} if (actual !== origin) throw Error('Untrusted native recording origin.'); };
 const publish = value => { const window = getMainWindow(); if (window && !window.isDestroyed()) window.webContents.send('native-recording-event', value); };
 const deliverState = (session,message) => {if(!['started','paused','resumed','stopped','error','bounds'].includes(message.type))return;try{onState?.({id:session.id,...message,selection:structuredClone(session.input.selection),recordVideo:session.input.recordVideo!==false});}catch{}};
 const flushState = session => {const pending=session.pendingState;session.pendingState=null;for(const message of pending||[])deliverState(session,message);};
 const notifyState = (session,message) => {flushState(session);deliverState(session,message);};
 // 'started' window work (the capture border) runs after the start reply is sent;
 // any later state for the session flushes it first, so order is kept.
 const notifyLater = (session,message) => {flushState(session);session.pendingState=[message];setImmediate(()=>flushState(session));};
 const mainVisible = () => {const window=getMainWindow();return Boolean(window&&!window.isDestroyed()&&window.isVisible?.()!==false&&!window.isMinimized?.());};
 const status = async () => ({available: platform === 'darwin' && await fs.access(helperPath).then(()=>true,()=>false),engine:'ScreenCaptureKit',excludesSceneForge:true});
 const result = session => ({id:session.id,...session.result,status:session.status});
 function fail(session, error) {
  if (session.status === 'complete' || session.status === 'failed') return;
  session.status = 'failed'; session.result.error = error.message;
  for (const waiter of session.waiters.values()) { clearTimeout(waiter.timer); waiter.reject(error); } session.waiters.clear();
  publish({id:session.id,type:'error',message:error.message});
  notifyState(session,{type:'error',message:error.message});
  try { session.child.kill('SIGTERM'); } catch {}
  const timer=setTimeout(()=>{try{session.child.kill('SIGKILL');}catch{}},1500);timer.unref();session.killTimer=timer;
 }
 function wait(session, type, timeout) {
  if (session.waiters.has(type)) return session.waiters.get(type).promise;
  let resolve,reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no;});
  const timer=setTimeout(()=>fail(session,Error(`Native recording ${type} timed out.`)),timeout);timer.unref();session.waiters.set(type,{promise,resolve,reject,timer});return promise;
 }
 function settle(session,type) {const waiter=session.waiters.get(type);if(waiter){clearTimeout(waiter.timer);session.waiters.delete(type);waiter.resolve(result(session));}}
 // A spare helper launched when the recorder asks for status has its process
 // and AVFoundation warm-up done before the start command arrives. It does no
 // capture until then.
 function dropSpare(){const entry=spare;spare=null;if(!entry)return;clearTimeout(entry.timer);try{entry.child.kill('SIGTERM');}catch{}}
 function prewarm(){
  if(disposed||resetting||spare||platform!=='darwin'||current&&!['complete','failed'].includes(current.status))return;
  let child;try{child=spawnProcess(helperPath,[],{stdio:['pipe','pipe','pipe'],env:{...process.env}});}catch{return;}
  const entry={child,timer:setTimeout(()=>{if(spare===entry)dropSpare();},spareIdleMs)};entry.timer.unref?.();spare=entry;
  child.on('error',()=>{if(spare===entry)dropSpare();});child.stdin.on('error',()=>{});child.once('close',()=>{if(spare===entry){clearTimeout(entry.timer);spare=null;}});
 }
 function takeSpare(){const entry=spare;spare=null;if(!entry)return null;clearTimeout(entry.timer);return entry.child.exitCode!=null||entry.child.signalCode!=null?null:entry.child;}
 function write(session, command) {if(session.status==='failed')throw Error(session.result.error);session.child.stdin.write(JSON.stringify({command})+'\n');}
 async function start(input) {
  if (disposed) throw Error('Native recording is shutting down.');
  if (resetting) throw Error('The previous native recording is still closing.');
  const epoch=generation;
  if (current && !['complete','failed'].includes(current.status)) throw Error('A native recording is already active.');
  if (!(await status()).available) throw Error('Native screen capture is unavailable in this build.');
  if(disposed||epoch!==generation)throw Error('Native recording start was cancelled.');
  input=structuredClone(input);const options=nativeOptions(input,'',hostPid),root=path.join(dataDir,'native-recordings');await fs.mkdir(root,{recursive:true,mode:0o700});
  const directory=await fs.mkdtemp(path.join(root,'take-'));options.directory=directory;
  if (disposed || epoch!==generation || current && !['complete','failed'].includes(current.status)) {await fs.rm(directory,{recursive:true,force:true});throw Error('A native recording is already active or closing.');}
  const session={id:randomUUID(),directory,input,status:'starting',result:{excludesSceneForge:true},waiters:new Map(),child:null,buffer:'',previewBusy:false};current=session;
  let child;try{child=takeSpare()||spawnProcess(helperPath,[],{stdio:['pipe','pipe','pipe'],env:{...process.env}});}catch(e){session.status='failed';await fs.rm(directory,{recursive:true,force:true});throw e;}session.child=child;session.closed=new Promise(resolve=>{session.resolveClosed=resolve;});
  const started=wait(session,'started',90000);let stderr='';
  child.stdin.on('error',e=>fail(session,e));child.on('error',e=>fail(session,e));
  child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-8000);});
  child.stdout.on('data',data=>{
   session.buffer+=data.toString();if(session.buffer.length>1000000)return fail(session,Error('Native capture protocol exceeded its buffer limit.'));
   let index;while((index=session.buffer.indexOf('\n'))>=0){const line=session.buffer.slice(0,index);session.buffer=session.buffer.slice(index+1);let message;try{message=JSON.parse(line);}catch{return fail(session,Error('Invalid native capture response.'));}
    if(message.type==='error'){fail(session,Error(message.message||'Native recording failed.'));continue;}
    if(session.status==='failed')continue;
    if(message.type==='bounds'){notifyState(session,message);continue;}
    if(message.type==='started'){session.status='recording';session.previewControl=message.previewControl===true;session.result={...session.result,startedAtMs:message.startedAtMs,width:message.width,height:message.height,captureBounds:message.captureBounds};settle(session,'started');if(!previewWanted)setPreview(session,false);notifyLater(session,message);publish({id:session.id,...message});continue;}
    else if(message.type==='paused'){session.status='paused';session.result.duration=message.duration;session.result.transitionAtMs=message.transitionAtMs;settle(session,'paused');}
    else if(message.type==='resumed'){session.status='recording';session.result.duration=message.duration;session.result.transitionAtMs=message.transitionAtMs;settle(session,'resumed');}
    else if(message.type==='stopped'){
     if(session.status==='failed')continue;
     const output={...message};delete output.type;
     for(const key of ['videoPath','audioPath'])if(output[key]&&path.dirname(output[key])!==session.directory){fail(session,Error('Native capture returned an unexpected output path.'));return;}
     if(message.error){fail(session,Error(message.error));continue;}
     if(!message.videoPath&&!message.audioPath){fail(session,Error(message.warning||'Native recording produced no media.'));continue;}
     session.status='complete';session.result={...session.result,...output};settle(session,'stopped');
    } else if(message.type==='preview'){
     if(session.previewBusy||!mainVisible()||path.resolve(message.path||'')!==path.join(session.directory,'preview.jpg'))continue;
     session.previewBusy=true;void fs.readFile(message.path).then(data=>{if(data.length<=1000000&&session.status==='recording')publish({id:session.id,type:'preview',image:'data:image/jpeg;base64,'+data.toString('base64'),width:message.width,height:message.height});}).catch(()=>{}).finally(()=>{session.previewBusy=false;});continue;
    }
    notifyState(session,message);
    publish({id:session.id,...message});
   }
  });
  child.once('close',(code,signal)=>{if(session.killTimer)clearTimeout(session.killTimer);if(!['complete','failed'].includes(session.status))fail(session,Error(`Native capture closed unexpectedly (${signal||code}). ${stderr}`));session.resolveClosed();});
  child.stdin.write(JSON.stringify(options)+'\n');try{onPrepare?.({recordVideo:options.recordVideo});}catch{}return started;
 }
 // Previews are for the editor window only; the helper stops making them while it is hidden.
 // Its switch follows the window's hide/show events, not isVisible(), which may also
 // count occlusion and would leave previews off with no event to turn them back on.
 function setPreview(session,enabled){if(session?.previewControl&&['recording','paused'].includes(session.status))try{session.child.stdin.write(JSON.stringify({command:'preview',enabled})+'\n');}catch{}}
 const setPreviewEnabled=enabled=>{previewWanted=enabled===true;setPreview(current,previewWanted);};
 const sessionFor=id=>{if(!current||current.id!==id)throw Error('Native recording session not found.');return current;};
 async function pause(id){const s=sessionFor(id);if(s.status==='paused')return result(s);if(s.status!=='recording')throw Error('Recording is not active.');const p=wait(s,'paused',10000);write(s,'pause');return p;}
 async function resume(id){const s=sessionFor(id);if(s.status==='recording')return result(s);if(s.status!=='paused')throw Error('Recording is not paused.');const p=wait(s,'resumed',10000);write(s,'resume');return p;}
 async function stop(id){const s=sessionFor(id);if(s.status==='complete')return result(s);if(s.status==='stopping')return wait(s,'stopped',30000);if(!['recording','paused'].includes(s.status))throw Error(s.result.error||'Native recording has not started.');s.status='stopping';const p=wait(s,'stopped',30000);write(s,'stop');return p;}
 const handlers={'native-recording-status':async event=>{verify(event);const value=await status();if(value.available)prewarm();return value;},'native-recording-start':async(event,input)=>{verify(event);return start(input);},'native-recording-pause':async(event,id)=>{verify(event);return pause(id);},'native-recording-resume':async(event,id)=>{verify(event);return resume(id);},'native-recording-stop':async(event,id)=>{verify(event);return stop(id);}};
 for(const [name,handler]of Object.entries(handlers))ipcMain.handle(name,handler);
 async function reset(){if(resetting)return resetting;generation++;dropSpare();const session=current;resetting=(async()=>{if(session&&!['complete','failed'].includes(session.status)){if(session.status==='starting')fail(session,Error('Recording window closed before capture started.'));else await stop(session.id).catch(()=>{});}if(session?.closed){let timer;try{await Promise.race([session.closed,new Promise(resolve=>{timer=setTimeout(()=>{try{session.child.kill('SIGKILL');}catch{}resolve();},2500);timer.unref();})]);}finally{clearTimeout(timer);}}})();try{await resetting;}finally{resetting=undefined;}}
 async function dispose(){disposed=true;for(const name of Object.keys(handlers))ipcMain.removeHandler(name);await reset();}
 return {status,start,pause,resume,stop,reset,dispose,prewarm,setPreviewEnabled};
}
module.exports={createNativeRecordingManager,nativeOptions};
