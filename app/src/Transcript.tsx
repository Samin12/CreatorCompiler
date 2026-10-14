import {memo,useEffect,useId,useMemo,useRef,useState,useSyncExternalStore,type KeyboardEvent} from 'react';
import type {Media,Project} from '../shared/types';
import {api} from './api';
import {LoaderCircle,Mic,Scissors,Sparkles} from './Icons';
import type {Playhead} from './playhead';
import {currentWordIndices,derivedSnapshot,sameIndices,sameTranscriptTiming,wordEndCeilings} from './editor-view';
import {selectedTranscriptRange,selectionIndices,sentenceSelection,transcriptWords,type TranscriptWord,type WordSelection} from './transcript-editing';
import './transcript.css';
type VoiceInfo={voiceId?:string;voiceName?:string;hasApiKey?:boolean;provider?:string};
type ListedVoice={id:string;name:string;category:string};
type Group={id:string;start:number;indices:number[]};
/** One caption sentence. It re-renders only when its own current words or selected span change. */
const TranscriptSentence=memo(function TranscriptSentence({group,words,current,selStart,selEnd}:{group:Group;words:TranscriptWord[];current:string;selStart:number;selEnd:number}){
 const live=current?current.split(',').map(Number):[];
 return <div className="transcript-sentence"><span className="transcript-stamp">{group.start.toFixed(2)}s</span><p>{group.indices.map(i=><span key={words[i].id} data-word-index={i} data-selected={i>=selStart&&i<=selEnd} className={`transcript-word ${live.includes(i)?'current':''} ${!words[i].timed?'untimed':''}`} title={`${words[i].start.toFixed(3)}–${words[i].end.toFixed(3)}s${!words[i].timed?' · Whole caption: word timing unavailable':''}`}>{words[i].text} </span>)}</p></div>;
});
export const Transcript=memo(function Transcript({project,playhead,onSeek,onDelete,onRewrite,onUndo,onRedo,onInsertSpeech}:{project:Project;playhead:Playhead;onSeek:(time:number)=>void;onDelete:(selection:WordSelection)=>void;onRewrite:(selection:WordSelection,text:string)=>void;onUndo:()=>void;onRedo:()=>void;onInsertSpeech:(text:string,at:number)=>Promise<void>}){
 // transcriptWords only reads captions, so unrelated edits keep the word list.
 const words=useMemo(()=>transcriptWords(project),[project.captions]),ceilings=useMemo(()=>wordEndCeilings(words),[words]),[selection,setSelection]=useState<WordSelection|null>(null),[draft,setDraft]=useState(''),[voice,setVoice]=useState<VoiceInfo>({}),[voices,setVoices]=useState<ListedVoice[]>([]),[busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[cloneOpen,setCloneOpen]=useState(false),[cloneName,setCloneName]=useState('My voice'),[sampleId,setSampleId]=useState(''),root=useRef<HTMLDivElement>(null),recorder=useRef<MediaRecorder|null>(null),dragging=useRef(false),helpId=useId();
 const timing=useRef({project,version:0});if(timing.current.project!==project){if(!sameTranscriptTiming(timing.current.project,project))timing.current.version++;timing.current.project=project;}
 useEffect(()=>{setSelection(null);dragging.current=false;},[timing.current.version]);
 const indices=selectionIndices(words,selection),range=useMemo(()=>selectedTranscriptRange(project,words,selection),[project,words,selection]);
 const groups=useMemo(()=>{const groups:Group[]=[],groupOf=new Int32Array(words.length);words.forEach((word,index)=>{let group=groups.at(-1);if(group?.id!==word.captionId){group={id:word.captionId,start:word.start,indices:[]};groups.push(group);}group!.indices.push(index);groupOf[index]=groups.length-1;});return {groups,groupOf};},[words]);
 const currentSnapshot=useMemo(()=>derivedSnapshot(playhead.get,time=>currentWordIndices(words,ceilings,time),sameIndices),[playhead,words,ceilings]),current=useSyncExternalStore(playhead.subscribe,currentSnapshot,currentSnapshot);
 const currentByGroup=new Map<number,string>();for(const i of current){const g=groups.groupOf[i],key=currentByGroup.get(g);currentByGroup.set(g,key?`${key},${i}`:String(i));}
 useEffect(()=>{setDraft(range?.text??'');},[range?.text,selection?.anchor,selection?.focus]);
 useEffect(()=>{const request=new AbortController();void api<VoiceInfo>('/ai/settings',undefined,'GET',request.signal).then(value=>{setVoice(value);if(value.voiceName)setCloneName(value.voiceName);}).catch(()=>{});return()=>{request.abort();recorder.current?.stop();};},[project.id]);
 const audible=project.media.filter((media:Media)=>media.kind!=='image'&&media.hasAudio!==false),selectionPane=useRef<HTMLDivElement>(null);
 useEffect(()=>{const node=selectionPane.current;if(!node)return;node.scrollTop=cloneOpen?node.scrollHeight:0;},[cloneOpen,voices.length,busy]);
 function remove(){if(!selection||!range)return;onDelete(selection);setSelection(null);setNotice('');root.current?.focus();}
 function applyWording(){if(!selection)return;try{onRewrite(selection,draft);setNotice('Wording updated. The footage is unchanged.');}catch(error){setNotice((error as Error).message);}}
 async function insert(){const text=draft.trim();if(!text){setNotice('Write the line to speak, or highlight words first.');return;}setBusy('speech');setNotice('');try{await onInsertSpeech(text,range?.start??playhead.get());setNotice('Inserted generated speech on the audio track.');}catch(error){setNotice((error as Error).message);}finally{setBusy('');}}
 async function loadVoices(){setBusy('voices');setNotice('');try{const result=await api<{voices:ListedVoice[]}>('/ai/voices');setVoices(result.voices);setCloneOpen(true);}catch(error){setNotice((error as Error).message);}finally{setBusy('');}}
 async function chooseVoice(id:string){const picked=voices.find(item=>item.id===id);if(!picked)return;setBusy('voice');try{const saved=await api<VoiceInfo>('/ai/settings',{voiceId:picked.id,voiceName:picked.name},'PUT');setVoice(saved);setNotice(`Speech will use ${picked.name}.`);}catch(error){setNotice((error as Error).message);}finally{setBusy('');}}
 async function cloneFromProject(){if(!sampleId){setNotice('Choose project audio that contains your voice.');return;}setBusy('clone');setNotice('');try{const saved=await api<VoiceInfo>('/ai/voices/clone',{name:cloneName,projectId:project.id,mediaId:sampleId});setVoice(current=>({...current,...saved,hasApiKey:true}));setNotice(`Cloned ${saved.voiceName}. New lines use this voice.`);}catch(error){setNotice((error as Error).message);}finally{setBusy('');}}
 async function recordSample(){if(recorder.current&&recorder.current.state==='recording'){recorder.current.stop();return;}
  setNotice('');try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const media=new MediaRecorder(stream);const chunks:Blob[]=[];media.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
   media.onstop=()=>{stream.getTracks().forEach(track=>track.stop());recorder.current=null;const blob=new Blob(chunks,{type:media.mimeType||'audio/webm'});const body=new FormData();body.append('name',cloneName.trim()||'My voice');body.append('file',blob,'sample.webm');setBusy('clone');void api<VoiceInfo>('/ai/voices/clone-sample',body).then(saved=>{setVoice(current=>({...current,...saved,hasApiKey:true}));setNotice(`Cloned ${saved.voiceName}. New lines use this voice.`);}).catch(error=>setNotice((error as Error).message)).finally(()=>setBusy(''));};
   recorder.current=media;media.start();setBusy('record');window.setTimeout(()=>{if(media.state==='recording')media.stop();},15000);
  }catch(error){setNotice((error as Error).message);}
 }
 function key(e:KeyboardEvent){if((e.target as HTMLElement).closest('button,input,textarea,select'))return;
  const command=e.metaKey||e.ctrlKey;
  if(command&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();e.shiftKey?onRedo():onUndo();return;}
  if(command&&e.key.toLowerCase()==='a'){e.preventDefault();e.stopPropagation();if(words.length)setSelection({anchor:0,focus:words.length-1});return;}
  if(e.key==='Escape'){setSelection(null);e.stopPropagation();return;}
  if((e.key==='Delete'||e.key==='Backspace')&&selection){e.preventDefault();e.stopPropagation();remove();return;}
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)&&words.length){e.preventDefault();e.stopPropagation();const direction=['ArrowLeft','ArrowUp'].includes(e.key)?-1:1;let next=e.key==='Home'?0:e.key==='End'?words.length-1:Math.max(0,Math.min(words.length-1,(selection?.focus??-direction)+direction));if(selection&&!e.shiftKey&&indices&&indices[0]!==indices[1]&&e.key.startsWith('Arrow'))next=direction<0?indices[0]:indices[1];setSelection({anchor:e.shiftKey?selection?.anchor??next:next,focus:next});onSeek(words[next].start);}
 }
 return <div className="transcript-editor" data-transcript-editor ref={root} tabIndex={0} role="region" aria-label="Editable transcript" aria-describedby={helpId} onKeyDown={key} onCopy={e=>{if(!range)return;e.clipboardData.setData('text/plain',range.text);e.preventDefault();}}>
  <div className="transcript-help" id={helpId}>Drag to highlight words. Edit the wording, delete the highlight from every track, or insert a spoken line.</div>
  <div className="transcript-word-list" onPointerDown={e=>{if(e.button!==0)return;const item=(e.target as HTMLElement).closest<HTMLElement>('[data-word-index]');if(!item)return;const index=Number(item.dataset.wordIndex);e.preventDefault();root.current?.focus();setSelection(old=>({anchor:e.shiftKey?old?.anchor??index:index,focus:index}));onSeek(words[index].start);dragging.current=true;e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!dragging.current)return;const item=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-word-index]');if(!item||!root.current?.contains(item))return;const index=Number(item.dataset.wordIndex);setSelection(old=>old?{...old,focus:index}:null);}} onPointerUp={e=>{dragging.current=false;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{dragging.current=false;}} onDoubleClick={e=>{const item=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-word-index]');if(item&&root.current?.contains(item))setSelection(sentenceSelection(words,Number(item.dataset.wordIndex)));}}>
   {words.length?groups.groups.map((group,g)=>{const first=group.indices[0],last=group.indices[group.indices.length-1],selected=Boolean(indices&&indices[0]<=last&&indices[1]>=first);return <TranscriptSentence key={`${group.id}-${first}`} group={group} words={words} current={currentByGroup.get(g)??''} selStart={selected?Math.max(indices![0],first):-1} selEnd={selected?Math.min(indices![1],last):-1}/>;}):<p className="transcript-empty">No captions yet. Write a line below and insert it, or transcribe the project audio.</p>}
  </div>
  <div className="transcript-selection" aria-live="polite" ref={selectionPane}>
   <label className="transcript-draft-label">{range?`${range.wordCount} ${range.wholeCaptions?'items':'words'} highlighted`:'Line to insert'}<textarea className="transcript-draft" rows={3} value={draft} aria-label={range?'Highlighted wording':'Line to speak'} onChange={event=>setDraft(event.target.value)}/></label>
   {range&&<span>{range.start.toFixed(2)}–{range.end.toFixed(2)}s. Delete removes this from every track.{range.wholeCaptions?' Untimed captions cut as a whole.':''}{range.limited?' Overlapping timing limits this cut.':''}</span>}
   <div className="transcript-actions">
    <button className="button compact" disabled={!selection||!draft.trim()} onClick={applyWording}>Apply wording</button>
    <button className="button danger compact" disabled={!selection||!range} onClick={remove}><Scissors size={14}/>Delete</button>
    <button className="button primary compact" disabled={!!busy||!draft.trim()} onClick={()=>void insert()}>{busy==='speech'?<LoaderCircle size={14} className="spin"/>:<Sparkles size={14}/>}Insert speech</button>
   </div>
   <div className="transcript-voice"><span>Voice: {voice.voiceName||'not chosen'}</span><button className="button compact" disabled={!!busy} onClick={()=>cloneOpen?setCloneOpen(false):void loadVoices()}>{busy==='voices'?<LoaderCircle size={13} className="spin"/>:null}{cloneOpen?'Hide voice':'Choose or clone'}</button></div>
   {cloneOpen&&<div className="transcript-clone">
    <label>Voice name<input value={cloneName} onChange={event=>setCloneName(event.target.value)}/></label>
    {!!voices.length&&<label>Saved voices<select aria-label="Saved voices" value={voice.voiceId||''} onChange={event=>void chooseVoice(event.target.value)}><option value="">Choose a voice</option>{voices.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <label>Project audio<select aria-label="Audio to clone" value={sampleId} onChange={event=>setSampleId(event.target.value)}><option value="">Choose a clip with your voice</option>{audible.map(media=><option key={media.id} value={media.id}>{media.name}</option>)}</select></label>
    <div className="transcript-actions"><button className="button compact" disabled={!!busy||!sampleId} onClick={()=>void cloneFromProject()}>{busy==='clone'?<LoaderCircle size={13} className="spin"/>:null}Clone from audio</button><button className="button compact" disabled={busy==='clone'||busy==='speech'} onClick={()=>void recordSample()}><Mic size={13}/>{busy==='record'?'Stop recording':'Record 15 seconds'}</button></div>
    <span>Cloning and generated speech upload audio or text to ElevenLabs. The first minute of project audio is used.</span>
   </div>}
   {notice&&<p role="alert">{notice}</p>}
   {!voice.hasApiKey&&<span>Save an ElevenLabs key in Settings to transcribe with Scribe, clone a voice, and insert speech.</span>}
  </div>
 </div>;
});
