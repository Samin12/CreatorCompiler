/** One shared /api/events stream. Chromium allows six HTTP/1.1 connections per host, and playing media needs most of them. */
export type ServerEvent='project'|'automation'|'ready';
const listeners=new Map<string,Set<(event:MessageEvent)=>void>>();let source:EventSource|null=null;
const dispatch=(event:Event)=>{for(const listener of [...listeners.get(event.type)??[]])listener(event as MessageEvent);};
export function subscribeEvents(type:ServerEvent,listener:(event:MessageEvent)=>void):()=>void{
 source??=new EventSource('/api/events');
 let set=listeners.get(type);if(!set){set=new Set();listeners.set(type,set);source.addEventListener(type,dispatch);}set.add(listener);
 return()=>{const current=listeners.get(type);if(!current?.delete(listener))return;if(!current.size){listeners.delete(type);source?.removeEventListener(type,dispatch);}if(!listeners.size){source?.close();source=null;}};
}
/** True while the shared stream is connected, so job updates arrive without polling. */
export const eventsOpen=()=>source?.readyState===1;
