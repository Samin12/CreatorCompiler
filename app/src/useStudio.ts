import {useCallback,useEffect,useRef,useState} from 'react';
import type {Capabilities, Project, ProjectSummary} from '../shared/types';
import {api,apiResult,APIError,projectRevision} from './api';
import {runGuardedProjectOperation,projectRefreshDisposition} from './recovery-session';

export function useStudio(){
 const [project,setProject]=useState<Project|null>(null),[projects,setProjects]=useState<ProjectSummary[]>([]),[capabilities,setCapabilities]=useState<Capabilities|null>(null),[saveState,setSaveState]=useState('Saved locally'),[error,setError]=useState(''),[loading,setLoading]=useState(true),[conflicted,setConflicted]=useState(false);
 const undoRef=useRef<Project[]>([]),redoRef=useRef<Project[]>([]),current=useRef<Project|null>(null),saved=useRef(''),saveQueue=useRef(Promise.resolve()),revision=useRef(Promise.resolve('')),conflict=useRef(false),[historyTick,setHistoryTick]=useState(0);
 current.current=project;
 const refresh=useCallback(async()=>{setProjects(await api<ProjectSummary[]>('/projects'));},[]);
 useEffect(()=>{Promise.all([refresh(),api<Capabilities>('/health').then(setCapabilities)]).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[refresh]);
 const select=useCallback((p:Project)=>{saved.current=JSON.stringify(p);revision.current=projectRevision(p);conflict.current=false;setConflicted(false);current.current=p;setProject(p);undoRef.current=[];redoRef.current=[];setHistoryTick(x=>x+1);setSaveState('Saved locally');},[]);
 const change=useCallback((fn:(p:Project)=>void)=>{const p=current.current;if(!p)return;const next=structuredClone(p);fn(next);next.updatedAt=new Date().toISOString();const size=JSON.stringify(p).length;const limit=Math.max(2,Math.min(80,Math.floor(24_000_000/Math.max(1,size))));undoRef.current=[...undoRef.current.slice(-(limit-1)),p];redoRef.current=[];current.current=next;setProject(next);setHistoryTick(x=>x+1);setSaveState('Saving…');},[]);
 const undo=useCallback(()=>{const prev=undoRef.current.pop();if(!prev||!current.current)return;redoRef.current.push(current.current);current.current=prev;setProject(prev);setHistoryTick(x=>x+1);},[]);
 const redo=useCallback(()=>{const next=redoRef.current.pop();if(!next||!current.current)return;undoRef.current.push(current.current);current.current=next;setProject(next);setHistoryTick(x=>x+1);},[]);
 const flush=useCallback(async()=>{const p=current.current;if(!p)return;if(conflict.current)throw new Error('Autosave is paused because this project changed externally. Reload the server version before continuing.');const json=JSON.stringify(p);const task=saveQueue.current.catch(()=>{}).then(async()=>{if(conflict.current)throw new Error('Project conflict: autosave is paused.');if(saved.current===json)return;try{const expected=await revision.current;const result=await apiResult<Project>(`/projects/${p.id}`,p,'PUT',{'If-Match':expected});revision.current=result.etag?Promise.resolve(result.etag):projectRevision(result.data);saved.current=JSON.stringify(result.data);if(current.current===p){current.current=result.data;setProject(result.data);setSaveState('Saved locally');}}catch(e){if(e instanceof APIError&&e.status===409){conflict.current=true;setConflicted(true);setSaveState('Autosave paused');}throw e;}});saveQueue.current=task;await task;return current.current??p;},[]);
 useEffect(()=>{if(!project||conflicted||JSON.stringify(project)===saved.current)return;setSaveState('Saving…');const timer=setTimeout(()=>{void flush().catch(e=>{if(!conflict.current)setSaveState('Save failed');setError(e.message);});},650);return()=>clearTimeout(timer);},[project,flush,conflicted]);
 useEffect(()=>{
  const events=new EventSource('/api/events');let disposed=false,queue=Promise.resolve(),listTimer:ReturnType<typeof setTimeout>|undefined;
  const cleanRevision=(value:string)=>value.replace(/^W\//,'').replaceAll('"','');
  const refreshList=()=>{if(listTimer)clearTimeout(listTimer);listTimer=setTimeout(()=>{void refresh().catch(e=>setError(e.message));},200);};
  const receive=(event:MessageEvent)=>{let update:{id:string;revision?:string;action?:string};try{update=JSON.parse(event.data);}catch{return;}
   queue=queue.catch(()=>{}).then(async()=>{
    let pending=saveQueue.current;await pending.catch(()=>{});while(pending!==saveQueue.current){pending=saveQueue.current;await pending.catch(()=>{});}if(disposed)return;
    const before=current.current;if(!before||before.id!==update.id){refreshList();return;}
    const acknowledged=await revision.current;if(disposed)return;if(update.action!=='trashed'&&update.revision&&cleanRevision(update.revision)===cleanRevision(acknowledged))return;
    const dirty=JSON.stringify(before)!==saved.current;
    if(dirty||conflict.current){conflict.current=true;setConflicted(true);setSaveState('Autosave paused');setError(update.action==='trashed'?'This project was moved to trash externally. Your unsaved edits are still open.':'An assistant or another window changed this project. Your unsaved edits are preserved; reload the server version to continue.');return;}
    if(update.action==='trashed'){current.current=null;setProject(null);saved.current='';undoRef.current=[];redoRef.current=[];setHistoryTick(x=>x+1);refreshList();return;}
    const fresh=await apiResult<Project>(`/projects/${update.id}`);if(disposed)return;
    // A local edit may arrive while the fresh version is being fetched.
    const disposition=projectRefreshDisposition(before,current.current,fresh.data,saved.current);if(disposition==='ignore')return;
    if(disposition==='conflict'){conflict.current=true;setConflicted(true);setSaveState('Autosave paused');return;}
    select(fresh.data);if(fresh.etag)revision.current=Promise.resolve(fresh.etag);
   }).catch(e=>{if(!disposed)setError(e.message);});
  };
  events.addEventListener('ready',()=>{const id=current.current?.id;if(!id)return;void apiResult<Project>(`/projects/${id}`).then(fresh=>{if(disposed||current.current?.id!==id)return;return (fresh.etag?Promise.resolve(fresh.etag):projectRevision(fresh.data)).then(revision=>receive(new MessageEvent('project',{data:JSON.stringify({id,revision,action:'saved'})})));}).catch(()=>{});});
  events.addEventListener('project',receive);return()=>{disposed=true;events.close();if(listTimer)clearTimeout(listTimer);};
 },[refresh,select]);
 const runProjectOperation=useCallback(<T extends {project:Project;revision:string}>(projectId:string,operation:(snapshot:Project,revision:string)=>Promise<T>,signal?:AbortSignal)=>runGuardedProjectOperation({projectId,signal,current:()=>current.current,flush,revision:()=>revision.current,operation,adopt:result=>{select(result.project);revision.current=Promise.resolve(result.revision);void refresh().catch(e=>setError(e.message));},conflict:()=>{conflict.current=true;setConflicted(true);setSaveState('Autosave paused');setError('Recovery finished on the saved project. Your newer local edits are preserved. Reload the saved version before continuing.');}}),[flush,select,refresh]);
 const open=async(id:string)=>{try{await flush();select(await api<Project>(`/projects/${id}`));}catch(e){setError((e as Error).message);}};
 const create=async(name:string)=>{try{await flush();select(await api<Project>('/projects',{name}));await refresh();}catch(e){setError((e as Error).message);}};
 const close=async()=>{try{await flush();setProject(null);current.current=null;await refresh();}catch(e){setError((e as Error).message);}};
 void historyTick;
 const reload=async()=>{if(!current.current)return;select(await api<Project>(`/projects/${current.current.id}`));setError('');};
 return {project,projects,capabilities,saveState,error,setError,loading,refresh,select,change,undo,redo,canUndo:undoRef.current.length>0,canRedo:redoRef.current.length>0,open,create,close,flush,conflicted,reload,runProjectOperation};
}
