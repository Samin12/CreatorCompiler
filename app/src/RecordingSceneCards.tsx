import {memo,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {DragEvent,ReactNode} from 'react';
import type {Project,Scene} from '../shared/types';
import type {SavedTake} from './recorded-takes';
import {sceneCardData,type ListedTake} from './recording-scene-data';
import {AudioLines,ChevronDown,FolderOpen,GripVertical,Play,Plus,Scissors,Settings2,Trash2,Upload,WandSparkles} from './Icons';
import './recording-scene-cards.css';
export {listSceneTakes} from './recording-scene-data';

type ActionResult=void|Promise<void>;
export interface RecordingSceneCardsProps {
 project:Project;selectedSceneId:string;disabled:boolean;takes:SavedTake[];
 onSelectScene:(id:string)=>ActionResult;
 onRecord:(sceneId:string,mode:'replace-matching'|'record-over')=>ActionResult;
 onImport:(sceneId:string)=>ActionResult;
 onPreview:(takeId:string)=>ActionResult;
 onArchive:(takeId:string)=>ActionResult;
 onDeleteTake:(takeId:string)=>ActionResult;
 onRenameScene:(id:string,name:string)=>ActionResult;
 onAddScene:(afterId?:string)=>ActionResult;
 onDeleteScene:(id:string)=>ActionResult;
 onActivate:(takeId:string)=>ActionResult;
 onMoveTake?:(takeId:string,sceneId:string,archive:boolean)=>ActionResult;
 onMoveScene?:(id:string,beforeId?:string)=>ActionResult;
 onAutoCut?:(sceneId:string)=>ActionResult;
 onVisualize?:(sceneId:string)=>ActionResult;
}
const dragType='application/x-sceneforge-record-card';
type DragItem={projectId:string;kind:'scene'|'take';id:string;};
function durationLabel(value:number){const seconds=Math.max(0,Math.floor(value));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
function CardMenu({label,children}:{label:string;children:ReactNode}){
 const node=useRef<HTMLDivElement>(null),[offset,setOffset]=useState({x:0,y:0});
 useLayoutEffect(()=>{const menu=node.current;if(!menu)return;const bounds=menu.closest('.recording-scene-cards')?.getBoundingClientRect();const place=()=>{menu.style.transform='none';const r=menu.getBoundingClientRect(),left=Math.max(8,(bounds?.left??0)+8),right=Math.min(innerWidth-8,(bounds?.right??innerWidth)-8);setOffset({x:Math.max(left-r.left,Math.min(0,right-r.right)),y:Math.min(0,Math.max(8-r.top,innerHeight-8-r.bottom))});};place();window.addEventListener('resize',place);return()=>window.removeEventListener('resize',place);},[]);
 return <div ref={node} className="rsc-menu" role="menu" aria-label={label} style={{transform:`translate(${offset.x}px,${offset.y}px)`}} onKeyDown={e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();const items=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=items.indexOf(document.activeElement as HTMLButtonElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowUp'?-1:1)+items.length)%items.length]?.focus();}}>{children}</div>;
}
function TakeImage({take}:{take:SavedTake}){
 const media=take.media.find(m=>m.kind==='video'||m.kind==='image');
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[media?.id]);
 if(media&&!failed)return <img draggable={false} loading="lazy" alt="" src={`/api/media/${encodeURIComponent(media.id)}/thumbnail`} onError={()=>setFailed(true)}/>;
 const wave=take.media.find(m=>m.waveform?.length)?.waveform;
 if(!media&&wave?.length){const values=wave.filter(Number.isFinite);const peak=Math.max(1,...values.map(Math.abs));return <svg className="rsc-waveform" viewBox="0 0 112 64" preserveAspectRatio="none" aria-hidden="true">{Array.from({length:28},(_,i)=>{const slice=values.slice(Math.floor(i*values.length/28),Math.max(Math.floor(i*values.length/28)+1,Math.floor((i+1)*values.length/28)));const h=Math.max(2,Math.max(0,...slice.map(Math.abs))/peak*34);return <rect key={i} x={i*4+1} y={(64-h)/2} width="2" height={h} rx="1"/>;})}</svg>;}
 return <span className="rsc-take-placeholder" aria-hidden="true">{media?<Play size={21}/>:<AudioLines size={27}/>}</span>;
}
function SceneName({scene,fallback,disabled,onRename}:{scene:Scene;fallback:string;disabled:boolean;onRename:(name:string)=>void}){
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState(scene.name),cancelled=useRef(false),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(editing){input.current?.focus();input.current?.select();}},[editing]);
 useEffect(()=>{if(disabled){cancelled.current=true;setEditing(false);}},[disabled]);
 const finish=()=>{const commit=!cancelled.current&&!disabled&&draft.trim()&&draft.trim()!==scene.name;cancelled.current=true;setEditing(false);if(commit)onRename(draft.trim());};
 return editing?<input ref={input} className="rsc-name-input" aria-label="Scene name" maxLength={200} value={draft} disabled={disabled} onChange={e=>setDraft(e.target.value)} onBlur={finish} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();finish();}if(e.key==='Escape'){e.preventDefault();cancelled.current=true;setEditing(false);}}}/>:<button type="button" className="rsc-scene-name" disabled={disabled} aria-label={`Rename ${scene.name||fallback}`} title="Rename scene" onClick={()=>{cancelled.current=false;setDraft(scene.name||'');setEditing(true);}}>{scene.name||fallback}</button>;
}
/** Memoized: Recording passes stable callbacks, so preview, device and status updates do not re-render every card. */
export const RecordingSceneCards=memo(function RecordingSceneCards(props:RecordingSceneCardsProps){
 const {project,takes,disabled}=props,root=useRef<HTMLDivElement>(null),[menu,setMenu]=useState<string|null>(null),[expanded,setExpanded]=useState<Record<string,boolean>>({}),[alt,setAlt]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[drag,setDrag]=useState<DragItem|null>(null),[drop,setDrop]=useState<string|null>(null);
 const alive=useRef(true),generation=useRef(0),locked=disabled||busy,{clips,media,scenes}=project,cards=useMemo(()=>sceneCardData({clips,media,scenes},takes),[clips,media,scenes,takes]);
 useEffect(()=>{alive.current=true;generation.current++;setExpanded({});setMenu(null);setError('');setBusy(false);setAlt(false);setDrag(null);setDrop(null);return()=>{alive.current=false;generation.current++;};},[project.id]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{setAlt(e.altKey);if(e.key==='Escape'){setMenu(null);setDrag(null);setDrop(null);}};const blur=()=>setAlt(false);window.addEventListener('keydown',key);window.addEventListener('keyup',key);window.addEventListener('blur',blur);return()=>{window.removeEventListener('keydown',key);window.removeEventListener('keyup',key);window.removeEventListener('blur',blur);};},[]);
 useEffect(()=>{if(locked){setMenu(null);setDrag(null);setDrop(null);}},[locked]);
 useEffect(()=>{if(!menu)return;const close=(event:PointerEvent)=>{if(!(event.target instanceof Element)||!event.target.closest('[data-rsc-menu]'))setMenu(null);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[menu]);
 const invoke=(action:()=>ActionResult)=>{if(locked)return;setMenu(null);setError('');const version=generation.current;try{const result=action();if(result&&typeof result.then==='function'){setBusy(true);result.catch(e=>{if(alive.current&&version===generation.current)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(alive.current&&version===generation.current)setBusy(false);});}}catch(e){setError(e instanceof Error?e.message:String(e));}};
 const startDrag=(e:DragEvent,item:DragItem)=>{if(locked){e.preventDefault();return;}e.stopPropagation();e.dataTransfer.setData(dragType,JSON.stringify(item));e.dataTransfer.effectAllowed='move';setDrag(item);setMenu(null);};
 const endDrag=()=>{setDrag(null);setDrop(null);};
 const readDrag=(e:DragEvent):DragItem|null=>{try{const value=JSON.parse(e.dataTransfer.getData(dragType));if(value.projectId!==project.id||!['scene','take'].includes(value.kind)||typeof value.id!=='string')return null;if(value.kind==='scene'?!project.scenes.some(s=>s.id===value.id):!takes.some(t=>t.id===value.id))return null;return value;}catch{return null;}};
 const receiveTake=(e:DragEvent,sceneId:string,archive:boolean)=>{const value=readDrag(e);if(value?.kind!=='take')return;e.preventDefault();e.stopPropagation();endDrag();if(locked)return;const take=takes.find(t=>t.id===value.id)!;if(take.sceneId!==sceneId){if(props.onMoveTake)invoke(()=>props.onMoveTake!(take.id,sceneId,archive));}else invoke(()=>archive?props.onArchive(take.id):props.onActivate(take.id));};
 const insertionBefore=(e:DragEvent,index:number)=>{const bounds=e.currentTarget.getBoundingClientRect();return e.clientY<bounds.top+bounds.height/2?project.scenes[index].id:project.scenes[index+1]?.id;};
 const receiveScene=(e:DragEvent,index:number)=>{const value=readDrag(e);if(value?.kind!=='scene')return;e.preventDefault();e.stopPropagation();const beforeId=insertionBefore(e,index);endDrag();if(!locked&&props.onMoveScene&&value.id!==beforeId)invoke(()=>props.onMoveScene!(value.id,beforeId));};
 const menuButton=(id:string,label:string)=> <button type="button" className="rsc-gear" aria-label={label} aria-expanded={menu===id} aria-haspopup="menu" disabled={locked} onClick={e=>{e.stopPropagation();setMenu(menu===id?null:id);}}><Settings2 size={17}/></button>;
 const menuItem=(label:string,action:()=>ActionResult,options:{disabled?:boolean;danger?:boolean;icon?:ReactNode}={})=><button type="button" role="menuitem" disabled={locked||options.disabled} className={options.danger?'rsc-danger':undefined} onClick={()=>invoke(action)}>{options.icon}{label}</button>;
 const renderTake=(item:ListedTake,sceneId:string)=>{const {take,active,number,duration}=item,label=take.name||`Take ${number}`,key=`take:${take.id}`;return <div key={take.id} className="rsc-take" data-take-id={take.id} data-active={active} draggable={!locked} onDragStart={e=>startDrag(e,{projectId:project.id,kind:'take',id:take.id})} onDragEnd={endDrag} onContextMenu={e=>{e.preventDefault();e.stopPropagation();if(!locked)setMenu(key);}}>
  <button type="button" className="rsc-take-preview" aria-label={`Preview ${label}`} disabled={locked} onClick={()=>invoke(()=>props.onPreview(take.id))}><TakeImage take={take}/><span className="rsc-play"><Play size={17}/></span><span className="rsc-take-badge">{label}<small>({durationLabel(duration)})</small></span></button>
  <span className="rsc-drag-handle" aria-hidden="true"><GripVertical size={15}/></span>
  <div className="rsc-take-menu-anchor" data-rsc-menu>{menuButton(key,`Options for ${label}`)}{menu===key&&<CardMenu label={`${label} actions`}>
   {menuItem('Play take',()=>props.onPreview(take.id),{icon:<Play size={15}/>})}
   {active?menuItem('Archive take',()=>props.onArchive(take.id),{icon:<FolderOpen size={15}/>}):menuItem('Add to timeline',()=>props.onActivate(take.id),{icon:<Plus size={15}/>})}
   {props.onMoveTake&&project.scenes.length>1&&<><span className="rsc-menu-label">Move to scene</span>{project.scenes.filter(s=>s.id!==sceneId).map(s=><button key={s.id} type="button" role="menuitem" disabled={locked} onClick={()=>invoke(()=>props.onMoveTake!(take.id,s.id,!active))}>{s.name||'Untitled scene'}</button>)}</>}
   {menuItem('Delete take',()=>props.onDeleteTake(take.id),{danger:true,icon:<Trash2 size={15}/>})}
  </CardMenu>}</div>
 </div>;};
 return <div ref={root} className="recording-scene-cards" aria-label="Recording scenes" aria-busy={busy}>
  {error&&<div className="rsc-error" role="alert">{error}<button type="button" aria-label="Dismiss scene action error" onClick={()=>setError('')}>×</button></div>}
  {!project.scenes.length&&<div className="rsc-empty"><p>Add a scene to start recording.</p><button type="button" className="rsc-action" disabled={locked} onClick={()=>invoke(()=>props.onAddScene())}><Plus size={16}/>Add scene</button></div>}
  {project.scenes.map((scene,index)=>{const {all,legacyFootage}=cards.get(scene.id)!,active=all.filter(t=>t.active),archived=all.filter(t=>!t.active),showArchive=expanded[scene.id]??active.length===0,selected=props.selectedSceneId===scene.id,key=`scene:${scene.id}`;
   const recorded=active.length>0||legacyFootage,recordOver=alt&&recorded;
   return <div className="rsc-scene-container" key={`${project.id}:${scene.id}`}>
    <article className={`rsc-scene ${selected?'is-selected':''} ${drop===`before:${scene.id}`?'is-drop-before':''} ${index===project.scenes.length-1&&drop==='end'?'is-drop-after':''}`} data-scene-id={scene.id} aria-label={`${scene.name||`Scene ${index+1}`}, ${recorded?'recorded':'not recorded'}`} draggable={!!props.onMoveScene&&!locked} onDragStart={e=>{if(e.target!==e.currentTarget&&(e.target as Element).closest('button,input,[data-take-id]')){if(!(e.target as Element).closest('[data-take-id]'))e.preventDefault();return;}startDrag(e,{projectId:project.id,kind:'scene',id:scene.id});}} onDragEnd={endDrag} onDragOver={e=>{if(!locked&&props.onMoveScene&&drag?.kind==='scene'){e.preventDefault();e.dataTransfer.dropEffect='move';const beforeId=insertionBefore(e,index);setDrop(beforeId?`before:${beforeId}`:'end');}}} onDrop={e=>receiveScene(e,index)} onPointerDown={()=>{if(!locked&&props.selectedSceneId!==scene.id)invoke(()=>props.onSelectScene(scene.id));}} onFocus={()=>{if(!locked&&props.selectedSceneId!==scene.id)invoke(()=>props.onSelectScene(scene.id));}}>
     <header className="rsc-scene-heading">{props.onMoveScene&&<button type="button" className="rsc-scene-grip" draggable={!locked} disabled={locked} aria-label={`Reorder ${scene.name||`Scene ${index+1}`}`} title="Drag to reorder · Alt+↑ / Alt+↓" onClick={e=>e.stopPropagation()} onDragStart={e=>startDrag(e,{projectId:project.id,kind:'scene',id:scene.id})} onDragEnd={endDrag} onKeyDown={e=>{if(!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();if(e.key==='ArrowUp'&&index>0)invoke(()=>props.onMoveScene!(scene.id,project.scenes[index-1].id));if(e.key==='ArrowDown'&&index<project.scenes.length-1)invoke(()=>props.onMoveScene!(scene.id,project.scenes[index+2]?.id));}}><GripVertical size={15}/></button>}<span className={`rsc-status ${recorded?'is-complete':''}`} title={recorded?'Recorded':'Not recorded'} aria-hidden="true"/><SceneName scene={scene} fallback={`Scene ${index+1}`} disabled={locked} onRename={name=>invoke(()=>props.onRenameScene(scene.id,name))}/><div data-rsc-menu className="rsc-scene-menu-anchor">{menuButton(key,`Settings for ${scene.name||`Scene ${index+1}`}`)}{menu===key&&<CardMenu label="Scene actions">
      {menuItem('Record new…',()=>props.onRecord(scene.id,'replace-matching'))}
      {menuItem('Record over…',()=>props.onRecord(scene.id,'record-over'),{disabled:!recorded})}
      {menuItem('Import media from file…',()=>props.onImport(scene.id),{icon:<Upload size={15}/>})}
      {menuItem('Add scene after',()=>props.onAddScene(scene.id),{icon:<Plus size={15}/>})}
      {props.onMoveScene&&index>0&&menuItem('Move scene up',()=>props.onMoveScene!(scene.id,project.scenes[index-1].id))}
      {props.onMoveScene&&index<project.scenes.length-1&&menuItem('Move scene down',()=>props.onMoveScene!(scene.id,project.scenes[index+2]?.id))}
      {menuItem('Delete scene',()=>props.onDeleteScene(scene.id),{danger:true,icon:<Trash2 size={15}/>})}
     </CardMenu>}</div></header>
     {scene.script&&<p className="rsc-script" dir="auto">{scene.script}</p>}
     <div className={`rsc-takes ${drop===`active:${scene.id}`?'is-over':''}`} aria-label={`${scene.name||'Scene'} confirmed takes`} onDragOver={e=>{if(!locked&&drag?.kind==='take'&&(props.onMoveTake||takes.find(t=>t.id===drag.id)?.sceneId===scene.id)){e.preventDefault();e.stopPropagation();setDrop(`active:${scene.id}`);}}} onDragLeave={()=>setDrop(null)} onDrop={e=>receiveTake(e,scene.id,false)}>
      {recorded?<button type="button" className="rsc-record-tile" disabled={locked} onClick={()=>invoke(()=>props.onRecord(scene.id,recordOver?'record-over':'replace-matching'))}><Plus size={16}/>{recordOver?'Record Over':'Record'}</button>:<div className="rsc-empty-record-row"><button type="button" className="rsc-record-button" disabled={locked} onClick={()=>invoke(()=>props.onRecord(scene.id,'replace-matching'))}><span aria-hidden="true"/>Record</button><button type="button" className="rsc-import" disabled={locked} onClick={()=>invoke(()=>props.onImport(scene.id))}>or Import from file.</button></div>}
      {active.map(t=>renderTake(t,scene.id))}
     </div>
     {legacyFootage&&<p className="rsc-legacy-note">Existing scene footage is available in Edit. Its take history is unavailable.</p>}
     {(props.onAutoCut||props.onVisualize)&&<div className="rsc-quick-actions" aria-label={`Quick actions for ${scene.name||`Scene ${index+1}`}`}>
      {props.onAutoCut&&<button type="button" disabled={locked||scene.duration<=0} title={scene.duration>0?'Review Auto-cut changes for this scene only':'Add footage to this scene first'} onClick={()=>invoke(()=>props.onAutoCut!(scene.id))}><Scissors size={14}/>Auto-cut</button>}
      {props.onVisualize&&<button type="button" disabled={locked||scene.duration<=0} title={scene.duration>0?'Review visuals for this scene only':'Add footage to this scene first'} onClick={()=>invoke(()=>props.onVisualize!(scene.id))}><WandSparkles size={14}/>Visualize</button>}
     </div>}
     {archived.length>0&&<><button type="button" className="rsc-archive-toggle" disabled={locked} aria-expanded={showArchive} onClick={()=>setExpanded({...expanded,[scene.id]:!showArchive})}>{showArchive?<ChevronDown size={15}/>:<FolderOpen size={15}/>}Archived ({archived.length})</button>{showArchive&&<div className={`rsc-takes rsc-archived ${drop===`archive:${scene.id}`?'is-over':''}`} aria-label={`${scene.name||'Scene'} archived takes`} onDragOver={e=>{if(!locked&&drag?.kind==='take'&&(props.onMoveTake||takes.find(t=>t.id===drag.id)?.sceneId===scene.id)){e.preventDefault();e.stopPropagation();setDrop(`archive:${scene.id}`);}}} onDragLeave={()=>setDrop(null)} onDrop={e=>receiveTake(e,scene.id,true)}>{archived.map(t=>renderTake(t,scene.id))}</div>}</>}
    </article>
    <button type="button" className="rsc-add-between" disabled={locked} onClick={()=>invoke(()=>props.onAddScene(scene.id))}><Plus size={15}/> {index===project.scenes.length-1?'Add scene':'Add scene here'}</button>
   </div>;
  })}
 </div>;
});
export default RecordingSceneCards;
