import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createRecordingHud,cleanState}=require('../desktop/recording-hud.cjs');
const {createCaptureBorder,borderBounds}=require('../desktop/capture-border.cjs');
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function harness(){
 const windows:any[]=[],handlers=new Map<string,Function>();
 class Window extends EventEmitter {
  dead=false;visible=false;shown=0;focused=0;hidden=0;protected=false;ignored=false;resolve!:()=>void;reject!:(e:Error)=>void;options:any;
  webContents:any=Object.assign(new EventEmitter(),{mainFrame:{url:''},messages:[] as any[],send:(...args:any[])=>this.webContents.messages.push(args),setWindowOpenHandler:(fn:Function)=>{this.webContents.openHandler=fn}});
  constructor(options:any){super();this.options=options;windows.push(this)}
  isDestroyed(){return this.dead}destroy(){this.dead=true;this.emit('closed')}show(){this.visible=true;this.shown++}showInactive(){this.show()}hide(){this.visible=false;this.hidden++}focus(){this.focused++}
  setBounds(bounds:any){this.options={...this.options,...bounds}}
  getBounds(){const {x,y,width,height}=this.options;return{x,y,width,height};}
  workspaces:any[]=[];setContentProtection(v:boolean){this.protected=v}setIgnoreMouseEvents(v:boolean){this.ignored=v}setAlwaysOnTop(){}setVisibleOnAllWorkspaces(...args:any[]){this.workspaces=args}
  loadFile(file:string){this.webContents.mainFrame.url=new URL('file://'+file).href;return new Promise<void>((resolve,reject)=>{this.resolve=resolve;this.reject=reject})}
 }
 const main={dead:false,shown:0,hidden:0,focused:0,isDestroyed(){return this.dead},show(){this.shown++},hide(){this.hidden++},focus(){this.focused++},getBounds:()=>({x:-1512,y:-40,width:900,height:600}),webContents:Object.assign(new EventEmitter(),{mainFrame:{url:'http://127.0.0.1:4174/'},messages:[] as any[],send(...args:any[]){this.messages.push(args)}})};
 const mainEvent={sender:main.webContents,senderFrame:main.webContents.mainFrame};
 const opts={BrowserWindow:Window,ipcMain:{handle:(name:string,fn:Function)=>handlers.set(name,fn),removeHandler:(name:string)=>handlers.delete(name)},screen:{getDisplayMatching:()=>({workArea:{x:-1512,y:-40,width:1512,height:982}}),getPrimaryDisplay:()=>({bounds:{x:0,y:0,width:1920,height:1080}})},getMainWindow:()=>main,verifyMain:(e:any)=>{if(e.sender!==main.webContents||e.senderFrame!==main.webContents.mainFrame)throw Error('Untrusted main')}};
 const call=(name:string,...args:any[])=>handlers.get(name)!(mainEvent,...args),hudEvent=(w=windows.at(-1))=>({sender:w.webContents,senderFrame:w.webContents.mainFrame});
 return {windows,handlers,main,opts,call,hudEvent};
}
async function opened(h:ReturnType<typeof harness>,value:any={status:'recording'}){const promise=h.call('begin-recording-hud',value),w=h.windows.at(-1);w.resolve();return {...await promise,w};}

test('HUD opens compact and expanding preview panels preserves the control bar position without recording commands',async()=>{
 const h=harness(),m=createRecordingHud(h.opts);try{
  const {w}=await opened(h,{status:'recording',cameraEnabled:true,script:'Read this'});
  assert.ok(w.options.height<=120,'compact controller does not open a large camera/script window');
  const before={x:w.options.x,y:w.options.y};
  h.handlers.get('recording-hud-layout')!(h.hudEvent(),{camera:true,script:true});
  assert.ok(w.options.height>300);assert.deepEqual({x:w.options.x,y:w.options.y},before);assert.equal(h.main.webContents.messages.length,0);
  h.handlers.get('recording-hud-layout')!(h.hudEvent(),{camera:false,script:false});assert.ok(w.options.height<=120);assert.equal(h.main.webContents.messages.length,0);
 }finally{m.dispose();}
});

test('HUD remembers panels and bounds between sessions and clamps a disconnected display',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'hud-preferences-')),preferencesPath=path.join(dir,'hud.json');
 let h=harness(),m=createRecordingHud({...h.opts,preferencesPath});
 try{
  const {w}=await opened(h,{status:'recording',cameraEnabled:true,script:'Script'});h.handlers.get('recording-hud-layout')!(h.hudEvent(),{camera:false,script:true});w.setBounds({x:-1200,y:100,width:420,height:410});h.call('end-recording-hud');m.dispose();
  h=harness();m=createRecordingHud({...h.opts,preferencesPath});const next=await opened(h,{status:'recording',cameraEnabled:true,script:'Script'});
  assert.equal(next.w.options.width,420);assert.equal(next.w.options.x,-1200);assert.ok(next.w.options.height>300);assert.deepEqual(h.handlers.get('recording-hud-read')!(h.hudEvent()).layout,{camera:false,script:true});
  h.call('end-recording-hud');m.dispose();
  fs.writeFileSync(preferencesPath,JSON.stringify({bounds:{x:9000,y:9000,width:420,height:410},layout:{camera:false,script:true}}));
  h=harness();m=createRecordingHud({...h.opts,preferencesPath});const moved=await opened(h,{status:'recording',cameraEnabled:true,script:'Script'});
  assert.ok(moved.w.options.x+moved.w.options.width<=0);assert.ok(moved.w.options.y+moved.w.options.height<=942);
 }finally{m.dispose();fs.rmSync(dir,{recursive:true,force:true});}
});

test('restored script remains readable after an intervening take with no script',async()=>{
 const h=harness(),m=createRecordingHud(h.opts);try{
  await opened(h,{status:'recording',script:'First script'});h.handlers.get('recording-hud-layout')!(h.hudEvent(),{camera:false,script:true});h.call('end-recording-hud');
  const plain=await opened(h,{status:'recording',script:''});assert.ok(plain.w.options.height<=120);h.call('end-recording-hud');
  const scripted=await opened(h,{status:'recording',script:'Next script'});assert.ok(scripted.w.options.height>=400,'expanded script has room after a compact no-script take');
 }finally{m.dispose();}
});

test('HUD accepts only trusted main and exact HUD main frame; blocks windows/navigation',async()=>{const h=harness(),m=createRecordingHud(h.opts);try{
 assert.throws(()=>h.handlers.get('update-recording-hud')!({sender:{},senderFrame:{}},{}),/Untrusted/);await assert.rejects(h.handlers.get('begin-recording-hud')!({sender:{},senderFrame:{}},{}),/Untrusted/);
 const {w}=await opened(h);assert.deepEqual(w.webContents.openHandler(),{action:'deny'});let blocked=false;w.webContents.emit('will-navigate',{preventDefault:()=>blocked=true});assert.equal(blocked,true);assert.equal(w.protected,true);
 assert.throws(()=>h.handlers.get('recording-hud-read')!({sender:w.webContents,senderFrame:{...w.webContents.mainFrame}}),/Untrusted/);
 assert.throws(()=>h.handlers.get('recording-hud-read')!({sender:{},senderFrame:w.webContents.mainFrame}),/Untrusted/);
 assert.throws(()=>h.handlers.get('recording-hud-command')!(h.hudEvent(),'exec'),/Unknown/);
 h.handlers.get('recording-hud-command')!(h.hudEvent(),'pause');assert.deepEqual(h.main.webContents.messages.at(-1),['recording-hud-command','pause']);
 }finally{m.dispose()}});

test('HUD bounds text/JPEG payloads and rejects remote/script image sources',()=>{
 const data='data:image/jpeg;base64,/9j/';assert.equal(cleanState({cameraFrame:data}).cameraFrame,data);
 for(const cameraFrame of ['https://example.test/image','data:image/svg+xml;base64,AAAA','data:image/jpeg;base64,<script>',data+'A'.repeat(350000)])assert.throws(()=>cleanState({cameraFrame}));
 assert.throws(()=>cleanState({script:'x'.repeat(100001)}));assert.throws(()=>cleanState({projectName:'x'.repeat(241)}));assert.throws(()=>cleanState({elapsed:NaN}));assert.throws(()=>cleanState({countdown:0}));assert.deepEqual(cleanState({unknown:'ignored'}),{});
});

test('HUD accepts measured microphone levels and rejects invalid telemetry',()=>{
 assert.equal(cleanState({microphoneLevel:.4}).microphoneLevel,.4);assert.equal(cleanState({microphoneLevel:null}).microphoneLevel,null);
 for(const microphoneLevel of [-1,2,NaN,'loud'])assert.throws(()=>cleanState({microphoneLevel}));
});

test('HUD stale IDs and late load success cannot close or publish a replacement',async()=>{const h=harness(),m=createRecordingHud(h.opts);try{
 const first=h.call('begin-recording-hud',{projectName:'First',status:'recording'}),one=h.windows[0];const second=await opened(h,{projectName:'Second',status:'recording'});one.resolve();const stale=await first;assert.equal(stale.visible,false);assert.equal(one.shown,0);
 assert.equal(h.call('update-recording-hud',{projectName:'Wrong'},stale.id).visible,false);h.call('end-recording-hud',stale.id);assert.equal(second.w.dead,false);assert.equal(h.handlers.get('recording-hud-read')!(h.hudEvent()).projectName,'Second');
 }finally{m.dispose()}});

test('HUD late load failure is isolated and end during loading never shows an orphan',async()=>{const h=harness(),m=createRecordingHud(h.opts);try{
 const old=h.call('begin-recording-hud',{}),one=h.windows[0];const caught=assert.rejects(old,/old failed/);const current=await opened(h);one.reject(Error('old failed'));await caught;assert.equal(current.w.dead,false);
 const pending=h.call('begin-recording-hud',{}),w=h.windows.at(-1);m.end();w.resolve();assert.equal((await pending).visible,false);assert.equal(w.shown,0);assert.equal(w.dead,true);
 }finally{m.dispose()}});

test('HUD Show editor remains visible on subsequent status/frame publishes; saving/error/close restores main',async()=>{const h=harness(),m=createRecordingHud(h.opts);try{
 const one=await opened(h);assert.equal(h.main.hidden,1);h.handlers.get('recording-hud-command')!(h.hudEvent(),'show-editor');const hidden=h.main.hidden;h.call('update-recording-hud',{elapsed:4,cameraFrame:'data:image/jpeg;base64,/9j/'},one.id);assert.equal(h.main.hidden,hidden);assert.ok(h.main.shown>0);
 const next=await opened(h);const shown=h.main.shown;h.call('update-recording-hud',{status:'saving'},next.id);assert.equal(h.main.shown,shown+1);m.end();
 const failure=h.call('begin-recording-hud',{}),failed=h.windows.at(-1);failed.reject(Error('load failed'));await assert.rejects(failure,/load failed/);assert.equal(failed.dead,true);
 const active=await opened(h);active.w.emit('close',{preventDefault:()=>{}});assert.deepEqual(h.main.webContents.messages.at(-1),['recording-hud-command','stop']);m.end();assert.ok(h.main.shown>shown);
 }finally{m.dispose();assert.equal(h.handlers.size,0)}});

const recording=(id:string,extra:any={})=>({id,type:'started',recordVideo:true,selection:{kind:'region',displayBounds:{x:-1512,y:-40,width:1512,height:982},scaleFactor:2,crop:{normalized:{x:.25,y:.25,width:.5,height:.5},pixels:{x:756,y:491,width:1512,height:982}}},...extra});
test('border bounds use global logical region and prefer actual native capture bounds',()=>{
 assert.deepEqual(borderBounds(recording('one')),{x:-1134,y:206,width:756,height:491});
 assert.deepEqual(borderBounds(recording('one',{captureBounds:{x:-1300.2,y:30.4,width:1280,height:720}})),{x:-1300,y:30,width:1280,height:720});
 assert.equal(borderBounds(recording('one',{recordVideo:false})),null);assert.equal(borderBounds(recording('one',{captureBounds:{x:NaN,y:0,width:100,height:100}})),null);
});
test('border is click-through/content-protected and stale session events do not change current border',async()=>{const h=harness(),m=createCaptureBorder(h.opts);try{
 m.update(recording('one'));const one=h.windows[0];one.resolve();await tick();assert.equal(one.ignored,true);assert.equal(one.protected,true);assert.equal(one.visible,true);m.update({type:'paused',id:'one'});assert.equal(one.visible,false);m.update({type:'resumed',id:'one'});assert.equal(one.visible,true);
 m.update(recording('two'));const two=h.windows[1];two.resolve();await tick();m.update({type:'stopped',id:'one'});m.update({type:'error',id:'one'});m.update({type:'paused',id:'one'});assert.equal(two.dead,false);assert.equal(two.visible,true);m.update({type:'stopped',id:'two'});assert.equal(two.dead,true);
 }finally{m.clear()}});
test('border stays hidden when paused before its document finishes loading',async()=>{const h=harness(),m=createCaptureBorder(h.opts);try{
 m.update(recording('one'));const one=h.windows[0];m.update({type:'paused',id:'one'});one.resolve();await tick();assert.equal(one.visible,false);
 }finally{m.clear()}});
test('obsolete border load rejection cannot destroy the new session border',async()=>{const h=harness(),m=createCaptureBorder(h.opts);try{
 m.update(recording('one'));const one=h.windows[0];m.update(recording('two'));const two=h.windows[1];two.resolve();await tick();one.reject(Error('obsolete'));await tick();assert.equal(two.dead,false);assert.equal(two.visible,true);
 }finally{m.clear()}});

test('HUD reload-style end restores editor; quit disposal destroys pending windows without refocusing',async()=>{const h=harness(),m=createRecordingHud(h.opts);
 await opened(h);const shown=h.main.shown;m.end();assert.equal(h.main.shown,shown+1);
 const pending=h.call('begin-recording-hud',{status:'recording'}),w=h.windows.at(-1);const before=h.main.shown;m.dispose();w.resolve();assert.equal((await pending).visible,false);assert.equal(h.main.shown,before);assert.equal(w.shown,0);assert.equal(h.handlers.size,0);
});
test('border stop and teardown while loading cannot later show an orphan',async()=>{const h=harness(),m=createCaptureBorder(h.opts);
 m.update(recording('one'));const one=h.windows[0];m.update({type:'stopped',id:'one'});one.resolve();await tick();assert.equal(one.shown,0);assert.equal(one.dead,true);
 m.update(recording('two'));const two=h.windows[1];m.clear();two.resolve();await tick();assert.equal(two.shown,0);assert.equal(two.dead,true);
});


test('selected-window bounds events move only their own border and stay hidden while paused',async()=>{const h=harness(),m=createCaptureBorder(h.opts);try{
 const initial={x:-1200,y:-80,width:800,height:600};m.update(recording('window',{selection:{kind:'window',sourceId:'window:12:0'},captureBounds:initial}));const w=h.windows[0];w.resolve();await tick();assert.equal(w.options.x,-1200);assert.equal(w.options.width,800);
 m.update({type:'paused',id:'window'});m.update(recording('window',{type:'bounds',captureBounds:{x:-1000,y:0,width:900,height:640}}));assert.equal(w.options.x,-1000);assert.equal(w.options.width,900);assert.equal(w.visible,false);
 m.update(recording('obsolete',{type:'bounds',captureBounds:{x:42,y:0,width:600,height:400}}));assert.equal(w.options.x,-1000);m.update({type:'resumed',id:'window'});assert.equal(w.visible,true);
 m.update(recording('window',{type:'bounds',captureBounds:{x:NaN,y:0,width:600,height:400}}));assert.equal(w.options.x,-1000);
 }finally{m.clear()}});

test('HUD and border are panels that join full-screen Spaces without a Dock transform',async()=>{const h=harness(),hud=createRecordingHud(h.opts),border=createCaptureBorder(h.opts);try{
 const {w}=await opened(h);border.update(recording('one'));const b=h.windows.at(-1);
 for(const window of [w,b]){assert.equal(window.options.type,'panel');assert.deepEqual(window.workspaces,[true,{visibleOnFullScreen:true,skipTransformProcessType:true}]);}
 }finally{hud.dispose();border.clear()}});
test('HUD sends its loaded document the full state once, then only changed fields',async()=>{const h=harness(),m=createRecordingHud(h.opts);try{
 const pending=h.call('begin-recording-hud',{projectName:'Take',script:'Line one',status:'starting',countdown:3}),w=h.windows.at(-1);h.call('update-recording-hud',{countdown:2});assert.deepEqual(w.webContents.messages,[]);
 w.resolve();const {id}=await pending;assert.equal(w.webContents.messages.length,1);const [channel,full]=w.webContents.messages[0];assert.equal(channel,'recording-hud-state');assert.equal(full.script,'Line one');assert.equal(full.countdown,2);assert.equal(h.main.hidden,0);
 h.call('update-recording-hud',{status:'recording',countdown:null,elapsed:1},id);assert.deepEqual(w.webContents.messages.at(-1),['recording-hud-state',{status:'recording',countdown:null,elapsed:1}]);assert.equal(h.main.hidden,1);
 h.call('update-recording-hud',{elapsed:2},id);assert.deepEqual(w.webContents.messages.at(-1),['recording-hud-state',{elapsed:2}]);
 assert.deepEqual(h.handlers.get('recording-hud-read')!(h.hudEvent()),{...full,status:'recording',countdown:null,elapsed:2});
 const next=await opened(h,{projectName:'Next',status:'recording'});assert.equal(next.w.webContents.messages.length,1);assert.equal(next.w.webContents.messages[0][1].projectName,'Next');
 }finally{m.dispose()}});
test('HUD camera access is video-only, for the live HUD document only',async()=>{const h=harness(),m=createRecordingHud(h.opts);try{
 const {w}=await opened(h,{status:'recording',cameraEnabled:true}),url=w.webContents.mainFrame.url,request=(extra:any={})=>({requestingUrl:url,isMainFrame:true,mediaTypes:['video'],...extra});
 assert.equal(m.allowsCamera(w.webContents,'media',request()),true);
 for(const [contents,permission,details] of [[w.webContents,'media',request({mediaTypes:['video','audio']})],[w.webContents,'media',request({mediaTypes:['audio']})],[w.webContents,'media',request({mediaTypes:[]})],[w.webContents,'display-capture',request()],[w.webContents,'media',request({requestingUrl:'file:///tmp/other.html'})],[w.webContents,'media',request({isMainFrame:false})],[h.main.webContents,'media',request()],[w.webContents,'media',undefined]] as const)assert.equal(m.allowsCamera(contents,permission,details),false);
 m.end();assert.equal(m.allowsCamera(w.webContents,'media',request()),false);
 }finally{m.dispose()}});
test('border pre-warmed while capture starts is adopted on started, re-armed click-through and shown in place',async()=>{const h=harness(),m=createCaptureBorder(h.opts);try{
 m.prewarm();m.prewarm();assert.equal(h.windows.length,1);const spare=h.windows[0];assert.equal(spare.visible,false);spare.resolve();await tick();assert.equal(spare.visible,false);
 spare.ignored=false;spare.protected=false;m.update(recording('one'));assert.equal(h.windows.length,1);await tick();assert.equal(spare.visible,true);assert.equal(spare.ignored,true);assert.equal(spare.protected,true);assert.equal(spare.options.x,-1134);assert.equal(spare.options.width,756);
 m.update({type:'stopped',id:'one'});assert.equal(spare.dead,true);
 m.prewarm();const unused=h.windows.at(-1);m.update({type:'error',id:'never-started'});assert.equal(unused.dead,true);
 m.prewarm();const loading=h.windows.at(-1);m.update(recording('two'));m.update({type:'paused',id:'two'});loading.resolve();await tick();assert.equal(loading.visible,false);m.update({type:'resumed',id:'two'});assert.equal(loading.visible,true);
 m.prewarm();const last=h.windows.at(-1);m.clear();assert.equal(loading.dead,true);assert.equal(last.dead,true);
 m.prewarm();const failed=h.windows.at(-1);failed.reject(Error('load failed'));await tick();assert.equal(failed.dead,true);m.update(recording('three'));assert.equal(h.windows.at(-1)!==failed,true);
 }finally{m.clear()}});

test('HUD reports each editor hide and show it makes, since macOS does not emit hide for BrowserWindow.hide()',async()=>{const h=harness(),reports:boolean[]=[];(h.main as any).visible=true;const hide=h.main.hide,show=h.main.show;h.main.hide=function(){(this as any).visible=false;hide.call(this);};h.main.show=function(){(this as any).visible=true;show.call(this);};
 const m=createRecordingHud({...h.opts,onMainVisibility:()=>reports.push((h.main as any).visible)} as any);try{
  const one=await opened(h);assert.deepEqual(reports,[false]);h.handlers.get('recording-hud-command')!(h.hudEvent(),'show-editor');assert.deepEqual(reports,[false,true]);
  h.call('update-recording-hud',{status:'saving'},one.id);assert.deepEqual(reports,[false,true],'an editor that is already visible is not reported again');
  const next=await opened(h);h.call('update-recording-hud',{status:'saving'},next.id);assert.deepEqual(reports,[false,true,false,true]);
 }finally{m.dispose();}
});
