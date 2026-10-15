import {useEffect,useRef,useState} from 'react';
import type {AISuggestion,Project} from '../shared/types';
import type {ProjectChange} from './useStudio';
import {api} from './api';
import {AIDialogRequestScope} from './ai-dialog-request';
import {Modal} from './Dialogs';
import {LoaderCircle,Sparkles} from './Icons';

export type ScriptAssistantProps={project:Project;sceneId?:string;change:ProjectChange;flush:()=>Promise<Project|undefined>;onClose:()=>void;onError:(message:string)=>void};
type Revision={projectId:string;sceneId:string;original:string;text:string};

export function ScriptAssistant({project,sceneId,change,flush,onClose}:ScriptAssistantProps){
 const [targetId,setTargetId]=useState(sceneId??project.scenes[0]?.id??''),[prompt,setPrompt]=useState(''),[busy,setBusy]=useState(false),[proposal,setProposal]=useState<Revision|null>(null),[message,setMessage]=useState('');
 const requests=useRef(new AIDialogRequestScope()),latest=useRef(project);latest.current=project;
 const target=project.scenes.find(scene=>scene.id===targetId),stale=Boolean(proposal&&(!target||target.script!==proposal.original));
 useEffect(()=>{requests.current.cancel();setTargetId(sceneId??project.scenes[0]?.id??'');setProposal(null);setBusy(false);setMessage('');return()=>requests.current.cancel();},[project.id,sceneId]);
 const close=()=>{requests.current.cancel();onClose();};
 const run=async()=>{
  if(busy||!target)return;setBusy(true);setMessage('');setProposal(null);
  const projectId=project.id,id=targetId;
  await requests.current.run(async signal=>{
   const snapshot=await flush();signal.throwIfAborted();
   if(!snapshot||snapshot.id!==projectId)throw Error('The project changed. Reopen script assistance.');
   const scene=snapshot.scenes.find(scene=>scene.id===id);if(!scene)throw Error('This scene no longer exists.');
   const response=await api<{suggestions:AISuggestion[]}>('/ai/analyze',{projectId,kind:'script',sceneId:id,prompt},'POST',signal);
   const text=response.suggestions.filter(item=>item.type==='script').map(item=>item.text).join('\n\n');if(!text.trim())throw Error('No revised script was returned. Try another instruction.');
   return {projectId,sceneId:id,original:scene.script,text};
  },{relevant:()=>latest.current.id===projectId,success:setProposal,error:error=>setMessage((error as Error).message),finish:()=>setBusy(false)});
 };
 const apply=()=>{
  if(!proposal||busy)return;
  try{change(draft=>{
   const scene=draft.scenes.find(scene=>scene.id===proposal.sceneId);
   if(draft.id!==proposal.projectId||!scene||scene.script!==proposal.original)throw Error('This script changed. Generate a fresh revision before replacing it.');
   scene.script=proposal.text;
  });setProposal(null);setMessage('Script replaced. Undo restores the previous version.');}catch(error){setMessage((error as Error).message);}
 };
 return <Modal title="Improve script" subtitle="Review a revision for one scene before replacing its script." onClose={close} wide>
  <div className="script-assistant">
   <label className="field">Scene<select aria-label="Script scene" disabled={busy||Boolean(sceneId)} value={targetId} onChange={event=>{requests.current.cancel();setTargetId(event.target.value);setProposal(null);setMessage('');}}>{project.scenes.map(scene=><option key={scene.id} value={scene.id}>{scene.name||'Untitled scene'}</option>)}</select></label>
   {!target&&<p role="alert">This scene no longer exists. Close this panel and choose another scene.</p>}
   <label className="field">What should improve?<textarea rows={3} disabled={busy} value={prompt} onChange={event=>setPrompt(event.target.value)} placeholder="Make the opening shorter. Keep my wording and meaning."/></label>
   <button className="button" disabled={busy||!target?.script.trim()} onClick={()=>void run()}>{busy?<LoaderCircle size={15} className="spin"/>:<Sparkles size={15}/>} {busy?'Preparing revision…':proposal?'Generate another revision':'Improve script'}</button>
   {proposal&&<div className="script-revision"><section><h3>Original · {target?.name}</h3><p>{proposal.original}</p></section><section><h3>Proposed revision</h3><p>{proposal.text}</p></section></div>}
   {stale&&<p role="alert" className="inline-error">This script changed. Generate a fresh revision before replacing it.</p>}
   {message&&<p role="status">{message}</p>}
   <p className="hint">Only this scene’s script is sent to the provider configured in Settings → AI &amp; transcription.</p>
   <footer className="modal-actions"><button className="button" onClick={close}>Close</button>{proposal&&<button className="button primary" disabled={busy||stale} onClick={apply}>Replace “{target?.name||'scene'}” script</button>}</footer>
  </div>
 </Modal>;
}
