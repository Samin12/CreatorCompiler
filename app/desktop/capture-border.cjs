const path=require('node:path');
function borderBounds(event){
 if(!event?.recordVideo)return null;const selection=event.selection;
 let rect=event.captureBounds;
 if(!rect&&selection?.displayBounds){rect={...selection.displayBounds};if(selection.kind==='region'){const region=selection.crop?.normalized;if(!region)return null;rect={x:rect.x+rect.width*region.x,y:rect.y+rect.height*region.y,width:rect.width*region.width,height:rect.height*region.height};}}
 if(!rect||!['x','y','width','height'].every(k=>Number.isFinite(rect[k]))||rect.width<2||rect.height<2)return null;
 return {x:Math.round(rect.x),y:Math.round(rect.y),width:Math.max(2,Math.round(rect.width)),height:Math.max(2,Math.round(rect.height))};
}
function createCaptureBorder({BrowserWindow}){
 let window=null,id=null,paused=false;
 const clear=()=>{id=null;if(window&&!window.isDestroyed())window.destroy();window=null;};
 function update(event){
  if(event.type==='stopped'||event.type==='error'){if(event.id===id)clear();return;}
  if(event.type==='paused'){if(event.id===id){paused=true;if(window&&!window.isDestroyed())window.hide();}return;}
  if(event.type==='resumed'){if(event.id===id){paused=false;if(window&&!window.isDestroyed())window.showInactive();}return;}
  if(event.type==='bounds'){if(event.id===id&&window&&!window.isDestroyed()){const bounds=borderBounds(event);if(bounds)window.setBounds(bounds,false);}return;}
  if(event.type!=='started')return;clear();const bounds=borderBounds(event);if(!bounds)return;id=event.id;paused=false;
  window=new BrowserWindow({...bounds,title:'SceneForge capture area',frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,movable:false,focusable:false,alwaysOnTop:true,skipTaskbar:true,show:false,enableLargerThanScreen:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const current=window;window.setIgnoreMouseEvents(true);window.setAlwaysOnTop(true,'screen-saver');window.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});window.setContentProtection(true);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
  void window.loadFile(path.join(__dirname,'capture-border.html')).then(()=>{if(window===current&&!current.isDestroyed()&&!paused)current.showInactive();}).catch(()=>{if(window===current)clear();});
 }
 return{update,clear};
}
module.exports={createCaptureBorder,borderBounds};
