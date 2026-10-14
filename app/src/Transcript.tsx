import {useEffect,useId,useMemo,useRef,useState,type KeyboardEvent} from 'react';
import type {Project} from '../shared/types';
import {Scissors} from './Icons';
import {selectedTranscriptRange,selectionIndices,sentenceSelection,transcriptWords,type WordSelection} from './transcript-editing';
import './transcript.css';
export function Transcript({project,time,onSeek,onDelete,onUndo,onRedo}:{project:Project;time:number;onSeek:(time:number)=>void;onDelete:(selection:WordSelection)=>void;onUndo:()=>void;onRedo:()=>void}){
 const words=useMemo(()=>transcriptWords(project),[project]),[selection,setSelection]=useState<WordSelection|null>(null),root=useRef<HTMLDivElement>(null),dragging=useRef(false),helpId=useId();
 const fingerprint=useMemo(()=>JSON.stringify([project.id,project.clips,project.captions]),[project.id,project.clips,project.captions]);
 useEffect(()=>{setSelection(null);dragging.current=false;},[fingerprint]);
 const indices=selectionIndices(words,selection),range=useMemo(()=>selectedTranscriptRange(project,words,selection),[project,words,selection]);
 const groups=useMemo(()=>{const groups:Array<{id:string;start:number;indices:number[]}>=[];words.forEach((word,index)=>{let group=groups.at(-1);if(group?.id!==word.captionId){group={id:word.captionId,start:word.start,indices:[]};groups.push(group);}group!.indices.push(index);});return groups;},[words]);
 function remove(){if(!selection||!range)return;onDelete(selection);setSelection(null);root.current?.focus();}
 function key(e:KeyboardEvent){if((e.target as HTMLElement).closest('button,input,textarea,select'))return;
  const command=e.metaKey||e.ctrlKey;
  if(command&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();e.shiftKey?onRedo():onUndo();return;}
  if(command&&e.key.toLowerCase()==='a'){e.preventDefault();e.stopPropagation();if(words.length)setSelection({anchor:0,focus:words.length-1});return;}
  if(e.key==='Escape'){setSelection(null);e.stopPropagation();return;}
  if((e.key==='Delete'||e.key==='Backspace')&&selection){e.preventDefault();e.stopPropagation();remove();return;}
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)&&words.length){e.preventDefault();e.stopPropagation();const direction=['ArrowLeft','ArrowUp'].includes(e.key)?-1:1;let next=e.key==='Home'?0:e.key==='End'?words.length-1:Math.max(0,Math.min(words.length-1,(selection?.focus??-direction)+direction));if(selection&&!e.shiftKey&&indices&&indices[0]!==indices[1]&&e.key.startsWith('Arrow'))next=direction<0?indices[0]:indices[1];setSelection({anchor:e.shiftKey?selection?.anchor??next:next,focus:next});onSeek(words[next].start);}
 }
 return <div className="transcript-editor" data-transcript-editor ref={root} tabIndex={0} role="region" aria-label="Editable transcript" aria-describedby={helpId} onKeyDown={key} onCopy={e=>{if(!range)return;e.clipboardData.setData('text/plain',range.text);e.preventDefault();}}>
  <div className="transcript-help" id={helpId}>Drag over words to select. Double-click a sentence. Delete cuts every track and closes the gap.</div>
  <div className="transcript-word-list" onPointerDown={e=>{if(e.button!==0)return;const item=(e.target as HTMLElement).closest<HTMLElement>('[data-word-index]');if(!item)return;const index=Number(item.dataset.wordIndex);e.preventDefault();root.current?.focus();setSelection(old=>({anchor:e.shiftKey?old?.anchor??index:index,focus:index}));onSeek(words[index].start);dragging.current=true;e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!dragging.current)return;const item=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-word-index]');if(!item||!root.current?.contains(item))return;const index=Number(item.dataset.wordIndex);setSelection(old=>old?{...old,focus:index}:null);}} onPointerUp={e=>{dragging.current=false;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{dragging.current=false;}} onDoubleClick={e=>{const item=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-word-index]');if(item&&root.current?.contains(item))setSelection(sentenceSelection(words,Number(item.dataset.wordIndex)));}}>
   {groups.map(group=><div className="transcript-sentence" key={`${group.id}-${group.indices[0]}`}><span className="transcript-stamp">{group.start.toFixed(2)}s</span><p>{group.indices.map(i=><span key={words[i].id} data-word-index={i} data-selected={Boolean(indices&&i>=indices[0]&&i<=indices[1])} className={`transcript-word ${time>=words[i].start&&time<words[i].end?'current':''} ${!words[i].timed?'untimed':''}`} title={`${words[i].start.toFixed(3)}–${words[i].end.toFixed(3)}s${!words[i].timed?' · Whole caption: word timing unavailable':''}`}>{words[i].text} </span>)}</p></div>)}
  </div>
  <div className="transcript-selection" aria-live="polite" aria-atomic="true">{range?<><strong>{range.wordCount} {range.wholeCaptions?'items':'words'} · {range.start.toFixed(3)}–{range.end.toFixed(3)}s</strong><span>Delete will remove {(range.end-range.start).toFixed(3)}s from all tracks.{range.wholeCaptions?' Untimed captions cut as a whole.':''}{range.limited?' Overlapping timing limits this cut.':''}</span><button className="button danger compact" onClick={remove}><Scissors size={14}/>Delete selection</button></>:<span>Select words, then press Delete. ⌘Z restores the edit.</span>}</div>
 </div>;
}
