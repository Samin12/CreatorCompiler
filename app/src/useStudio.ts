import {useCallback,useEffect,useRef,useState} from 'react';
import type {Capabilities, Project, ProjectSummary} from '../shared/types';
import {adoptSavedProject,api,apiResult,APIError,JSONBody,projectRevision} from './api';
import {EditHistory} from './edit-history';
import {subscribeEvents} from './events';
import {applyProjectChange} from './project-draft';
import {runGuardedProjectOperation,projectRefreshDisposition} from './recovery-session';

/** Edits that share a coalesce key, with no other edit or history step between them and less than a second apart, form one undo step. */
export type ProjectChange=(fn:(p:Project)=>void,opts?:{coalesce?:string})=>void;
const pendingEdits=new Set<()=>void>();
/** Fields that commit text after a pause register here, so saves, history steps and refreshes always include the latest text. */
export function registerPendingEdit(commit:()=>void){pendingEdits.add(commit);return()=>{pendingEdits.delete(commit);};}
const commitPendingEdits=()=>{for(const commit of [...pendingEdits])commit();};
export function useStudio(){
 const [project,setProject]=useState<Project|null>(null),[projects,setProjects]=useState<ProjectSummary[]>([]),[capabilities,setCapabilities]=useState<Capabilities|null>(null),[saveState,setSaveState]=useState('Saved locally'),[error,setError]=useState(''),[loading,setLoading]=useState(true),[conflicted,setConflicted]=useState(false);
 // `saved` is the object that matches the server file; `sent` is the local object it replaced. Both are compared by identity.
 const [history]=useState(()=>new EditHistory<Project>()),current=useRef<Project|null>(null),saved=useRef<Project|null>(null),sent=useRef<Project|null>(null),size=useRef(0),saveQueue=useRef(Promise.resolve()),revision=useRef(Promise.resolve('')),conflict=useRef(false),[historyTick,setHistoryTick]=useState(0),[resave,setResave]=useState(0);
 current.current=project;
 const refresh=useCallback(async()=>{setProjects(await api<ProjectSummary[]>('/projects'));},[]);
 useEffect(()=>{Promise.all([refresh(),api<Capabilities>('/health').then(setCapabilities)]).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[refresh]);
 const select=useCallback((p:Project,etag?:string|null)=>{commitPendingEdits();saved.current=p;sent.current=null;size.current=0;revision.current=etag?Promise.resolve(etag):projectRevision(p);conflict.current=false;setConflicted(false);current.current=p;setProject(p);history.reset();setHistoryTick(x=>x+1);setSaveState('Saved locally');},[history]);
 // The byte size from the last save bounds undo memory; it is measured once when no save has happened yet.
 const change=useCallback<ProjectChange>((fn,opts)=>{const p=current.current;if(!p)return;const next=applyProjectChange(p,fn);history.record(p,()=>{if(!size.current)size.current=JSON.stringify(p).length;return Math.max(2,Math.min(80,Math.floor(24_000_000/Math.max(1,size.current))));},opts?.coalesce);current.current=next;setProject(next);setHistoryTick(x=>x+1);setSaveState('Saving…');},[history]);
 const undo=useCallback(()=>{commitPendingEdits();if(!current.current)return;const prev=history.undo(current.current);if(!prev)return;current.current=prev;setProject(prev);setHistoryTick(x=>x+1);},[history]);
 const redo=useCallback(()=>{commitPendingEdits();if(!current.current)return;const next=history.redo(current.current);if(!next)return;current.current=next;setProject(next);setHistoryTick(x=>x+1);},[history]);
 const flush=useCallback(async()=>{commitPendingEdits();const p=current.current;if(!p)return;if(conflict.current)throw new Error('Autosave is paused because this project changed externally. Reload the server version before continuing.');const task=saveQueue.current.catch(()=>{}).then(async()=>{if(conflict.current)throw new Error('Project conflict: autosave is paused.');if(saved.current===p||sent.current===p)return;try{const expected=await revision.current,json=JSON.stringify(p);size.current=json.length;const result=await apiResult<unknown>(`/projects/${p.id}`,new JSONBody(json),'PUT',{'If-Match':expected,Prefer:'return=minimal'});if(result.etag)revision.current=Promise.resolve(result.etag);const adopted=adoptSavedProject(p,result.data);if(!result.etag)revision.current=projectRevision(adopted);saved.current=adopted;if(current.current===p){sent.current=p;current.current=adopted;setProject(adopted);setSaveState('Saved locally');}else{sent.current=null;setResave(x=>x+1);}}catch(e){if(e instanceof APIError&&e.status===409){conflict.current=true;setConflicted(true);setSaveState('Autosave paused');}throw e;}});saveQueue.current=task;await task;return current.current??p;},[]);
 useEffect(()=>{if(!project||conflicted)return;if(project===saved.current){setSaveState('Saved locally');return;}setSaveState('Saving…');const timer=setTimeout(()=>{void flush().catch(e=>{if(!conflict.current)setSaveState('Save failed');setError(e.message);});},650);return()=>clearTimeout(timer);},[project,flush,conflicted,resave]);
 useEffect(()=>{
  let disposed=false,queue=Promise.resolve(),listTimer:ReturnType<typeof setTimeout>|undefined;
  const cleanRevision=(value:string)=>value.replace(/^W\//,'').replaceAll('"','');
  const refreshList=()=>{if(listTimer)clearTimeout(listTimer);listTimer=setTimeout(()=>{void refresh().catch(e=>setError(e.message));},200);};
  const receive=(event:MessageEvent)=>{let update:{id:string;revision?:string;action?:string};try{update=JSON.parse(event.data);}catch{return;}
   queue=queue.catch(()=>{}).then(async()=>{
    let pending=saveQueue.current;await pending.catch(()=>{});while(pending!==saveQueue.current){pending=saveQueue.current;await pending.catch(()=>{});}if(disposed)return;
    commitPendingEdits();const before=current.current;if(!before||before.id!==update.id){refreshList();return;}
    const acknowledged=await revision.current;if(disposed)return;if(update.action!=='trashed'&&update.revision&&cleanRevision(update.revision)===cleanRevision(acknowledged))return;
    const dirty=before!==saved.current;
    if(dirty||conflict.current){conflict.current=true;setConflicted(true);setSaveState('Autosave paused');setError(update.action==='trashed'?'This project was moved to trash externally. Your unsaved edits are still open.':'An assistant or another window changed this project. Your unsaved edits are preserved; reload the server version to continue.');return;}
    if(update.action==='trashed'){current.current=null;setProject(null);saved.current=null;sent.current=null;history.reset();setHistoryTick(x=>x+1);refreshList();return;}
    const fresh=await apiResult<Project>(`/projects/${update.id}`);if(disposed)return;
    // A local edit may arrive while the fresh version is being fetched.
    commitPendingEdits();const disposition=projectRefreshDisposition(before,current.current,fresh.data,saved.current);if(disposition==='ignore')return;
    if(disposition==='conflict'){conflict.current=true;setConflicted(true);setSaveState('Autosave paused');return;}
    select(fresh.data,fresh.etag);
   }).catch(e=>{if(!disposed)setError(e.message);});
  };
  const ready=()=>{const id=current.current?.id;if(!id)return;void apiResult<Project>(`/projects/${id}`).then(fresh=>{if(disposed||current.current?.id!==id)return;return (fresh.etag?Promise.resolve(fresh.etag):projectRevision(fresh.data)).then(revision=>receive(new MessageEvent('project',{data:JSON.stringify({id,revision,action:'saved'})})));}).catch(()=>{});};
  const stopReady=subscribeEvents('ready',ready),stopProject=subscribeEvents('project',receive);return()=>{disposed=true;stopReady();stopProject();if(listTimer)clearTimeout(listTimer);};
 },[refresh,select,history]);
 const runProjectOperation=useCallback(<T extends {project:Project;revision:string}>(projectId:string,operation:(snapshot:Project,revision:string)=>Promise<T>,signal?:AbortSignal)=>runGuardedProjectOperation({projectId,signal,current:()=>{commitPendingEdits();return current.current;},flush,revision:()=>revision.current,operation,adopt:result=>{select(result.project,result.revision);void refresh().catch(e=>setError(e.message));},conflict:()=>{conflict.current=true;setConflicted(true);setSaveState('Autosave paused');setError('Recovery finished on the saved project. Your newer local edits are preserved. Reload the saved version before continuing.');}}),[flush,select,refresh]);
 const open=async(id:string)=>{try{await flush();const fresh=await apiResult<Project>(`/projects/${id}`);select(fresh.data,fresh.etag);}catch(e){setError((e as Error).message);}};
 const create=async(name:string)=>{try{await flush();const created=await apiResult<Project>('/projects',{name});select(created.data,created.etag);await refresh();}catch(e){setError((e as Error).message);}};
 const close=async()=>{try{await flush();setProject(null);current.current=null;await refresh();}catch(e){setError((e as Error).message);}};
 void historyTick;
 const reload=async()=>{if(!current.current)return;const fresh=await apiResult<Project>(`/projects/${current.current.id}`);select(fresh.data,fresh.etag);setError('');};
 return {project,projects,capabilities,saveState,error,setError,loading,refresh,select,change,undo,redo,canUndo:history.past.length>0,canRedo:history.future.length>0,open,create,close,flush,conflicted,reload,runProjectOperation};
}
