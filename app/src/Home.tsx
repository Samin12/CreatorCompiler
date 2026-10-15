import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Clapperboard,Copy,FolderOpen,LoaderCircle,Search,Trash2,Video,Upload,FileText,ArrowRight,MoreHorizontal} from './Icons';
import type {Media,ProjectSummary} from '../shared/types';
import {api,timecode} from './api';

type HomeAction={label:string;icon:ReactNode;run:()=>void;danger?:boolean};
function HomeActions({label,actions}:{label:string;actions:HomeAction[]}){
 const [open,setOpen]=useState(false),[up,setUp]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId();
 useEffect(()=>{
  if(!open)return;
  root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.current?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[open]);
 return <div className={`home-actions ${up?'opens-up':''}`} ref={root} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
  <button ref={trigger} className="icon-button" aria-label={label} title={label} aria-expanded={open} aria-haspopup="menu" aria-controls={open?id:undefined} onClick={()=>{setUp((trigger.current?.getBoundingClientRect().bottom??0)>window.innerHeight-160);setOpen(value=>!value);}}><MoreHorizontal size={19}/></button>
  {open&&<div id={id} className="home-action-menu" role="menu" aria-label={label} onKeyDown={event=>{
   if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();
   const items=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')],index=items.indexOf(document.activeElement as HTMLButtonElement);
   items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length]?.focus();
  }}>{actions.map(action=><button role="menuitem" className={action.danger?'danger':undefined} key={action.label} onClick={()=>{setOpen(false);trigger.current?.focus();action.run();}}>{action.icon}{action.label}</button>)}</div>}
 </div>;
}

/** The project summary already names the first visual clip's media; projects without one show the placeholder. */
function ProjectThumbnail({project}:{project:ProjectSummary}){const src=project.thumbnailMediaId?`/api/media/${project.thumbnailMediaId}/thumbnail`:undefined;return <span className="project-thumbnail-content">{src?<img src={src} alt="" loading="lazy"/>:<span className="project-thumbnail-empty"><Clapperboard size={24}/></span>}</span>;}
export function Home({projects,loading,onNew,onQuick,onOpen,onImport,onImportMedia,onDuplicate,onDelete,onRecovered,onError,onTrash}:{projects:ProjectSummary[];loading:boolean;onNew:()=>void;onQuick:()=>void;onOpen:(id:string)=>void;onImport:()=>void;onImportMedia:()=>void;onDuplicate:(id:string)=>void;onDelete:(id:string)=>void;onRecovered:(media:Media)=>Promise<void>;onError:(message:string)=>void;onTrash:()=>void}){
 const [search,setSearch]=useState(''),[recoverable,setRecoverable]=useState<Array<{id:string;name:string;chunks:number}>>([]),[recovering,setRecovering]=useState('');
 useEffect(()=>{api<typeof recoverable>('/recordings/recovery').then(setRecoverable).catch(()=>{});},[]);
 const recover=async(id:string)=>{setRecovering(id);try{const media=await api<Media>(`/recordings/${id}/finish`,{});setRecoverable(list=>list.filter(item=>item.id!==id));await onRecovered(media);}catch(e){onError((e as Error).message);}finally{setRecovering('');}};
 const returning=projects.length>0;
 const sorted=[...projects].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 const filtered=sorted.filter(project=>project.name.toLowerCase().includes(search.toLowerCase()));
 return <main className={`borumi-home ${returning?'has-recent-projects':''}`}><div className="start-workflows"><h1>{returning?'Your projects':'Make your first video'}</h1><p className="home-intro">{returning?'Pick up where you left off, or start something new.':'Start recording, bring your footage, or plan what to say.'}</p><div className="start-cards">
  <button className="start-card quick" onClick={onQuick}><span className="start-icon"><Video size={22}/></span><h2>Record a video</h2><p>Capture your camera, screen and microphone.</p></button>
  <button className="start-card import" onClick={onImportMedia}><span className="start-icon"><Upload size={22}/></span><h2>Import footage</h2><p>Start editing video, audio or images.</p></button>
  <button className="start-card structured" onClick={onNew}><span className="start-icon"><FileText size={22}/></span><h2>Write a script</h2><p>Plan your scenes before recording.</p></button>
 </div></div>
 {recoverable.length>0&&<section className="recovery-notice"><h2>Recover unfinished recordings</h2><p>Saved recording chunks were found on this computer.</p>{recoverable.map(item=><div key={item.id}><span>{item.name} · {item.chunks} chunks</span><button className="button" disabled={Boolean(recovering)} onClick={()=>void recover(item.id)}>{recovering===item.id?<LoaderCircle size={14} className="spin"/>:null}Recover recording</button></div>)}</section>}
 <section className="recent-projects"><header><h2>Recent projects</h2><div>{returning&&<label className="recent-search"><Search size={14}/><input placeholder="Search" aria-label="Search projects" value={search} onChange={e=>setSearch(e.target.value)}/></label>}<HomeActions label="Project library options" actions={[{label:'Import project file…',icon:<FolderOpen size={16}/>,run:onImport},{label:'View trash',icon:<Trash2 size={16}/>,run:onTrash}]}/></div></header>{loading?<div className="loading-state"><LoaderCircle className="spin"/>Loading projects…</div>:filtered.map((p,index)=>{const featured=!search&&index===0,resume=p.clipCount===undefined?'Continue project':p.clipCount>0?'Continue editing':'Continue writing';return <article className={`recent-project ${featured?'continue-project':''}`} key={p.id}><button className="recent-project-main" aria-label={`${featured?resume:'Open'} ${p.name}`} onClick={()=>onOpen(p.id)}><span className="recent-thumbnail"><ProjectThumbnail project={p}/>{p.duration>0&&<small>{timecode(p.duration)}</small>}</span><span className="recent-project-copy">{featured&&<span className="continue-eyebrow">Last edited project</span>}<strong title={p.name}>{p.name}</strong><small>{p.sceneCount} {p.sceneCount===1?'scene':'scenes'} · {p.takeCount?`${p.takeCount} ${p.takeCount===1?'take':'takes'}`:p.mediaCount?`${p.mediaCount} ${p.mediaCount===1?'file':'files'}`:'Nothing recorded yet'}</small><time dateTime={p.updatedAt}>Edited {new Date(p.updatedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time></span>{featured&&<span className="continue-action">{resume}<ArrowRight size={16}/></span>}</button><div className="recent-project-tools"><HomeActions label={`More actions for ${p.name}`} actions={[{label:'Duplicate',icon:<Copy size={16}/>,run:()=>onDuplicate(p.id)},{label:'Move to trash',icon:<Trash2 size={16}/>,run:()=>onDelete(p.id),danger:true}]}/></div></article>;})}{!loading&&!projects.length&&<div className="recent-empty"><p>Your projects will appear here. Choose a starting point above.</p></div>}{!loading&&projects.length>0&&!projects.some(p=>p.name.toLowerCase().includes(search.toLowerCase()))&&<div className="recent-empty" role="status"><p>No projects match “{search}”.</p><button className="button" onClick={()=>setSearch('')}>Clear search</button></div>}</section>
 </main>;
}
