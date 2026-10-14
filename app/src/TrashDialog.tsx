import {useEffect,useRef,useState} from 'react';
import type {TrashProjectSummary,TrashRestoreResult} from '../shared/recovery';
import {getTrash,restoreTrash,timecode} from './api';
import {Modal} from './Dialogs';
import {FolderOpen,LoaderCircle,RotateCcw,Trash2} from './Icons';
import {RecoveryRequestScope} from './recovery-session';
import './recovery.css';
import {useRecoveryFocus} from './useRecoveryFocus';

export function TrashDialog({onClose,onRestored,onOpen}:{onClose:()=>void;onRestored:(result:TrashRestoreResult)=>void;onOpen:(id:string)=>void}){
 const content=useRecoveryFocus();
 const [items,setItems]=useState<TrashProjectSummary[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[restored,setRestored]=useState<TrashRestoreResult|null>(null);
 const scope=useRef(new RecoveryRequestScope());
 const load=async()=>{const request=scope.current.begin();setLoading(true);setError('');try{const value=await getTrash(request.signal);if(request.active())setItems(value.items);}catch(e){if(request.active())setError((e as Error).message);}finally{if(request.active())setLoading(false);}};
 useEffect(()=>{void load();return()=>scope.current.stop();},[]);
 const restore=async(item:TrashProjectSummary)=>{if(busy)return;const request=scope.current.begin();setBusy(item.id);setError('');try{const result=await restoreTrash(item.id,item.revision,item.collision);onRestored(result);if(request.active()){setItems(v=>v.filter(x=>x.id!==item.id));setRestored(result);}}catch(e){if(request.active())setError((e as Error).message);}finally{if(request.active())setBusy('');}};
 return <Modal title="Project trash" subtitle="Restore projects you moved to trash on this computer." onClose={()=>{if(!busy)onClose();}}><div className="recovery-dialog" ref={content}>
 <p className="hint">Restoring does not overwrite another project. If its ID is already in use, choose Restore as copy to create a separate project.</p>
 {loading?<p className="recovery-loading" role="status"><LoaderCircle className="spin" size={18}/>Loading trash…</p>:items.length?<ul className="trash-list">{items.map(item=><li key={item.id}><Trash2 size={18}/><div><strong>{item.name}</strong><small>Moved {new Date(item.trashedAt).toLocaleString()} · {timecode(item.duration)} · {item.mediaCount} files</small>{item.collision&&<span className="recovery-tag">Existing project with this ID</span>}</div><button className="button" disabled={Boolean(busy)} onClick={()=>void restore(item)}>{busy===item.id?<LoaderCircle className="spin" size={15}/>:<RotateCcw size={15}/>} {item.collision?'Restore as copy':'Restore'}</button></li>)}</ul>:<div className="empty-state"><Trash2/><h3>Trash is empty</h3><p>Projects moved to trash will appear here.</p></div>}
 {restored&&<div className="recovery-success" role="status"><strong>{restored.project.name} restored{restored.restoredAsCopy?' as a separate copy':''}.</strong><button className="button" disabled={Boolean(busy)} onClick={()=>onOpen(restored.project.id)}><FolderOpen size={15}/>Open restored project</button></div>}
 {error&&<div className="inline-error" role="alert">{error}<button className="button" disabled={Boolean(busy)} onClick={()=>void load()}>Refresh trash</button></div>}
 <footer className="modal-actions"><button className="button" disabled={Boolean(busy)||loading} onClick={()=>void load()}><RotateCcw size={15}/>Refresh</button><button className="button primary" disabled={Boolean(busy)} onClick={onClose}>Done</button></footer>
 </div></Modal>;
}
