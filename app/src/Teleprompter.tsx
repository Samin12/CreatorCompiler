import {useEffect,useRef,useState} from 'react';
import {X,Play,Pause,RotateCcw,Mic,FlipHorizontal} from './Icons';
import type {Project} from '../shared/types';
import {captureSpeech} from './voice-audio';
import {requestUserMedia} from './media-access';
import {resolveShortcut,loadShortcutOverrides,type ShortcutAction} from './shortcuts';
import {navigateScript} from './teleprompter-navigation';
import './recording.css';
type Mode='manual'|'constant'|'voice'|'follow';
const wordPattern=/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
export function Teleprompter({project,change,onClose}:{project:Project;change:(fn:(p:Project)=>void)=>void;onClose:()=>void}){
 const [running,setRunning]=useState(false),[mode,setMode]=useState<Mode>('constant'),[speaking,setSpeaking]=useState(false),[error,setError]=useState(''),[cursor,setCursor]=useState(0),[lastWords,setLastWords]=useState('');
 const area=useRef<HTMLDivElement>(null),voice=useRef(false),stream=useRef<MediaStream|null>(null),audio=useRef<AudioContext|null>(null),meterFrame=useRef(0),stopFollow=useRef<(()=>void)|null>(null),inference=useRef(false),cursorRef=useRef(0),runningRef=useRef(false),controller=useRef<AbortController|null>(null),access=useRef<AbortController|null>(null);
 runningRef.current=running;cursorRef.current=cursor;
 const {teleprompterFontSize:fontSize,teleprompterSpeed:speed,teleprompterMirror:mirror}=project.settings;
 const stopMic=()=>{access.current?.abort();access.current=null;cancelAnimationFrame(meterFrame.current);stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;void audio.current?.close().catch(()=>{});audio.current=null;voice.current=false;stopFollow.current?.();stopFollow.current=null;controller.current?.abort();inference.current=false;};
 useEffect(()=>()=>stopMic(),[]);
 useEffect(()=>{if(!running||mode==='manual'||mode==='follow')return;let frame=0,last=performance.now();const tick=(now:number)=>{if(area.current&&(mode==='constant'||voice.current))area.current.scrollTop+=Math.min(.1,(now-last)/1000)*speed;last=now;frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[running,mode,speed]);
 useEffect(()=>{if(!area.current)return;const target=area.current.querySelector<HTMLElement>(`[data-word="${Math.max(0,cursor-1)}"]`);if(target){const relative=target.getBoundingClientRect().top-area.current.getBoundingClientRect().top;area.current.scrollTo({top:area.current.scrollTop+relative-area.current.clientHeight*.35,behavior:'smooth'});}},[cursor]);
 useEffect(()=>{
  const actions:ShortcutAction[]=['previousSentence','nextSentence','previousWord','nextWord'];
  const handle=(action:ShortcutAction)=>{if(actions.includes(action))setCursor(value=>navigateScript(project.scenes.map(s=>s.script).join('\n\n'),value,action as 'previousSentence'|'nextSentence'|'previousWord'|'nextWord'));};
  const keydown=(event:KeyboardEvent)=>{const action=resolveShortcut(event,{scope:'recorder',modal:true,availableActions:actions},loadShortcutOverrides());if(action){event.preventDefault();handle(action.id);}};
  const dispatched=(event:Event)=>handle((event as CustomEvent<{action:ShortcutAction}>).detail?.action);
  window.addEventListener('keydown',keydown);window.addEventListener('sceneforge-shortcut',dispatched);return()=>{window.removeEventListener('keydown',keydown);window.removeEventListener('sceneforge-shortcut',dispatched);};
 },[project.scenes]);
 async function selectMode(value:Mode){
  stopMic();setMode(value);setSpeaking(false);setError('');
  if(value!=='follow'&&value!=='voice')return;
  const acquisition=new AbortController();access.current=acquisition;const signal=acquisition.signal;
  if(value==='follow'){
   try{const stop=await captureSpeech(wav=>{if(signal.aborted||!runningRef.current||inference.current)return;inference.current=true;const abort=new AbortController();controller.current=abort;
    void fetch(`/api/ai/voice-follow?projectId=${encodeURIComponent(project.id)}&cursor=${cursorRef.current}`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav,signal:abort.signal}).then(async r=>{const result=await r.json();if(!r.ok)throw new Error(result.error||'Local voice follow failed');if(signal.aborted)return;setCursor(result.cursor);setLastWords(result.transcript);setSpeaking(result.confidence>.4);}).catch(e=>{if(!signal.aborted&&e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!signal.aborted)inference.current=false;});
   },signal);if(signal.aborted)stop();else stopFollow.current=stop;}catch(e){if(!signal.aborted){stopMic();setError((e as Error).message);setMode('constant');}}return;
  }
  try{const s=await requestUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false},signal);if(signal.aborted){s.getTracks().forEach(track=>track.stop());return;}stream.current=s;const ctx=new AudioContext();audio.current=ctx;const a=ctx.createAnalyser();ctx.createMediaStreamSource(s).connect(a);a.fftSize=1024;const values=new Uint8Array(a.fftSize);let hold=0,last=0;const update=(time:number)=>{a.getByteTimeDomainData(values);const rms=Math.sqrt(values.reduce((sum,v)=>sum+(v-128)**2,0)/values.length)/128;if(rms>.02)hold=time+350;voice.current=time<hold;if(time-last>120){setSpeaking(voice.current);last=time;}meterFrame.current=requestAnimationFrame(update);};meterFrame.current=requestAnimationFrame(update);}catch(e){if(!signal.aborted){stopMic();setError((e as Error).message);setMode('constant');}}
 }
 let wordIndex=0;
 return <div className="teleprompter" role="dialog" aria-label="Teleprompter"><header><strong>SceneForge <span>Teleprompter</span></strong><button className="icon-button" aria-label="Close teleprompter" onClick={onClose}><X/></button></header><div className="teleprompter-focus"/><div ref={area} className="teleprompter-scroll" style={{fontSize,transform:mirror?'scaleX(-1)':undefined}}><div className="teleprompter-copy">{project.scenes.map(s=>{
 const text=s.script||'Add your script in the Script workspace.';let end=0;const nodes=[];for(const match of text.matchAll(wordPattern)){nodes.push(text.slice(end,match.index));const index=wordIndex++;nodes.push(<span key={index} data-word={index} className={mode==='follow'&&index===cursor-1?'spoken-word':''} onClick={()=>{if(mode==='follow')setCursor(index);}}>{match[0]}</span>);end=match.index+match[0].length;}nodes.push(text.slice(end));
 return <section key={s.id}><small>{s.name}</small><p>{nodes}</p></section>;
 })}</div></div><footer><button className="icon-button" title="Back to top" onClick={()=>{setCursor(0);if(area.current)area.current.scrollTop=0;}}><RotateCcw size={18}/></button><button className="button primary" onClick={()=>setRunning(v=>!v)}>{running?<Pause size={16}/>:<Play size={16}/>} {running?'Pause':'Start'}</button><select aria-label="Teleprompter mode" value={mode} onChange={e=>void selectMode(e.target.value as Mode)}><option value="manual">Manual</option><option value="constant">Constant speed</option><option value="voice">Voice paced · local</option><option value="follow">Follow my words · local AI</option></select><label>Speed <input aria-label="Teleprompter speed" type="range" min="5" max="140" value={speed} onChange={e=>change(p=>{p.settings.teleprompterSpeed=Number(e.target.value);})}/>{speed}</label><label>Text <input aria-label="Teleprompter text size" type="range" min="24" max="110" value={fontSize} onChange={e=>change(p=>{p.settings.teleprompterFontSize=Number(e.target.value);})}/></label><button className={`icon-button ${mirror?'active':''}`} title="Mirror text" onClick={()=>change(p=>{p.settings.teleprompterMirror=!mirror;})}><FlipHorizontal size={19}/></button>{['voice','follow'].includes(mode)&&<span><Mic size={13}/>{speaking?'Following':'Listening locally'}</span>}</footer>{error&&<p className="teleprompter-error">{error}</p>}{['voice','follow'].includes(mode)&&<small className="teleprompter-note">{mode==='follow'?lastWords||'Local word recognition in 3-second chunks. Click a word to move the starting point.':'Scrolls while you speak using local microphone activity. No audio is sent to a service.'}</small>}</div>;
}
