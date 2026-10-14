import {memo,useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Camera,Clapperboard,Layers,Mic,Music,Type,ZoomIn,GripVertical,Plus,Trash2,ChevronDown} from './Icons';
import type {Clip,Media,Project,TrackKind} from '../shared/types';
import {clipDuration,projectDuration} from '../shared/types';
import {timecode} from './api';
import {resolveShortcut,loadShortcutOverrides} from './shortcuts';
import {trimClipLeft} from './timeline-trim';
import {rectangleBetween,itemsInRectangle,orderedTimeRange,type SelectionItem,type SelectionRect} from './timeline-selection';
import {addTimelineLayer,renameTimelineLayer,removeTimelineLayer,clipLayerKind,clipLayerRowId,moveClipsToLayer,timelineRows,type TimelineLayerRow,type LayerKind} from '../shared/timeline-layers';
import {hasWaveform,waveformMediaKey,waveformBars,waveformPath,timelineWaveformCache} from './timeline-waveform';
import {moveRecordingScene} from './recording-scenes';
import type {Playhead} from './playhead';
import {sameTimelineWindow,timelineWindow} from './timeline-viewport';
import {groupMove,hitLayerDrop,isVerticalLayerDrag,sceneDragFingerprint,snapDistancePixels,snapTargets,snapTimelineDelta,timelinePointerDelta,type LayerDrop} from './timeline-drag';

const trackIcons={overlay:Layers,screen:Clapperboard,camera:Camera,audio:Mic,music:Music};
type DisplayRow={id:string;name:string;icon:typeof Camera;layer?:TimelineLayerRow};
type Change=(fn:(project:Project)=>void,opts?:{coalesce?:string})=>void;
interface ClipPreview {start:number;duration:number;dy:number;sourceIn:number;sourceOut:number}
interface DragPreview {clips:Map<string,ClipPreview>;guide:number|null;drop:LayerDrop|null;dropTop:number|null;dropHeight:number;label:string}
type BeginClip=(e:React.PointerEvent,c:Clip,mode:'move'|'left'|'right')=>void;
const LayerRowControls=memo(function LayerRowControls({row,change}:{row:TimelineLayerRow;change:Change}){
 const [editing,setEditing]=useState(false),[name,setName]=useState(row.name),cancelled=useRef(false),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(!editing)setName(row.name);},[row.name,editing]);
 useEffect(()=>{if(editing){input.current?.focus();input.current?.select();}},[editing]);
 const finish=()=>{if(cancelled.current)return;cancelled.current=true;setEditing(false);const trimmed=name.trim();if(trimmed&&trimmed.length<=200&&trimmed!==row.name)change(project=>{renameTimelineLayer(project,row.id,trimmed);});else setName(row.name);};
 return <div className="timeline-layer-controls" onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
  {editing?<input ref={input} aria-label={`Rename ${row.name}`} value={name} maxLength={200} onChange={event=>setName(event.target.value)} onBlur={finish} onKeyDown={event=>{event.stopPropagation();if(event.nativeEvent.isComposing)return;if(event.key==='Enter'){event.preventDefault();finish();}else if(event.key==='Escape'){event.preventDefault();cancelled.current=true;setName(row.name);setEditing(false);}}}/>:<button type="button" className="timeline-layer-name" title="Rename layer" aria-label={`Rename ${row.name}`} onClick={()=>{cancelled.current=false;setName(row.name);setEditing(true);}}>{row.name}</button>}
  <button type="button" className="timeline-layer-remove" aria-label={`Remove ${row.name}`} title="Remove layer. Its clips move to their default rows; Undo restores the layer." onPointerDown={event=>event.preventDefault()} onClick={()=>change(project=>{removeTimelineLayer(project,row.id);})}><Trash2 size={12}/></button>
 </div>;
});
/** Follows the playhead store without rendering the timeline, and pages the view when playback or a seek leaves it. */
function TimelinePlayhead({playhead,scale,scroll}:{playhead:Playhead;scale:number;scroll:React.RefObject<HTMLDivElement|null>}){
 const line=useRef<HTMLDivElement>(null),followed=useRef({time:NaN,scale:NaN});
 useLayoutEffect(()=>{const update=()=>{const time=playhead.get(),x=time*scale,el=scroll.current,ratio=window.devicePixelRatio||1;if(el&&(time!==followed.current.time||scale!==followed.current.scale)){followed.current={time,scale};if(x<el.scrollLeft||x>el.scrollLeft+el.clientWidth-40)el.scrollLeft=Math.max(0,x-el.clientWidth*.25);}if(line.current)line.current.style.transform=`translateX(${Math.round(x*ratio)/ratio}px)`;};update();return playhead.subscribe(update);},[playhead,scale,scroll]);
 return <div className="playhead" ref={line}><span/></div>;
}
/** Skips rendering unless its own clip, preview, selection, waveform or clipped window changes. */
const TimelineClip=memo(function TimelineClip({clip:c,media,preview,selected,peaks,scale,from,to,onBegin}:{clip:Clip;media?:Media;preview?:ClipPreview;selected:boolean;peaks?:readonly number[];scale:number;from:number;to:number;onBegin:BeginClip}){
 const start=preview?.start??c.start,duration=preview?.duration??clipDuration(c),width=Math.max(10,duration*scale),trimmed=!!preview&&(preview.sourceIn!==c.sourceIn||preview.sourceOut!==c.sourceOut);
 // Trims sample the previewed source range; moves keep the clip's own bars and translate them.
 const wave=useMemo(()=>{if(!media||!peaks?.length)return '';const geometry=trimmed?{...c,start,sourceIn:preview!.sourceIn,sourceOut:preview!.sourceOut}:c,shift=start-geometry.start;return waveformPath(waveformBars(geometry,media,peaks,scale,from-shift,to-shift,4096));},[c,media,peaks,scale,from,to,start,trimmed,preview?.sourceIn,preview?.sourceOut]);
 return <div data-clip-id={c.id} className={`timeline-clip clip-${c.track} ${selected?'selected':''} ${c.muted?'muted':''} ${preview?'clip-drag-preview':''}`} style={{left:start*scale,width,transform:preview?.dy?`translateY(${preview.dy}px)`:undefined}} onPointerDown={e=>onBegin(e,c,'move')} title={`${c.name} · ${timecode(duration)} · drag sideways to move, up/down for layers; edges trim`}><div className="trim-handle left" onPointerDown={e=>onBegin(e,c,'left')}/>{media&&media.kind!=='audio'&&<img className="clip-thumb" src={`/api/media/${media.id}/thumbnail`} alt="" loading="lazy" draggable={false}/>}<span>{c.name}</span>{media&&peaks&&peaks.length>0&&<svg className="clip-waveform" data-waveform-media={media.id} viewBox={`0 0 ${width} 28`} preserveAspectRatio="none" aria-label="Source audio waveform, fixed square-root loudness display">{wave&&<path d={wave} fill="none" stroke="currentColor" strokeWidth="1.4"/>}</svg>}<div className="trim-handle right" onPointerDown={e=>onBegin(e,c,'right')}/></div>;
});
export const Timeline=memo(function Timeline({project:p,playhead,zoom,selected,onSelect,onSeek,change,onDropMedia,tool,scrubbing,selectedIds,onSplit,onZoom,onSelectMany,selectedRange,onRange,onSceneAction,showWaveforms=true,onToggleWaveforms}:{showWaveforms?:boolean;onToggleWaveforms?:()=>void;onSceneAction?:(sceneId:string,kind:'auto-cut'|'visualize')=>void;onSelectMany:(ids:string[])=>void;selectedRange:{start:number;end:number}|null;onRange:(range:{start:number;end:number}|null)=>void;tool:'select'|'blade';scrubbing:boolean;selectedIds:ReadonlySet<string>;onSplit:(id:string,time:number)=>void;onZoom:(value:number)=>void;project:Project;playhead:Playhead;zoom:number;selected:string|null;onSelect:(id:string,additive?:boolean)=>void;onSeek:(n:number)=>void;change:Change;onDropMedia:(id:string,track:TrackKind,time:number,layerId?:string)=>void}){
 // Scroll stays in refs; only the quantized window below is state, so scrolling renders a few times per screen.
 const ref=useRef<HTMLDivElement>(null),scrollPos=useRef({left:0,top:0}),[win,setWin]=useState(()=>timelineWindow(0,1000)),winRef=useRef(win),[drag,setDrag]=useState<DragPreview|null>(null);
 const view=(left:number,width:number)=>{const next=timelineWindow(left,width);if(!sameTimelineWindow(next,winRef.current)){winRef.current=next;setWin(next);}};
 const trackLabels=useRef<HTMLDivElement>(null),snapLabel=useRef<HTMLSpanElement>(null),layerLabel=useRef<HTMLSpanElement>(null);
 const placeLabels=()=>{const {left,top}=scrollPos.current;if(trackLabels.current)trackLabels.current.style.transform=`translateY(${-top}px)`;if(snapLabel.current)snapLabel.current.style.top=`${top+55}px`;if(layerLabel.current)layerLabel.current.style.left=`${left+12}px`;};
 useLayoutEffect(placeLabels);
 const [addingLayer,setAddingLayer]=useState(false),[layerNotice,setLayerNotice]=useState(''),layerMenu=useRef<HTMLDivElement>(null),addLayerButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>{setAddingLayer(false);setLayerNotice('');},[p.id]);
 useEffect(()=>{if(!addingLayer)return;layerMenu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();const close=(event:PointerEvent)=>{if(!layerMenu.current?.contains(event.target as Node))setAddingLayer(false);};window.addEventListener('pointerdown',close);return()=>window.removeEventListener('pointerdown',close);},[addingLayer]);
 const addLayer=(kind:LayerKind)=>{setAddingLayer(false);setLayerNotice('');try{change(project=>{addTimelineLayer(project,kind);});}catch(error){setLayerNotice((error as Error).message);}addLayerButton.current?.focus();};
 const [sceneMenu,setSceneMenu]=useState<string|null>(null),[sceneDrop,setSceneDrop]=useState<{id:string;after:boolean}|null>(null),sceneDrag=useRef<{id:string;projectId:string;snapshot:string}|null>(null),sceneMenuRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{sceneDrag.current=null;setSceneDrop(null);setSceneMenu(null);},[p.id]);
 useEffect(()=>{if(!sceneMenu)return;sceneMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();const close=(event:PointerEvent)=>{if(!sceneMenuRef.current?.contains(event.target as Node))setSceneMenu(null);};window.addEventListener('pointerdown',close);return()=>window.removeEventListener('pointerdown',close);},[sceneMenu]);
 const moveScene=(id:string,beforeId?:string,snapshot?:string)=>{setLayerNotice('');const order=p.scenes.map(scene=>scene.id),from=order.indexOf(id),target=beforeId===undefined?order.length:order.indexOf(beforeId);if(from<0||target<0||from===target||from+1===target)return;try{change(project=>{if(snapshot&&sceneDragFingerprint(project)!==snapshot)throw Error('The timeline changed during this drag. Try moving the scene again.');moveRecordingScene(project,id,beforeId);});}catch(error){setLayerNotice((error as Error).message);}};
 const finishSceneDrop=(event:React.DragEvent,id?:string)=>{event.preventDefault();event.stopPropagation();const drag=sceneDrag.current;sceneDrag.current=null;setSceneDrop(null);if(!drag||drag.projectId!==p.id||event.dataTransfer.getData('application/sceneforge-scene')!==drag.id)return;let beforeId=id;if(id){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX>=rect.left+rect.width/2)beforeId=p.scenes[p.scenes.findIndex(scene=>scene.id===id)+1]?.id;}moveScene(drag.id,beforeId,drag.snapshot);};
 const mediaById=useMemo(()=>new Map(p.media.map(m=>[m.id,m])),[p.media]),mediaKeys=useMemo(()=>new Map(p.media.map(m=>[m.id,waveformMediaKey(m)])),[p.media]);
 const layers=useMemo(()=>timelineRows(p),[p]),customLayers=useMemo(()=>new Set(p.timelineLayers?.map(row=>row.id)),[p.timelineLayers]);
 const tracks:DisplayRow[]=useMemo(()=>[...layers.map(layer=>({id:layer.id,name:layer.name,icon:layer.track?trackIcons[layer.track]:layer.kind==='video'?Layers:Music,layer})),{id:'elements',name:'Elements',icon:Type},{id:'captions',name:'Captions',icon:Type},{id:'zooms',name:'Zoom',icon:ZoomIn}],[layers]);
 const clipsByTrack=useMemo(()=>{const map=new Map<string,Clip[]>();for(const c of p.clips){const id=clipLayerRowId(c,p);if(!map.has(id))map.set(id,[]);map.get(id)!.push(c);}return map;},[p]);
 const effectRows=useMemo(()=>({elements:p.elements.map(e=>({id:e.id,start:e.start,duration:e.duration,name:e.text||e.type})),zooms:p.zooms.map(z=>({id:z.id,start:z.start,duration:z.duration,name:`${z.target} · ${z.scale}×` })),captions:p.captions.map(c=>({id:c.id,start:c.start,duration:c.end-c.start,name:c.text}))}),[p.elements,p.zooms,p.captions]);
 const [marquee,setMarquee]=useState<SelectionRect|null>(null),gestureCleanup=useRef<(()=>void)|null>(null);
 useEffect(()=>()=>gestureCleanup.current?.(),[]);
 // Gestures close over clips and layers, so only their replacement cancels one; an autosave stamp must not.
 useEffect(()=>{gestureCleanup.current?.();},[p.id,p.clips,p.timelineLayers,p.settings,zoom]);
 const lastScrub=useRef(0),blade=useRef<HTMLDivElement>(null),bladeAt=useRef<number|null>(null);
 const scale=zoom,duration=useMemo(()=>projectDuration(p),[p]),extent=Math.max(30,duration+10),width=extent*scale;
 const placeBlade=()=>{const el=blade.current;if(!el)return;const at=bladeAt.current;el.hidden=at===null;if(at!==null)el.style.transform=`translateX(${at*scale}px)`;};
 useLayoutEffect(placeBlade,[scale,tool]);
 useEffect(()=>{const el=ref.current;if(!el)return;const ro=new ResizeObserver(()=>view(scrollPos.current.left,el.clientWidth));ro.observe(el);return()=>ro.disconnect();},[]);
 const start=win.left/scale,end=win.right/scale,step=scale>100?1:scale>35?5:10;
 const [waveforms,setWaveforms]=useState<Record<string,readonly number[]>>({});
 const visibleAudio=useMemo(()=>{const ids=new Set(p.clips.filter(c=>c.start+clipDuration(c)>=start&&c.start<=end).map(c=>c.mediaId));return p.media.filter(m=>ids.has(m.id)&&hasWaveform(m));},[p.clips,p.media,start,end]);
 const waveformKeys=useMemo(()=>visibleAudio.map(waveformMediaKey).sort().join('|'),[visibleAudio]);
 // Departed sources are dropped and cached peaks delivered in one update, so peaks that stay visible keep their identity.
 useEffect(()=>{let current=true,initial:Record<string,readonly number[]>|null={};const keep=new Set(showWaveforms?visibleAudio.map(waveformMediaKey):[]);const releases=showWaveforms?visibleAudio.map(media=>{const key=waveformMediaKey(media);return timelineWaveformCache.subscribe(media,peaks=>{if(!current)return;if(initial)initial[key]=peaks;else setWaveforms(previous=>previous[key]===peaks?previous:{...previous,[key]:peaks});});}):[];const delivered=initial;initial=null;setWaveforms(previous=>{const next:Record<string,readonly number[]>={};let same=true;for(const key in previous)if(keep.has(key))next[key]=previous[key];else same=false;for(const key in delivered)if(next[key]!==delivered[key]){next[key]=delivered[key];same=false;}return same?previous:next;});return()=>{current=false;releases.forEach(release=>release());};},[waveformKeys,showWaveforms]);
 const ruler=useMemo(()=>Array.from({length:Math.ceil((end-start)/step)+2},(_,i)=>Math.floor(start/step)*step+i*step).filter(n=>n<=extent).map(n=><span key={n} style={{left:n*scale}}>{timecode(n)}</span>),[start,end,step,extent,scale]);
 function pointerTime(e:React.PointerEvent){const rect=e.currentTarget.getBoundingClientRect();return Math.max(0,Math.min(extent,(e.clientX-rect.left)/scale));}
 function beginSelection(e:React.PointerEvent,rangeOnly=false){
  if(e.button!==0)return;if(tool==='blade'&&!rangeOnly){onSeek(pointerTime(e));return;}e.preventDefault();gestureCleanup.current?.();
  const content=ref.current?.firstElementChild as HTMLElement|null,scroll=ref.current;if(!content||!scroll)return;
  const position=(clientX:number,clientY:number)=>{const r=content.getBoundingClientRect();return {x:Math.max(0,Math.min(width,clientX-r.left)),y:Math.max(0,Math.min(content.scrollHeight,clientY-r.top))};};
  const origin=position(e.clientX,e.clientY),base=e.shiftKey&&!rangeOnly?[...selectedIds]:[];let last={x:e.clientX,y:e.clientY},moved=false,box=rectangleBetween(origin,origin),frame=0;
  const rows=new Map(Array.from(content.querySelectorAll<HTMLElement>('.timeline-row')).map(row=>[row.dataset.track!,{y:row.offsetTop,height:row.offsetHeight}]));
  const items:SelectionItem[]=[];const add=(id:string,start:number,duration:number,track:string)=>{const row=rows.get(track);if(row)items.push({id,x:start*scale,y:row.y+2,width:Math.max(8,duration*scale),height:Math.max(1,row.height-4)});};
  p.clips.forEach(c=>add(c.id,c.start,clipDuration(c),clipLayerRowId(c,p)));p.elements.forEach(v=>add(v.id,v.start,v.duration,'elements'));p.captions.forEach(v=>add(v.id,v.start,v.end-v.start,'captions'));p.zooms.forEach(v=>add(v.id,v.start,v.duration,'zooms'));
  const update=()=>{const point=position(last.x,last.y);box=rectangleBetween(origin,point);moved ||= box.width>4||box.height>4;if(moved)setMarquee(rangeOnly?{x:box.x,y:0,width:box.width,height:content.scrollHeight}:box);};
  const move=(ev:PointerEvent)=>{last={x:ev.clientX,y:ev.clientY};update();};
  const clean=()=>{cancelAnimationFrame(frame);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',key);setMarquee(null);gestureCleanup.current=null;};
  const up=()=>{if(moved){if(rangeOnly)onRange(orderedTimeRange(origin.x/scale,position(last.x,last.y).x/scale,projectDuration(p)));else onSelectMany(itemsInRectangle(box,items,base));}else if(!rangeOnly){onSeek(origin.x/scale);if(!e.shiftKey)onSelectMany([]);}clean();};
  const cancel=()=>clean(),key=(ev:KeyboardEvent)=>{if(ev.key==='Escape'){ev.preventDefault();clean();}};
  const scrollFrame=()=>{const bounds=scroll.getBoundingClientRect(),dx=last.x<bounds.left+24?-Math.min(20,(bounds.left+24-last.x)/2):last.x>bounds.right-24?Math.min(20,(last.x-bounds.right+24)/2):0;if(dx&&moved){scroll.scrollLeft+=dx;update();}frame=requestAnimationFrame(scrollFrame);};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',key);frame=requestAnimationFrame(scrollFrame);gestureCleanup.current=clean;
 }
 function begin(e:React.PointerEvent,c:Clip,mode:'move'|'left'|'right'){
  if(e.button!==0)return;e.stopPropagation();e.preventDefault();
  const scroll=ref.current,content=scroll?.firstElementChild as HTMLElement|null;if(!scroll||!content)return;
  if(tool==='blade'){onSplit(c.id,(e.clientX-scroll.getBoundingClientRect().left+scroll.scrollLeft)/scale);return;}
  if(e.shiftKey){onSelect(c.id,true);return;}
  gestureCleanup.current?.();if(!selectedIds.has(c.id))onSelect(c.id);
  const ids=mode==='move'&&selectedIds.has(c.id)?new Set(p.clips.filter(item=>selectedIds.has(item.id)).map(item=>item.id)):new Set([c.id]);
  const moving=p.clips.filter(clip=>ids.has(clip.id)),spans=moving.map(clip=>({id:clip.id,start:clip.start,duration:clipDuration(clip)}));
  const targets=snapTargets([...p.clips.map(clip=>({id:clip.id,start:clip.start,duration:clipDuration(clip)})),...p.elements.map(item=>({id:item.id,start:item.start,duration:item.duration})),...p.captions.map(item=>({id:item.id,start:item.start,duration:item.end-item.start})),...p.zooms.map(item=>({id:item.id,start:item.start,duration:item.duration}))],ids,playhead.get(),p.scenes.flatMap(scene=>[scene.start,scene.start+scene.duration]));
  const measured=Array.from(content.querySelectorAll<HTMLElement>('.timeline-row[data-layer-kind]')).map(row=>({id:row.dataset.track!,kind:row.dataset.layerKind as 'video'|'audio',top:row.offsetTop,bottom:row.offsetTop+row.offsetHeight}));
  const sourceRow=measured.find(row=>row.id===clipLayerRowId(c,p))!,kind=clipLayerKind(c),initial={x:e.clientX,y:e.clientY,left:scroll.scrollLeft,top:scroll.scrollTop};
  let last={x:e.clientX,y:e.clientY},pending={start:c.start,sourceIn:c.sourceIn,sourceOut:c.sourceOut},delta=0,drop:LayerDrop|null=null,moved=false,frame=0,closed=false,shown='';
  // Pointer moves that leave the preview unchanged, e.g. while snapped, skip the render.
  const show=(next:DragPreview,key:string)=>{if(key===shown)return;shown=key;setDrag(next);};
  const update=()=>{
   const dx=last.x-initial.x+scroll.scrollLeft-initial.left,dy=last.y-initial.y+scroll.scrollTop-initial.top;
   moved ||= Math.abs(dx)>=4||Math.abs(dy)>=4;if(!moved)return;
   const raw=timelinePointerDelta(initial.x,last.x,initial.left,scroll.scrollLeft,scale),thresholdPx=snapDistancePixels(scroll.clientWidth);
   let guide:number|null=null,shiftY=0,dropTop:number|null=null,dropHeight=0,label='';drop=null;
   if(mode==='move'){
    const vertical=isVerticalLayerDrag(dx,dy),snap=vertical?{delta:0,guide:null}:groupMove(spans,raw,targets,scale,p.settings.snap,thresholdPx);delta=snap.delta;guide=snap.guide?.time??null;
    if(Math.abs(dy)>=12){
     const bounds=scroll.getBoundingClientRect();if(last.y>=bounds.top+53&&last.y<=bounds.bottom&&last.x>=bounds.left&&last.x<=bounds.right){
      drop=hitLayerDrop(last.y-content.getBoundingClientRect().top,kind,measured);
      if(drop?.kind==='existing'){
       const destination=measured.find(row=>row.id===(drop as {rowId:string}).rowId)!;
       if(destination.id===sourceRow.id)drop=null;else{shiftY=destination.top-sourceRow.top;dropTop=destination.top;dropHeight=destination.bottom-destination.top;label=`Move to ${layers.find(row=>row.id===destination.id)?.name}`;}
      }else if(drop){
       const before=layers.find(row=>row.id===(drop as {beforeId:string|null}).beforeId),after=layers.find(row=>row.id===(drop as {afterId:string|null}).afterId);
       // Equal legacy z-orders cannot accept a strictly intermediate layer without changing old clips.
       if(before&&after&&after.order<=before.order)drop=null;
       else{dropTop=drop.beforeId?measured.find(row=>row.id===(drop as {beforeId:string}).beforeId)!.top:measured.find(row=>row.id===(drop as {afterId:string}).afterId)!.bottom;shiftY=dropTop-(sourceRow.top+sourceRow.bottom)/2;label=`New ${kind} layer`;}
      }
     }
    }
    const previews=new Map(moving.map(clip=>[clip.id,{start:clip.start+delta,duration:clipDuration(clip),dy:clipLayerKind(clip)===kind?shiftY:0,sourceIn:clip.sourceIn,sourceOut:clip.sourceOut}]));
    label=vertical&&drop?`${label} · time unchanged`:label;
    show({clips:previews,guide,drop,dropTop,dropHeight,label},JSON.stringify([delta,shiftY,guide,drop,dropTop,dropHeight,label]));
   }else{
    const duration=clipDuration(c),media=mediaById.get(c.mediaId),min=mode==='left'?Math.max(-c.start,-c.sourceIn/c.speed):Math.min(0,.1-duration),max=mode==='left'?Math.max(0,duration-.1):Math.max(0,((media?.duration||3600)-c.sourceOut)/c.speed);
    const snap=snapTimelineDelta({delta:raw,anchors:[mode==='left'?c.start:c.start+duration],targets,scale,minDelta:min,maxDelta:max,enabled:p.settings.snap,thresholdPx});guide=snap.guide?.time??null;
    pending=mode==='left'?trimClipLeft(c,snap.delta):{...pending,sourceOut:c.sourceOut+snap.delta*c.speed};
    show({clips:new Map([[c.id,{start:pending.start,duration:(pending.sourceOut-pending.sourceIn)/c.speed,dy:0,sourceIn:pending.sourceIn,sourceOut:pending.sourceOut}]]),guide,drop:null,dropTop:null,dropHeight:0,label:''},JSON.stringify([pending.start,pending.sourceIn,pending.sourceOut,guide]));
   }
  };
  const move=(event:PointerEvent)=>{if(event.pointerId!==e.pointerId)return;last={x:event.clientX,y:event.clientY};update();};
  const clean=()=>{if(closed)return;closed=true;cancelAnimationFrame(frame);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',key);window.removeEventListener('blur',cancel);setDrag(null);gestureCleanup.current=null;};
  const cancel=()=>clean(),key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();clean();}};
  const up=(event:PointerEvent)=>{
   if(event.pointerId!==e.pointerId)return;last={x:event.clientX,y:event.clientY};update();clean();
   if(!moved||mode==='move'&&!drop&&delta===0||mode!=='move'&&pending.start===c.start&&pending.sourceIn===c.sourceIn&&pending.sourceOut===c.sourceOut)return;
   change(project=>{
    // A remote edit arriving in the release event must not be overwritten by the stale gesture.
    if(moving.some(before=>JSON.stringify(project.clips.find(item=>item.id===before.id))!==JSON.stringify(before)))return;
    if(mode==='move'){for(const clip of project.clips)if(ids.has(clip.id))clip.start+=delta;if(drop)moveClipsToLayer(project,ids,c.id,drop);}
    else{const clip=project.clips.find(item=>item.id===c.id);if(clip)Object.assign(clip,pending);}
   });
  };
  const scrollFrame=()=>{if(closed)return;const bounds=scroll.getBoundingClientRect(),edge=24;let sx=0,sy=0;if(moved){sx=last.x<bounds.left+edge?-Math.min(16,(bounds.left+edge-last.x)/2):last.x>bounds.right-edge?Math.min(16,(last.x-bounds.right+edge)/2):0;sy=last.y<bounds.top+53+edge?-Math.min(12,(bounds.top+53+edge-last.y)/2):last.y>bounds.bottom-edge?Math.min(12,(last.y-bounds.bottom+edge)/2):0;const previousLeft=scroll.scrollLeft,previousTop=scroll.scrollTop;scroll.scrollLeft+=sx;scroll.scrollTop+=sy;if(previousLeft!==scroll.scrollLeft||previousTop!==scroll.scrollTop)update();}frame=requestAnimationFrame(scrollFrame);};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',key);window.addEventListener('blur',cancel);gestureCleanup.current=clean;frame=requestAnimationFrame(scrollFrame);
 }
 const beginRef=useRef<BeginClip>(begin);beginRef.current=begin;
 const beginClip=useCallback<BeginClip>((e,c,mode)=>beginRef.current(e,c,mode),[]);
 // Wheel zoom accumulates per frame from the latest requested zoom, so a fast pinch loses no deltas; the listener stays attached.
 const zoomTarget=useRef(zoom),zoomHandler=useRef(onZoom);zoomHandler.current=onZoom;
 useLayoutEffect(()=>{zoomTarget.current=zoom;},[zoom]);
 useEffect(()=>{const el=ref.current;if(!el)return;let overrides=loadShortcutOverrides(),pending=0,frame=0;const reload=()=>{overrides=loadShortcutOverrides();};const apply=()=>{frame=0;const next=Math.max(8,Math.min(200,zoomTarget.current*Math.exp(-pending*.005)));pending=0;if(next!==zoomTarget.current){zoomTarget.current=next;zoomHandler.current(next);}};const wheel=(event:WheelEvent)=>{const result=resolveShortcut(event,{scope:'edit',surface:'timeline',availableActions:['timelineScroll','timelineZoom']},overrides);if(!result)return;event.preventDefault();if(result.id==='timelineScroll')el.scrollLeft+=event.deltaY||event.deltaX;else{pending+=event.deltaY;frame||=requestAnimationFrame(apply);}};el.addEventListener('wheel',wheel,{passive:false});window.addEventListener('sceneforge-shortcuts-changed',reload);window.addEventListener('storage',reload);return()=>{cancelAnimationFrame(frame);el.removeEventListener('wheel',wheel);window.removeEventListener('sceneforge-shortcuts-changed',reload);window.removeEventListener('storage',reload);};},[]);
 return <div className={`timeline tool-${tool} ${drag?'timeline-dragging':''}`}><div className="timeline-layer-toolbar" onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();setAddingLayer(false);addLayerButton.current?.focus();}}}><div className="timeline-add-layer" ref={layerMenu}><button type="button" className="timeline-add-layer-button" ref={addLayerButton} aria-haspopup="menu" aria-expanded={addingLayer} disabled={(p.timelineLayers?.length??0)>=2000} onClick={()=>setAddingLayer(value=>!value)}><Plus size={14}/>Add layer<ChevronDown size={12}/></button>{addingLayer&&<div role="menu" aria-label="Add timeline layer" className="timeline-add-layer-menu" onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}}}><button type="button" role="menuitem" onClick={()=>addLayer('video')}><Layers size={14}/>Video layer</button><button type="button" role="menuitem" onClick={()=>addLayer('audio')}><Music size={14}/>Audio layer</button></div>}</div>{onToggleWaveforms&&<button type="button" className="timeline-waveform-toggle" aria-pressed={showWaveforms} onClick={onToggleWaveforms} title="Show or hide source audio waveforms (E)"><Music size={13}/>Waveforms</button>}<span role="status">{layerNotice||'Drag clips between rows to arrange layers'}</span></div><div className="track-labels"><div ref={trackLabels}><div className="ruler-label"><GripVertical size={14}/>TRACKS</div>{tracks.map(t=><div className="track-label" key={t.id}><t.icon size={14}/><span>{t.name}</span><span className="track-count">{t.id==='captions'?p.captions.length:t.id==='zooms'?p.zooms.length:t.id==='elements'?p.elements.length:(clipsByTrack.get(t.id)?.length||0)||'—'}</span></div>)}</div></div>
 <div className="timeline-scroll" ref={ref} onScroll={e=>{const el=e.currentTarget;scrollPos.current={left:el.scrollLeft,top:el.scrollTop};placeLabels();view(scrollPos.current.left,winRef.current.width);}}><div className="timeline-content" style={{width}} onPointerMove={e=>{if(e.buttons||tool!=='blade'&&!scrubbing)return;const at=pointerTime(e);if(tool==='blade'){bladeAt.current=at;placeBlade();}if(scrubbing&&performance.now()-lastScrub.current>45){lastScrub.current=performance.now();onSeek(at);}}} onPointerLeave={()=>{bladeAt.current=null;placeBlade();}}>
  <div className="time-ruler" title="Click to seek. Shift-drag to select a time range." onPointerDown={e=>{if(e.shiftKey){beginSelection(e,true);return;}onSeek(pointerTime(e));const rect=e.currentTarget.getBoundingClientRect();const move=(ev:PointerEvent)=>onSeek(Math.max(0,Math.min(extent,(ev.clientX-rect.left)/scale)));const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);}}>{ruler}</div>
  <div className="scene-markers" onDragOver={event=>{if(sceneDrag.current){event.preventDefault();event.dataTransfer.dropEffect='move';setSceneDrop({id:'end',after:true});}}} onDrop={event=>finishSceneDrop(event)}>{p.scenes.map((s,i)=>{const stop=p.scenes[i+1]?.start??Math.max(s.start+s.duration,duration);if(s.start>end||stop<start)return null;return <div key={s.id} data-scene-id={s.id} className={`timeline-scene ${sceneDrop?.id===s.id?(sceneDrop.after?'scene-drop-after':'scene-drop-before'):''}`} style={{left:s.start*scale,width:Math.max(34,(stop-s.start)*scale)}} draggable onDragStart={event=>{if((event.target as HTMLElement).closest('[role="menu"],.timeline-scene-actions')){event.preventDefault();return;}sceneDrag.current={id:s.id,projectId:p.id,snapshot:sceneDragFingerprint(p)};setSceneMenu(null);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/sceneforge-scene',s.id);}} onDragEnd={()=>{sceneDrag.current=null;setSceneDrop(null);}} onDragOver={event=>{if(!sceneDrag.current)return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';const rect=event.currentTarget.getBoundingClientRect();setSceneDrop({id:s.id,after:event.clientX>=rect.left+rect.width/2});}} onDrop={event=>finishSceneDrop(event,s.id)} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){sceneDrag.current=null;setSceneDrop(null);setSceneMenu(null);return;}if(event.altKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){event.preventDefault();if(event.key==='ArrowLeft'&&i>0)moveScene(s.id,p.scenes[i-1].id);else if(event.key==='ArrowRight'&&i<p.scenes.length-1)moveScene(s.id,p.scenes[i+2]?.id);}}}>
    <button type="button" className="timeline-scene-title" title={`${s.name} · drag to reorder; Option+Left/Right moves one scene`} aria-label={`Scene ${i+1}: ${s.name}. Drag to reorder`} onClick={()=>onSeek(s.start)}><span>{i+1}</span><b>{s.name}</b></button>
    {onSceneAction&&<button type="button" className="timeline-scene-actions" draggable={false} aria-label={`Actions for ${s.name}`} aria-haspopup="menu" aria-expanded={sceneMenu===s.id} onClick={()=>setSceneMenu(sceneMenu===s.id?null:s.id)}><ChevronDown size={12}/></button>}
    {sceneMenu===s.id&&<div className="timeline-scene-menu" ref={sceneMenuRef} role="menu" aria-label={`${s.name} actions`} draggable={false} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const items=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')],index=items.indexOf(document.activeElement as HTMLButtonElement);items[(index+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}}}><button type="button" role="menuitem" onClick={()=>{setSceneMenu(null);onSceneAction?.(s.id,'auto-cut');}}>Auto-cut scene</button><button type="button" role="menuitem" onClick={()=>{setSceneMenu(null);onSceneAction?.(s.id,'visualize');}}>Visualize scene</button></div>}
   </div>;})}{sceneDrop?.id==='end'&&<div className="timeline-scene-end-drop" style={{left:duration*scale}}/>}</div>
  {tracks.map(t=>{const effects=t.id==='elements'?effectRows.elements:t.id==='zooms'?effectRows.zooms:t.id==='captions'?effectRows.captions:null;return <div className={`timeline-row row-${t.layer?.track??t.id} ${customLayers.has(t.id)?'has-layer-controls':''} ${drag?.drop?.kind==='existing'&&drag.drop.rowId===t.id?'layer-drop-target':''}`} key={t.id} data-track={t.id} data-layer-kind={t.layer?.kind} data-label={t.name} onPointerDown={e=>{if(e.target===e.currentTarget)beginSelection(e);}} onDragOver={e=>{if(t.layer)e.preventDefault();}} onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('application/sceneforge-media'),media=mediaById.get(id);if(media&&t.layer&&(media.kind==='audio'?'audio':'video')===t.layer.kind){onDropMedia(id,t.layer.track??(t.layer.kind==='audio'?'audio':'screen'),Math.max(0,(e.clientX-e.currentTarget.getBoundingClientRect().left)/scale),t.id);}}}>
   {t.layer&&customLayers.has(t.id)&&<LayerRowControls row={t.layer} change={change}/>}
   {t.layer&&<span className="layer-drop-edge" aria-hidden="true"/>}
   {(clipsByTrack.get(t.id)||[]).map(c=>{const preview=drag?.clips.get(c.id),left=preview?.start??c.start,right=left+(preview?.duration??clipDuration(c));if(!preview&&(c.start+clipDuration(c)<start||c.start>end))return null;const media=mediaById.get(c.mediaId);return <TimelineClip key={c.id} clip={c} media={media} preview={preview} selected={selectedIds.has(c.id)||selected===c.id} peaks={showWaveforms&&media?waveforms[mediaKeys.get(media.id)!]:undefined} scale={scale} from={Math.max(start,left)} to={Math.min(end,right)} onBegin={beginClip}/>;})}
   {effects?.filter(e=>e.start+e.duration>=start&&e.start<=end).map(e=><button key={e.id} className={`timeline-effect ${selectedIds.has(e.id)||selected===e.id?'selected':''}`} style={{left:e.start*scale,width:Math.max(8,e.duration*scale)}} onClick={()=>{onSelect(e.id);onSeek(e.start);}}>{e.name}</button>)}
  </div>;})}
  {drag?.dropTop!==null&&drag?.dropTop!==undefined&&<div className={`timeline-layer-guide ${drag.drop?.kind==='new'?'new-layer-guide':'existing-layer-guide'}`} style={{top:drag.dropTop,height:drag.dropHeight||undefined}}><span ref={layerLabel}>{drag.label}</span></div>}
  {drag?.guide!==null&&drag?.guide!==undefined&&<div className="timeline-snap-guide" data-snap-time={drag.guide} style={{left:drag.guide*scale}}><span ref={snapLabel}>{timecode(drag.guide)}</span></div>}
  <div className="timeline-drag-announcement" role="status" aria-live="polite">{drag?.label??''}</div>
  {selectedRange&&<div className="timeline-selected-range" aria-label="Selected time range" style={{left:selectedRange.start*scale,width:(selectedRange.end-selectedRange.start)*scale}}/>}
  {marquee&&<div className="timeline-marquee" style={{left:marquee.x,top:marquee.y,width:marquee.width,height:marquee.height}}/>}
  {tool==='blade'&&<div className="blade-guide" ref={blade} hidden/>}
  <TimelinePlayhead playhead={playhead} scale={scale} scroll={ref}/>
 </div></div></div>;
});
