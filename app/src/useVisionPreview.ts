import {useEffect,useState} from 'react';
import type {Media} from '../shared/types';
export interface VisionFrame {time:number;width:number;height:number;face:{x:number;y:number;width:number;height:number;confidence:number}|null;maskUrl:string;}
const cache=new Map<string,VisionFrame>();
export function useVisionPreview(media:Media,sourceTime:number,enabled:boolean,playing:boolean){
 const bucket=media.kind==='image'?0:Math.max(0,Math.floor(sourceTime*8)/8),key=`${media.id}:${bucket}`;
 const [state,setState]=useState<{key:string;frame?:VisionFrame;error?:string}>({key:''});
 useEffect(()=>{
  if(!enabled||playing)return;
  const cached=cache.get(key);if(cached){setState({key,frame:cached});return;}
  const controller=new AbortController();
  const timer=setTimeout(()=>{void fetch(`/api/media/${encodeURIComponent(media.id)}/vision?time=${bucket}`,{signal:controller.signal}).then(async response=>{const value=await response.json();if(!response.ok)throw new Error(value.error||'Local Vision preview is unavailable.');return value as VisionFrame;}).then(frame=>{cache.set(key,frame);if(cache.size>48)cache.delete(cache.keys().next().value!);setState({key,frame});}).catch(error=>{if(error.name!=='AbortError')setState({key,error:error.message});});},220);
  return()=>{clearTimeout(timer);controller.abort();};
 },[key,enabled,playing,media.id,bucket]);
 return enabled&&!playing?{frame:state.key===key?state.frame:undefined,error:state.key===key?state.error:undefined,loading:state.key!==key||(!state.frame&&!state.error)}:{frame:undefined,error:undefined,loading:false};
}
