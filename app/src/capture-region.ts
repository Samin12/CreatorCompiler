export interface NormalizedRegion {x:number;y:number;width:number;height:number}
export interface PixelRegion {x:number;y:number;width:number;height:number}
export function clampRegion(region:NormalizedRegion):NormalizedRegion{
 for(const n of Object.values(region))if(!Number.isFinite(n))throw new Error('The selected capture region is invalid.');
 const x=Math.max(0,Math.min(1,region.x)),y=Math.max(0,Math.min(1,region.y));
 const width=Math.max(0,Math.min(1,region.x+region.width)-x),height=Math.max(0,Math.min(1,region.y+region.height)-y);
 if(width<=0||height<=0)throw new Error('Choose a capture region with a visible width and height.');
 return {x,y,width,height};
}
/** Use delivered video dimensions, not monitor scale estimates: Retina/downscaled capture stays aligned. */
export function regionToPixels(region:NormalizedRegion,videoWidth:number,videoHeight:number):PixelRegion{
 if(!Number.isFinite(videoWidth)||!Number.isFinite(videoHeight)||videoWidth<1||videoHeight<1)throw new Error('The selected source has no video dimensions.');
 const r=clampRegion(region),x=Math.min(videoWidth-1,Math.round(r.x*videoWidth)),y=Math.min(videoHeight-1,Math.round(r.y*videoHeight));
 return {x,y,width:Math.max(1,Math.min(videoWidth-x,Math.round((r.x+r.width)*videoWidth)-x)),height:Math.max(1,Math.min(videoHeight-y,Math.round((r.y+r.height)*videoHeight)-y))};
}
/** Desktop points may be negative on displays arranged left/above the primary display. */
export function desktopRegionToNormalized(region:PixelRegion,display:PixelRegion):NormalizedRegion{
 if(display.width<=0||display.height<=0)throw new Error('The selected display has no bounds.');
 return clampRegion({x:(region.x-display.x)/display.width,y:(region.y-display.y)/display.height,width:region.width/display.width,height:region.height/display.height});
}
/** CSS object-view-box crop of the full source: the compositor shows the region with no per-frame script. */
export function regionInset(region:NormalizedRegion):string{const r=clampRegion(region),pct=(n:number)=>`${Math.max(0,n*100)}%`;return `inset(${pct(r.y)} ${pct(1-r.x-r.width)} ${pct(1-r.y-r.height)} ${pct(r.x)})`;}
export interface RegionStream {stream:MediaStream;dispose:()=>void}
export async function cropCaptureStream(raw:MediaStream,region:NormalizedRegion,frameRate:number,signal:AbortSignal):Promise<RegionStream>{
 const normalized=clampRegion(region),video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=raw;
 const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{alpha:false});if(!context)throw new Error('Region capture requires an available canvas renderer.');
 let disposed=false,frame=0,output:MediaStream|null=null;
 const dispose=()=>{if(disposed)return;disposed=true;if(frame)video.cancelVideoFrameCallback(frame);video.pause();video.srcObject=null;output?.getVideoTracks().forEach(t=>t.stop());signal.removeEventListener('abort',dispose);};
 signal.addEventListener('abort',dispose,{once:true});
 try{
  if(signal.aborted)throw new DOMException('Capture cancelled','AbortError');
  await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>finish(new Error('The selected screen did not provide a video frame.')),10000);const ready=()=>{if(video.videoWidth&&video.videoHeight)finish();};const aborted=()=>finish(new DOMException('Capture cancelled','AbortError'));const failed=()=>finish(new Error('The selected screen preview could not load.'));const finish=(error?:Error)=>{clearTimeout(timeout);video.removeEventListener('loadeddata',ready);video.removeEventListener('error',failed);signal.removeEventListener('abort',aborted);error?reject(error):resolve();};video.addEventListener('loadeddata',ready);video.addEventListener('error',failed);signal.addEventListener('abort',aborted,{once:true});void video.play().then(ready).catch(finish);ready();});
  if(disposed||signal.aborted)throw new DOMException('Capture cancelled','AbortError');
  const draw=()=>{if(disposed)return;const rect=regionToPixels(normalized,video.videoWidth,video.videoHeight);if(canvas.width!==rect.width||canvas.height!==rect.height){canvas.width=rect.width;canvas.height=rect.height;}context.drawImage(video,rect.x,rect.y,rect.width,rect.height,0,0,canvas.width,canvas.height);};
  draw();output=canvas.captureStream(Math.max(1,Math.min(60,frameRate)));
  const step=()=>{if(disposed)return;draw();frame=video.requestVideoFrameCallback(step);};frame=video.requestVideoFrameCallback(step);
  const stream=new MediaStream([...output.getVideoTracks(),...raw.getAudioTracks()]);return {stream,dispose};
 }catch(error){dispose();throw error;}
}
