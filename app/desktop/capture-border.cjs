const path=require('node:path');
function borderBounds(event){
 if(!event?.recordVideo)return null;const selection=event.selection;
 let rect=event.captureBounds;
 if(!rect&&selection?.displayBounds){rect={...selection.displayBounds};if(selection.kind==='region'){const region=selection.crop?.normalized;if(!region)return null;rect={x:rect.x+rect.width*region.x,y:rect.y+rect.height*region.y,width:rect.width*region.width,height:rect.height*region.height};}}
 if(!rect||!['x','y','width','height'].every(k=>Number.isFinite(rect[k]))||rect.width<2||rect.height<2)return null;
 return {x:Math.round(rect.x),y:Math.round(rect.y),width:Math.max(2,Math.round(rect.width)),height:Math.max(2,Math.round(rect.height))};
}
function createCaptureBorder({BrowserWindow}){
 let window=null,id=null,paused=false,spare=null;
 const alive=w=>Boolean(w&&!w.isDestroyed());
 const clear=()=>{id=null;if(window&&!window.isDestroyed())window.destroy();window=null;};
 const dropSpare=()=>{const s=spare;spare=null;if(alive(s?.window))s.window.destroy();};
 // A panel floats over full-screen Spaces without turning Creator Compiler into an
 // accessory app (no Dock hide/show at record start).
 function create(bounds){
  const created=new BrowserWindow({...bounds,title:'Creator Compiler capture area',type:'panel',frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,movable:false,focusable:false,alwaysOnTop:true,skipTaskbar:true,show:false,enableLargerThanScreen:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  created.setIgnoreMouseEvents(true);created.setAlwaysOnTop(true,'screen-saver');created.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true,skipTransformProcessType:true});created.setContentProtection(true);created.webContents.setWindowOpenHandler(()=>({action:'deny'}));created.webContents.on('will-navigate',e=>e.preventDefault());
  return {window:created,loaded:created.loadFile(path.join(__dirname,'capture-border.html'))};
 }
 // Created hidden while native capture starts, so 'started' only positions and shows it.
 function prewarm(){if(alive(spare?.window))return;const s=create({x:0,y:0,width:2,height:2});spare=s;s.loaded.catch(()=>{if(spare===s)dropSpare();});}
 function update(event){
  if(event.type==='stopped'||event.type==='error'){if(event.id===id)clear();else dropSpare();return;}
  if(event.type==='paused'){if(event.id===id){paused=true;if(window&&!window.isDestroyed())window.hide();}return;}
  if(event.type==='resumed'){if(event.id===id){paused=false;if(window&&!window.isDestroyed())window.showInactive();}return;}
  if(event.type==='bounds'){if(event.id===id&&window&&!window.isDestroyed()){const bounds=borderBounds(event);if(bounds)window.setBounds(bounds,false);}return;}
  if(event.type!=='started')return;clear();const bounds=borderBounds(event);if(!bounds)return;id=event.id;paused=false;
  let next=spare;spare=null;if(alive(next?.window)){next.window.setBounds(bounds,false);next.window.setIgnoreMouseEvents(true);next.window.setContentProtection(true);}else next=create(bounds);
  window=next.window;const current=window;
  void next.loaded.then(()=>{if(window===current&&!current.isDestroyed()&&!paused)current.showInactive();}).catch(()=>{if(window===current)clear();});
 }
 return{update,prewarm,clear:()=>{clear();dropSpare();}};
}
module.exports={createCaptureBorder,borderBounds};
