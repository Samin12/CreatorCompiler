import type {DesktopCaptureSelection,DesktopMediaPermissions,SavedDesktopCaptureSelection} from './desktop';
import {CapturePreviewManager,type CaptureRequest} from './capture-preview';

export type SavedScreenSource=SavedDesktopCaptureSelection;
export const SAVED_SCREEN_SOURCE_KEY='sceneforge.screen-source.v1';
const copyRect=(r:{x:number;y:number;width:number;height:number})=>({x:r.x,y:r.y,width:r.width,height:r.height});
const rect=(value:any,normalized=false)=>value&&['x','y','width','height'].every(k=>typeof value[k]==='number'&&Number.isFinite(value[k]))&&value.width>0&&value.height>0&&(!normalized||(value.x>=0&&value.y>=0&&value.x+value.width<=1&&value.y+value.height<=1));
/** Preferences contain only a source description. Native code validates it and
 * grants a new one-use token; a persisted value is never capture authority. */
export function savedScreenSource(value:unknown):SavedScreenSource|null{
 const s=value as DesktopCaptureSelection|undefined;
 if(!s||typeof s.sourceId!=='string'||!s.sourceId||s.sourceId.length>256||typeof s.label!=='string'||s.label.length>2048||!['display','window','region'].includes(s.kind))return null;
 if(s.displayBounds&&!rect(s.displayBounds))return null;
 if(s.scaleFactor!==undefined&&(!Number.isFinite(s.scaleFactor)||s.scaleFactor<=0))return null;
 if(s.displayId!==undefined&&(typeof s.displayId!=='string'||s.displayId.length>1024))return null;
 if(s.kind!=='window'&&(!s.displayId||typeof s.displayId!=='string'||!rect(s.displayBounds)||!Number.isFinite(s.scaleFactor)||s.scaleFactor!<=0))return null;
 if(s.kind==='region'&&(!s.crop||!rect(s.crop.normalized,true)||!rect(s.crop.dip)||!rect(s.crop.pixels)||!s.crop.sourcePixelSize||!Number.isFinite(s.crop.sourcePixelSize.width)||!Number.isFinite(s.crop.sourcePixelSize.height)||s.crop.sourcePixelSize.width<=0||s.crop.sourcePixelSize.height<=0))return null;
 return {sourceId:s.sourceId,kind:s.kind,label:s.label,...(s.displayId?{displayId:s.displayId}:{}),...(s.displayBounds?{displayBounds:copyRect(s.displayBounds)}:{}),...(s.scaleFactor?{scaleFactor:s.scaleFactor}:{}),...(s.kind==='region'?{crop:{normalized:copyRect(s.crop!.normalized),dip:copyRect(s.crop!.dip),pixels:copyRect(s.crop!.pixels),sourcePixelSize:{width:s.crop!.sourcePixelSize.width,height:s.crop!.sourcePixelSize.height}}}:{})};
}
export function loadScreenSource():SavedScreenSource|null{try{return savedScreenSource(JSON.parse(localStorage.getItem(SAVED_SCREEN_SOURCE_KEY)||'null'));}catch{return null;}}
export function saveScreenSource(value:SavedScreenSource|null){try{if(value)localStorage.setItem(SAVED_SCREEN_SOURCE_KEY,JSON.stringify(value));else localStorage.removeItem(SAVED_SCREEN_SOURCE_KEY);}catch{/* The active view can still use its validated selection. */}}
/** Pixels of the chosen display or region; windows carry no geometry. */
export function screenCaptureSize(source:SavedScreenSource|null):{width:number;height:number}|null{
 if(!source||source.kind==='window'||!source.displayBounds||!source.scaleFactor)return null;
 return source.crop?{width:source.crop.pixels.width,height:source.crop.pixels.height}:{width:Math.round(source.displayBounds.width*source.scaleFactor),height:Math.round(source.displayBounds.height*source.scaleFactor)};
}
/** A preview-only stream needs about 1280×800 of the visible area at 30 fps; size is limited only where the true size is known for the badge. */
export function screenPreviewLimits(source:SavedScreenSource):NonNullable<CaptureRequest['preview']>{
 const crop=source.crop?.normalized;return screenCaptureSize(source)?{width:Math.round(1280/(crop?.width||1)),height:Math.round(800/(crop?.height||1)),frameRate:30}:{frameRate:30};
}
export function screenCaptureRequest(source:SavedScreenSource,frameRate:number,systemAudio:boolean,previewOnly=false):CaptureRequest{return {kind:'screen',frameRate,systemAudio,sourceId:source.sourceId,...(source.crop?{crop:source.crop.normalized}:{}),...(previewOnly?{preview:screenPreviewLimits(source)}:{})};}

type Bridge={getMediaPermissions:()=>Promise<DesktopMediaPermissions>;restoreCaptureSource:(source:SavedScreenSource)=>Promise<DesktopCaptureSelection|null>;cancelCaptureSelection?:(token?:string)=>Promise<void>};
/** Coalesces automatic resume triggers and discards native/browser results from
 * a previous view, review, recording, source switch or off toggle. */
export class ScreenPreviewResume {
 private epoch=0;
 private pending:Promise<MediaStream|null>|null=null;
 private pendingKey='';
 cancel(){this.epoch++;this.pending=null;this.pendingKey='';}
 resume(source:SavedScreenSource,request:CaptureRequest,bridge:Bridge,manager:CapturePreviewManager,isCurrent:()=>boolean,onSelection:(source:DesktopCaptureSelection)=>void,onError:(message:string)=>void):Promise<MediaStream|null>{
  const key=JSON.stringify([source,request]);
  if(this.pending&&key===this.pendingKey)return this.pending;
  if(this.pending)this.cancel();
  this.pendingKey=key;
  const epoch=this.epoch,current=()=>epoch===this.epoch&&isCurrent();
  const release=(token:string)=>bridge.cancelCaptureSelection?.(token).catch(()=>{});
  const work=async()=>{
   let selected:DesktopCaptureSelection|null=null;
   try{
    if(!current())return null;
    const permissions=await bridge.getMediaPermissions();if(!current())return null;if(permissions.screen!=='granted'){onError('Screen preview needs allowed screen-recording access. Open Mac setup, then return to Record.');return null;}
    selected=await bridge.restoreCaptureSource(source);if(!selected)return null;
    if(!current()){await release(selected.token);return null;}
    onSelection(selected);
    const stream=await manager.acquire({...request,sourceId:selected.sourceId,...(selected.crop?{crop:selected.crop.normalized}:{})});
    if(!current()){if(stream&&manager.getSnapshot().screen.stream===stream)manager.stop('screen');await release(selected.token);return null;}
    if(!stream)await release(selected.token);
    return stream;
   }catch(error){if(selected)await release(selected.token);if(current())onError((error as Error).message);return null;}
  };
  const pending=work().finally(()=>{if(this.pending===pending)this.pending=null;});this.pending=pending;return pending;
 }
}
