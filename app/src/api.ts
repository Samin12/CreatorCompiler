import {cutTimelineRange} from '../shared/timeline-edits';
import {plainView} from './project-draft';
import type { Caption, Media, Project, TrackKind } from '../shared/types';
import { clipDuration, defaultEffects, defaultTransform, makeId } from '../shared/types';
import type {AgentChatJob,AgentChatRequest,AgentStatus} from '../shared/agent-chat';
export const getAgentStatus=(refresh=false)=>api<AgentStatus>(`/agent/status${refresh?'?refresh=1':''}`);
export const getProjectChat=(projectId:string)=>api<{jobs:AgentChatJob[]}>(`/projects/${encodeURIComponent(projectId)}/agent-chat`);
export const sendAgentChat=(projectId:string,request:AgentChatRequest)=>api<AgentChatJob>(`/projects/${encodeURIComponent(projectId)}/agent-chat`,request);
export const getAgentChat=(id:string)=>api<AgentChatJob>(`/agent-chat/${encodeURIComponent(id)}`);
export const cancelAgentChat=(id:string)=>api<AgentChatJob>(`/agent-chat/${encodeURIComponent(id)}`,undefined,'DELETE');
export const undoAgentChat=(projectId:string,id:string)=>api<Project>(`/projects/${encodeURIComponent(projectId)}/agent-chat/${encodeURIComponent(id)}/undo`,{});
export function subscribeAgentChat(id:string,receive:(job:AgentChatJob)=>void,onError?:()=>void){const events=new EventSource(`/api/agent-chat/${encodeURIComponent(id)}/events`);events.addEventListener('job',event=>{try{receive(JSON.parse((event as MessageEvent).data));}catch{}});if(onError)events.onerror=onError;return()=>events.close();}

export class APIError extends Error {constructor(message:string,public status:number){super(message);}}
/** A request body that is already JSON text, so a large project is serialized once per save. */
export class JSONBody {constructor(readonly text:string){}}
export async function apiResult<T>(path:string,body?:unknown,method?:string,headers:Record<string,string>={},signal?:AbortSignal):Promise<{data:T;etag:string|null}>{
 const res=await fetch(`/api${path}`, {method:method??(body===undefined?'GET':'POST'),headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:body instanceof FormData?body:body instanceof JSONBody?body.text:JSON.stringify(body),signal});
 if(!res.ok){const err=await res.json().catch(()=>({error:res.statusText}));throw new APIError(err.error??res.statusText,res.status);}
 return {data:await res.json(),etag:res.headers.get('ETag')};
}
export async function api<T>(path:string, body?:unknown, method?:string,signal?:AbortSignal):Promise<T> {return (await apiResult<T>(path,body,method,{},signal)).data;}
/** With `Prefer: return=minimal`, an unchanged save returns only its new timestamp; the sent object is kept with every nested object. */
export function adoptSavedProject(sent:Project,body:unknown):Project{const echo=body as {minimal?:unknown;id?:unknown;updatedAt?:unknown};if(echo?.minimal!==true)return body as Project;if(echo.id!==sent.id||typeof echo.updatedAt!=='string')throw new Error('The save response did not match this project. Your edits are still open.');return {...sent,updatedAt:echo.updatedAt};}
export async function projectRevision(project:Project):Promise<string>{return '"'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(project))))).map(n=>n.toString(16).padStart(2,'0')).join('')+'"';}
export const mediaUrl=(m:Media,proxy=false)=>`/api/media/${m.id}/${proxy&&m.kind==='video'?'proxy':'file'}`;
export const timecode=(n:number)=>{const v=Math.max(0,Number.isFinite(n)?n:0);return `${Math.floor(v/60).toString().padStart(2,'0')}:${Math.floor(v%60).toString().padStart(2,'0')}`;};
export function mapCaptionsToProject(source:Caption[],project:Project,mediaId:string):Caption[]{
 const seen=new Set<string>();const clips=project.clips.filter(c=>c.mediaId===mediaId&&!c.muted&&c.gain>0);
 return clips.flatMap(clip=>source.flatMap(c=>{
  const from=Math.max(c.start,clip.sourceIn),to=Math.min(c.end,clip.sourceOut);if(to<=from)return[];
  const start=clip.start+(from-clip.sourceIn)/clip.speed,end=clip.start+(to-clip.sourceIn)/clip.speed;
  const key=`${start.toFixed(4)}:${end.toFixed(4)}:${c.text}`;if(seen.has(key))return[];seen.add(key);
  const words=c.words?.filter(w=>w.end>from&&w.start<to).map(w=>({...w,start:clip.start+(Math.max(w.start,from)-clip.sourceIn)/clip.speed,end:clip.start+(Math.min(w.end,to)-clip.sourceIn)/clip.speed}));
  return[{...c,id:makeId(),start,end,text:words?.length?words.map(w=>w.text).join(' '):c.text,words}];
 })).sort((a,b)=>a.start-b.start);
}
export function insertMedia(p:Project, medias:Media[], at?:number, track?:TrackKind) {
 let position=at??Math.max(0,...p.clips.filter(c=>c.track==='screen').map(c=>c.start+clipDuration(c)));
 for(const media of medias){
  if(!p.media.some(m=>m.id===media.id))p.media.push(media);
  p.clips.push({id:makeId(),mediaId:media.id,name:media.name,track:track??(media.kind==='audio'?'audio':media.kind==='image'?'overlay':'screen'),start:position,sourceIn:0,sourceOut:media.duration||5,speed:1,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects()});
  position+=media.duration||5;
 }
 if(p.scenes.length===1&&p.scenes[0].duration===0)p.scenes[0].duration=position;
}
export function cutRange(p:Project,start:number,end:number,ripple=true) {cutTimelineRange(p,start,end,ripple,plainView(p));}

// Recovery plans are reviewed against both a project revision and a file fingerprint.
export async function getTrash(signal?:AbortSignal){return api<{items:import('../shared/recovery').TrashProjectSummary[]}>('/trash',undefined,'GET',signal);}
export async function restoreTrash(id:string,revision:string,asCopy=false,signal?:AbortSignal){return (await apiResult<import('../shared/recovery').TrashRestoreResult>(`/trash/${encodeURIComponent(id)}/restore`,{asCopy},'POST',{'If-Match':revision},signal)).data;}
export async function inspectMedia(projectId:string,signal?:AbortSignal){return api<import('../shared/recovery').MediaRecoveryInspection>(`/projects/${projectId}/media-recovery`,undefined,'GET',signal);}
export async function planMediaRelink(projectId:string,mediaId:string,replacementPath:string,revision:string,signal?:AbortSignal){return (await apiResult<import('../shared/recovery').MediaRelinkPlan>(`/projects/${projectId}/media-recovery/plan`,{mediaId,replacementPath},'POST',{'If-Match':revision},signal)).data;}
export async function applyMediaRelink(projectId:string,planId:string,revision:string,acknowledgements:string[]=[]){return (await apiResult<import('../shared/recovery').MediaRelinkResult>(`/projects/${projectId}/media-recovery/apply`,{planId,acknowledgements},'POST',{'If-Match':revision})).data;}
export async function undoMediaRelink(projectId:string,planId:string,revision:string){return (await apiResult<import('../shared/recovery').MediaRelinkResult>(`/projects/${projectId}/media-recovery/undo`,{planId},'POST',{'If-Match':revision})).data;}

// Durable export receipts contain summaries only; saved project snapshots stay on the server.
export const listSavedExports=(projectId:string,signal?:AbortSignal,offset=0)=>api<{jobs:import('../shared/export-history').ExportRecord[];nextOffset:number|null;diagnostics?:{unavailableCount:number;message?:string}}>(`/exports?projectId=${encodeURIComponent(projectId)}&offset=${offset}&limit=200`,undefined,'GET',signal);
export const getSavedExport=(id:string,signal?:AbortSignal)=>api<import('../shared/export-history').ExportRecord>(`/exports/${encodeURIComponent(id)}`,undefined,'GET',signal);
export const startSavedExport=async(projectId:string,options:import('../shared/types').ExportOptions,revision:string,signal?:AbortSignal)=>(await apiResult<import('../shared/export-history').ExportRecord>('/export',{projectId,options},'POST',{'If-Match':revision},signal)).data;
export const restartSavedExport=(id:string,acknowledgeRuntimeChange=false,signal?:AbortSignal)=>api<import('../shared/export-history').ExportRecord>(`/exports/${encodeURIComponent(id)}/restart`,{acknowledgeRuntimeChange},'POST',signal);
export const cancelSavedExport=(id:string,signal?:AbortSignal)=>api<import('../shared/export-history').ExportRecord>(`/exports/${encodeURIComponent(id)}`,undefined,'DELETE',signal);
