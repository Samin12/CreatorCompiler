import {memo,useCallback,useEffect,useRef,useState} from 'react';
import {type Project} from '../shared/types';
import {resolveShortcut,loadShortcutOverrides} from './shortcuts';
import {addRecordingScene,deleteRecordingScene,moveRecordingScene,splitRecordingSceneScript,mergeRecordingSceneScriptBackward} from './recording-scenes';
import {registerPendingEdit,type ProjectChange} from './useStudio';
import {Plus,Trash2,ChevronLeft,ChevronRight,Sparkles} from './Icons';
const fieldSizing=typeof CSS!=='undefined'&&CSS.supports?.('field-sizing','content');
function ScriptText({value,label,onChange,onKeyDown,onBlur,sceneId}:{onKeyDown:(event:React.KeyboardEvent<HTMLTextAreaElement>)=>void;onBlur:()=>void;sceneId:string;value:string;label:string;onChange:(value:string)=>void}){const ref=useRef<HTMLTextAreaElement>(null);useEffect(()=>{if(!fieldSizing&&ref.current){ref.current.style.height='auto';ref.current.style.height=`${Math.max(110,ref.current.scrollHeight)}px`;}},[value]);return <textarea ref={ref} style={fieldSizing?{fieldSizing:'content',minHeight:110} as React.CSSProperties:undefined} data-scene-text={sceneId} onKeyDown={onKeyDown} onBlur={onBlur} aria-label={label} value={value} placeholder="Start writing your amazing video…" onChange={e=>onChange(e.target.value)}/>;}
const WordCount=memo(function WordCount({text}:{text:string}){return <span>{text.trim().split(/\s+/).filter(Boolean).length} words</span>;});
export function ScriptEditor({project:p,change,onAI,onRecord,onError}:{project:Project;change:ProjectChange;onAdd?:()=>void;onAI:()=>void;onRecord:()=>void;onError?:(message:string)=>void}){
 const focus=useRef<{id:string;position:number}|null>(null);
 // Typing stays local; the text reaches the project and its undo history after a short pause, on blur, and before saves or history steps.
 const [drafts,setDrafts]=useState<Record<string,string>>({}),pending=useRef<{projectId:string;texts:Record<string,string>}|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),latest=useRef(p);latest.current=p;
 const commit=useCallback(()=>{clearTimeout(timer.current);const edit=pending.current;if(!edit)return;pending.current=null;setDrafts({});const project=latest.current;if(project.id!==edit.projectId||project.scenes.every(scene=>!Object.hasOwn(edit.texts,scene.id)||scene.script===edit.texts[scene.id]))return;
  change(draft=>{if(draft.id!==edit.projectId)return;for(const scene of draft.scenes)if(Object.hasOwn(edit.texts,scene.id)&&scene.script!==edit.texts[scene.id])scene.script=edit.texts[scene.id];},{coalesce:`script:${Object.keys(edit.texts).join(',')}`});},[change]);
 useEffect(()=>{const stop=registerPendingEdit(commit);return()=>{stop();commit();};},[commit]);
 const write=(id:string,text:string)=>{const texts={...(pending.current?.projectId===p.id?pending.current.texts:{}),[id]:text};pending.current={projectId:p.id,texts};setDrafts(texts);clearTimeout(timer.current);timer.current=setTimeout(commit,300);};
 useEffect(()=>{const next=focus.current;if(!next)return;const textarea=Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[data-scene-text]')).find(node=>node.dataset.sceneText===next.id);if(textarea){textarea.focus();textarea.setSelectionRange(next.position,next.position);focus.current=null;}},[p.scenes]);
 const act=(operation:(draft:Project)=>void,options?:{coalesce?:string})=>{try{commit();change(operation,options);}catch(error){focus.current=null;onError?.(error instanceof Error?error.message:'Could not update this scene. Your project was not changed.');}};
 const key=(event:React.KeyboardEvent<HTMLTextAreaElement>,id:string)=>{
  const resolved=resolveShortcut(event.nativeEvent,{scope:'script',editable:true,scriptEditing:true,availableActions:['createSceneAtCursor','deleteOrMergeBackward']},loadShortcutOverrides());if(!resolved)return;
  const input=event.currentTarget,index=p.scenes.findIndex(s=>s.id===id),scene=p.scenes[index],start=input.selectionStart,end=input.selectionEnd;
  if(!scene||(resolved.id==='createSceneAtCursor'&&!input.value.trim()))return;
  if(resolved.id==='deleteOrMergeBackward'&&(start!==0||end!==0||index===0))return;
  event.preventDefault();event.stopPropagation();
  act(draft=>{focus.current=resolved.id==='createSceneAtCursor'?{id:splitRecordingSceneScript(draft,id,start),position:0}:mergeRecordingSceneScriptBackward(draft,id);});
 };
 return <main className="script-document"><div className="script-document-column">{p.scenes.map((scene,i)=>{const script=drafts[scene.id]??scene.script;return <section className="script-document-scene" key={scene.id} id={`scene-${scene.id}`}>
  <input className="script-scene-name" aria-label={`Scene ${i+1} title`} value={scene.name} onChange={e=>act(draft=>{const current=draft.scenes.find(s=>s.id===scene.id);if(current)current.name=e.target.value;},{coalesce:`scene-name:${scene.id}`})}/>
  <div className="script-document-body"><ScriptText sceneId={scene.id} onKeyDown={event=>key(event,scene.id)} onBlur={commit} label={`Scene ${i+1} script`} value={script} onChange={value=>write(scene.id,value)}/>
  {!script.trim()&&<p className="script-empty-guide">You can paste your script from your favorite editor, or <button onClick={onRecord}>Start recording</button> right away.</p>}
  <footer><WordCount text={script}/><div>
   <button className="icon-button" aria-label={`Move scene ${i+1} up`} disabled={i===0} onClick={()=>act(draft=>{const index=draft.scenes.findIndex(s=>s.id===scene.id);if(index>0)moveRecordingScene(draft,scene.id,draft.scenes[index-1].id);})}><ChevronLeft className="rotate90" size={15}/></button>
   <button className="icon-button" aria-label={`Move scene ${i+1} down`} disabled={i===p.scenes.length-1} onClick={()=>act(draft=>{const index=draft.scenes.findIndex(s=>s.id===scene.id);if(index>=0&&index<draft.scenes.length-1)moveRecordingScene(draft,scene.id,draft.scenes[index+2]?.id);})}><ChevronRight className="rotate90" size={15}/></button>
   <button className="icon-button" aria-label={`Delete scene ${i+1}`} disabled={p.scenes.length===1} onClick={()=>act(draft=>deleteRecordingScene(draft,scene.id))}><Trash2 size={15}/></button>
   <button className="button subtle compact" onClick={onAI}><Sparkles size={14}/>Refine with AI</button>
  </div></footer></div></section>;})}
  <button className="button subtle script-add" onClick={()=>act(draft=>{focus.current={id:addRecordingScene(draft),position:0};})}><Plus size={18}/>Add scene</button>
 </div></main>;
}
