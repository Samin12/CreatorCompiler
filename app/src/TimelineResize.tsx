import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {clampTimelineHeight,DEFAULT_TIMELINE_HEIGHT,parseTimelineHeight,TIMELINE_HEIGHT_KEY,timelineHeightBounds,type TimelineHeightBounds} from './timeline-resize';
import './timeline-resize.css';

interface Drag {pointerId:number;y:number;height:number;preference:number;cursor:string;userSelect:string;}
export function TimelineResize(){
 const node=useRef<HTMLDivElement>(null),container=useRef<HTMLElement|null>(null),bounds=useRef<TimelineHeightBounds>({min:0,max:10000});
 const preference=useRef(DEFAULT_TIMELINE_HEIGHT),height=useRef(DEFAULT_TIMELINE_HEIGHT),drag=useRef<Drag|null>(null),frame=useRef(0),queued=useRef<number|null>(null);
 const [state,setState]=useState({height:DEFAULT_TIMELINE_HEIGHT,min:0,max:10000,dragging:false});
 const apply=(value:number)=>{const next=clampTimelineHeight(value,bounds.current);height.current=next;container.current?.style.setProperty('--timeline-height',`${next}px`);setState({height:next,...bounds.current,dragging:!!drag.current});};
 const clearFrame=()=>{if(frame.current)cancelAnimationFrame(frame.current);frame.current=0;queued.current=null;};
 const persist=(value:number)=>{preference.current=value;try{localStorage.setItem(TIMELINE_HEIGHT_KEY,String(value));}catch{/* A blocked preference store must not prevent resizing. */}};
 const restoreCursor=(value:Drag)=>{document.body.style.cursor=value.cursor;document.body.style.userSelect=value.userSelect;};
 const finish=(commit:boolean,value?:number)=>{const active=drag.current;if(!active)return;clearFrame();drag.current=null;restoreCursor(active);const next=commit?clampTimelineHeight(value??height.current,bounds.current):active.preference;if(commit)persist(next);else preference.current=active.preference;apply(next);try{if(node.current?.hasPointerCapture(active.pointerId))node.current.releasePointerCapture(active.pointerId);}catch{/* Capture may already have ended when a window closes. */}};
 useLayoutEffect(()=>{
  const target=node.current?.closest<HTMLElement>('.edit-workspace');if(!target)return;container.current=target;
  try{preference.current=parseTimelineHeight(localStorage.getItem(TIMELINE_HEIGHT_KEY));}catch{preference.current=DEFAULT_TIMELINE_HEIGHT;}
  const resize=()=>{bounds.current=timelineHeightBounds(target.clientHeight);apply(drag.current?height.current:preference.current);};
  const observer=new ResizeObserver(resize);observer.observe(target);resize();
  return()=>{observer.disconnect();clearFrame();const active=drag.current;if(active){drag.current=null;restoreCursor(active);}target.style.removeProperty('--timeline-height');container.current=null;};
 },[]);
 useEffect(()=>{const cancel=()=>finish(false),key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&drag.current){event.preventDefault();event.stopPropagation();cancel();}};window.addEventListener('blur',cancel);window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('blur',cancel);window.removeEventListener('keydown',key,true);};},[]);
 const start=(event:ReactPointerEvent<HTMLDivElement>)=>{if(event.button!==0||!event.isPrimary||drag.current||!container.current)return;event.preventDefault();event.stopPropagation();event.currentTarget.focus();try{event.currentTarget.setPointerCapture(event.pointerId);}catch{return;}drag.current={pointerId:event.pointerId,y:event.clientY,height:height.current,preference:preference.current,cursor:document.body.style.cursor,userSelect:document.body.style.userSelect};document.body.style.cursor='row-resize';document.body.style.userSelect='none';setState(old=>({...old,dragging:true}));};
 const move=(event:ReactPointerEvent<HTMLDivElement>)=>{const active=drag.current;if(!active||active.pointerId!==event.pointerId)return;event.preventDefault();queued.current=active.height+active.y-event.clientY;if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;const next=queued.current;queued.current=null;if(next!==null&&drag.current)apply(next);});};
 return <div ref={node} className={`timeline-resizer ${state.dragging?'is-dragging':''}`} role="separator" aria-label="Timeline height" aria-orientation="horizontal" aria-valuemin={state.min} aria-valuemax={state.max} aria-valuenow={state.height} aria-valuetext={`${state.height} pixels tall`} tabIndex={0} title="Drag to resize timeline · Arrow keys resize · Double-click resets"
  onPointerDown={start} onPointerMove={move} onPointerUp={event=>{const active=drag.current;if(active?.pointerId===event.pointerId){event.preventDefault();event.stopPropagation();finish(true,active.height+active.y-event.clientY);}}} onPointerCancel={event=>{if(drag.current?.pointerId===event.pointerId)finish(false);}} onLostPointerCapture={event=>{if(drag.current?.pointerId===event.pointerId)finish(false);}}
  onDoubleClick={()=>{clearFrame();if(drag.current)finish(false);persist(DEFAULT_TIMELINE_HEIGHT);apply(preference.current);}}
  onKeyDown={event=>{if(drag.current)return;const step=event.shiftKey?50:20;let value:number;switch(event.key){case'ArrowUp':value=height.current+step;break;case'ArrowDown':value=height.current-step;break;case'PageUp':value=height.current+100;break;case'PageDown':value=height.current-100;break;case'Home':value=bounds.current.min;break;case'End':value=bounds.current.max;break;default:return;}event.preventDefault();event.stopPropagation();const next=clampTimelineHeight(value,bounds.current);persist(next);apply(next);}}><span aria-hidden="true"/></div>;
}
