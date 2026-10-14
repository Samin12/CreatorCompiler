import {useCallback,useRef,useSyncExternalStore} from 'react';

/** The editor playhead lives outside React state so a playback tick only re-renders the components that read it. */
export interface Playhead {get:()=>number;set:(time:number)=>void;subscribe:(listener:()=>void)=>()=>void}
export function createPlayhead(initial=0):Playhead{
 let time=initial;const listeners=new Set<()=>void>();
 return {get:()=>time,set:next=>{if(next===time||!Number.isFinite(next))return;time=next;for(const listener of [...listeners])listener();},subscribe:listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};}};
}
/** Re-renders on every playhead change. Use only in cheap leaf components such as the stage. */
export function usePlayheadTime(playhead:Playhead):number{return useSyncExternalStore(playhead.subscribe,playhead.get,playhead.get);}
/** Re-renders only when the selected value changes, e.g. the active transcript word or a rounded clock label. */
export function usePlayheadSelector<T>(playhead:Playhead,select:(time:number)=>T,equal:(a:T,b:T)=>boolean=Object.is):T{
 const latest=useRef<{time:number;select:(time:number)=>T;value:T}|null>(null),selectRef=useRef(select),equalRef=useRef(equal);selectRef.current=select;equalRef.current=equal;
 // A new selector can read new data at the same time, so the cached value is keyed on both; equal results keep their identity.
 const snapshot=useCallback(()=>{const time=playhead.get(),select=selectRef.current,previous=latest.current;if(previous&&previous.time===time&&previous.select===select)return previous.value;const value=select(time);if(previous&&equalRef.current(previous.value,value)){latest.current={time,select,value:previous.value};return previous.value;}latest.current={time,select,value};return value;},[playhead]);
 return useSyncExternalStore(playhead.subscribe,snapshot,snapshot);
}
