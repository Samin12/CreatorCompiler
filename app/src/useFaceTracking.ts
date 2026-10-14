import {useEffect,useState} from 'react';
import type {Media} from '../shared/types';
import {FACE_TILE_SECONDS,type FaceTrack} from '../shared/face-tracking';
const cache=new Map<string,FaceTrack>();
/** Fetch ahead per source-time tile; playback interpolation never calls the detector. */
export function useFaceTracking(media:Media,sourceTime:number,enabled:boolean){
 const tile=media.kind==='image'?0:Math.max(0,Math.floor(sourceTime/FACE_TILE_SECONDS));
 const identity=`${media.id}:${media.path}:${media.duration}`,key=`${identity}:${tile}`;
 const [state,setState]=useState<{identity:string;track?:FaceTrack;error?:string}>(()=>({identity,track:cache.get(key)}));
 useEffect(()=>{
  if(!enabled)return;
  const hit=cache.get(key);if(hit){setState({identity,track:hit});return;}
  const controller=new AbortController(),start=tile*FACE_TILE_SECONDS,end=media.kind==='image'?1:Math.max(start+.001,Math.min(media.duration,(tile+2)*FACE_TILE_SECONDS));
  void fetch(`/api/media/${encodeURIComponent(media.id)}/face-track?start=${start}&end=${end}`,{signal:controller.signal})
   .then(async response=>{const value=await response.json();if(!response.ok)throw Error(value.error||'Face tracking unavailable');return value as FaceTrack;})
   .then(track=>{if(controller.signal.aborted)return;cache.set(key,track);while(cache.size>32)cache.delete(cache.keys().next().value!);setState({identity,track});})
   .catch(error=>{if(!controller.signal.aborted)setState({identity,error:error.message});});
  return()=>controller.abort();
 },[key,identity,media.id,media.kind,media.duration,tile,enabled]);
 const track=enabled&&state.identity===identity&&state.track&&(media.kind==='image'||sourceTime>=state.track.start-1e-6&&sourceTime<=state.track.end+1e-6)?state.track:undefined;
 return {track,error:enabled&&state.identity===identity?state.error:undefined,loading:enabled&&!track&&!(state.identity===identity&&state.error)};
}
