import {useEffect,useRef,useState} from 'react';
import type {CutReview} from '../shared/automation';
import {projectDuration} from '../shared/types';
import {createPlayhead,usePlayheadTime} from './playhead';
import {Stage} from './Stage';
import {Pause,Play} from './Icons';

export function CutPlayback({review}:{review:CutReview}){
 const [phase,setPhase]=useState<'before'|'after'>('after'),[joinId,setJoinId]=useState(review.joins[0]?.id??''),[playing,setPlaying]=useState(false),[playhead]=useState(()=>createPlayhead());
 const root=useRef<HTMLElement>(null);
 useEffect(()=>{root.current?.scrollIntoView({block:'nearest'});},[]);
 const join=review.joins.find(join=>join.id===joinId)??review.joins[0],project=review[phase],time=usePlayheadTime(playhead);
 const start=Math.max(0,(phase==='before'?join?.originalStart:join?.editedTime)??0);
 const from=Math.max(0,start-2),end=Math.min(projectDuration(project),((phase==='before'?join?.originalEnd:join?.editedTime)??0)+2);
 useEffect(()=>{setPlaying(false);playhead.set(from);},[phase,joinId,review,from,playhead]);
 useEffect(()=>{
  if(!playing)return;let frame=0,last=performance.now();const tick=(now:number)=>{const next=Math.min(end,playhead.get()+(now-last)/1000);last=now;playhead.set(next);if(next>=end)setPlaying(false);else frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[playing,end,playhead]);
 const toggle=()=>{if(time>=end)playhead.set(from);setPlaying(value=>!value);};
 if(!join)return <p className="hint">Select a cut to compare playback.</p>;
 return <section ref={root} className="cut-playback" aria-label="Cut playback comparison">
  <div className="cut-playback-heading"><label>Cut<select aria-label="Cut to review" value={joinId} onChange={event=>setJoinId(event.target.value)}>{review.joins.map(join=><option key={join.id} value={join.id}>{join.label}</option>)}</select></label><div className="comparison-switch" aria-label="Playback version">{(['before','after'] as const).map(value=><button className="button compact" key={value} aria-pressed={phase===value} onClick={()=>setPhase(value)}>{value==='before'?'Original':'Edited'}</button>)}</div></div>
  <div className="cut-playback-stage"><Stage project={project} playhead={playhead} playing={playing} playbackRate={1} onSelect={()=>{}} onImport={()=>{}}/></div>
  <div className="cut-playback-controls"><button className="button compact" disabled={end<=from} onClick={toggle}>{playing?<Pause size={14}/>:<Play size={14}/>} {playing?'Pause comparison':'Play comparison'}</button><input aria-label="Comparison playback position" type="range" min={from} max={Math.max(from,end)} step={.01} value={time} onChange={event=>{setPlaying(false);playhead.set(Number(event.target.value));}}/><span>{Math.max(0,time-from).toFixed(1)}s</span></div>
  <p className="hint">{phase==='before'?'Listen to the original passage, including the proposed removal.':'Listen across the join with the selected cuts applied.'} This preview does not change your project.</p>
 </section>;
}
