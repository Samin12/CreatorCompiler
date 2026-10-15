import {memo,useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type KeyboardEvent} from 'react';
import type {Project} from '../shared/types';
import {Scissors} from './Icons';
import type {Playhead} from './playhead';
import {sameTranscriptTiming,wordEndCeilings} from './editor-view';
import {selectedTranscriptRange,selectionIndices,sentenceSelection,transcriptWords,type TranscriptWord,type WordSelection} from './transcript-editing';
import {activeWord,displayGlue,formatStamp,transcriptSections,wordTokens,type TranscriptParagraph} from './transcript-layout';
import './transcript.css';
/** Manual scrolling pauses follow-along this long; the spoken word is kept inside [BAND_TOP,BAND_BOTTOM] of the viewport and re-centred at FOLLOW_AT. */
const USER_SCROLL_PAUSE=3000,BAND_TOP=.15,BAND_BOTTOM=.7,FOLLOW_AT=.3;
/** One prose paragraph. It re-renders only when its words or its part of the selection change; the live word is toggled directly on the DOM. */
const TranscriptParagraphView=memo(function TranscriptParagraphView({paragraph,words,glue,selStart,selEnd}:{paragraph:TranscriptParagraph;words:TranscriptWord[];glue:Uint8Array;selStart:number;selEnd:number}){
 return <p className="transcript-paragraph">{paragraph.indices.map((i,n)=>{const word=words[i],tokens=word.timed?null:wordTokens(word.text);
  return <span key={word.id}>{n>0&&!glue[i]?' ':''}<span data-word-index={i} data-selected={i>=selStart&&i<=selEnd} className={word.timed?'transcript-word':'transcript-word untimed'} title={`${formatStamp(word.start)}${word.timed?'':' · whole caption, word timing unavailable'}`}>{tokens&&tokens.length>1?tokens.map((t,k)=><span key={k}>{k>0?' ':''}<span data-part={k}>{t}</span></span>):word.text}</span></span>;})}</p>;
});
export const Transcript=memo(function Transcript({project,playhead,onSeek,onDelete,onUndo,onRedo}:{project:Project;playhead:Playhead;onSeek:(time:number)=>void;onDelete:(selection:WordSelection)=>void;onUndo:()=>void;onRedo:()=>void}){
 // transcriptWords only reads captions, so unrelated edits keep the word list.
 const words=useMemo(()=>transcriptWords(project),[project.captions]),ceilings=useMemo(()=>wordEndCeilings(words),[words]),glue=useMemo(()=>displayGlue(words),[words]),sections=useMemo(()=>transcriptSections(words,project.scenes),[words,project.scenes]);
 const [selection,setSelection]=useState<WordSelection|null>(null),root=useRef<HTMLDivElement>(null),list=useRef<HTMLDivElement>(null),dragging=useRef(false),hovering=useRef(false),userScrollAt=useRef(-Infinity),helpId=useId();
 const timing=useRef({project,version:0});if(timing.current.project!==project){if(!sameTranscriptTiming(timing.current.project,project))timing.current.version++;timing.current.project=project;}
 useEffect(()=>{setSelection(null);dragging.current=false;},[timing.current.version]);
 const indices=selectionIndices(words,selection),range=useMemo(()=>selectedTranscriptRange(project,words,selection),[project,words,selection]);
 // Live word: a playhead subscription moves one DOM attribute, so playback never re-renders the transcript.
 const live=useRef<{key:string;element:Element|null}>({key:'',element:null}),sync=useRef<(force:boolean)=>void>(()=>{});
 sync.current=(force)=>{const scroller=list.current;if(!scroller)return;const active=activeWord(words,ceilings,playhead.get()),key=active?`${words[active.index].id}#${active.part}`:'';
  if(!force&&key===live.current.key&&live.current.element?.isConnected)return;
  live.current.element?.removeAttribute('data-current');
  let element:Element|null=null;if(active){const word=scroller.querySelector(`[data-word-index="${active.index}"]`);element=active.part>=0?word?.querySelector(`[data-part="${active.part}"]`)??word:word;}
  element?.setAttribute('data-current','true');const moved=key!==live.current.key;live.current={key,element};
  if(element&&moved&&!dragging.current&&!hovering.current&&performance.now()-userScrollAt.current>=USER_SCROLL_PAUSE)follow(scroller,element,true);
 };
 /** Content-visibility estimates sizes of unrendered paragraphs, so a long jump is corrected once on the next frame. */
 function follow(scroller:HTMLElement,element:Element,retry:boolean){const view=scroller.getBoundingClientRect(),box=element.getBoundingClientRect(),y=box.top-view.top;if(y>=view.height*BAND_TOP&&y+box.height<=view.height*BAND_BOTTOM)return;
  const far=Math.abs(y)>view.height*1.5,instant=far||matchMedia('(prefers-reduced-motion: reduce)').matches;scroller.scrollTo({top:scroller.scrollTop+y-view.height*FOLLOW_AT,behavior:instant?'auto':'smooth'});
  if(far&&retry)requestAnimationFrame(()=>{if(element.isConnected&&live.current.element===element)follow(scroller,element,false);});}
 useEffect(()=>{let frame=0;const update=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;sync.current(false);});};sync.current(false);const off=playhead.subscribe(update);return()=>{off();cancelAnimationFrame(frame);};},[playhead]);
 // A paragraph re-render can replace word nodes, so re-apply the live word after every commit (no scroll unless it moved).
 useLayoutEffect(()=>{sync.current(true);});
 useEffect(()=>{const scroller=list.current;if(!scroller)return;const mark=()=>{userScrollAt.current=performance.now();},bar=(e:PointerEvent)=>{if(e.target===scroller)mark();},keys=(e:globalThis.KeyboardEvent)=>{if(e.key==='PageUp'||e.key==='PageDown'||e.key===' ')mark();},enter=()=>{hovering.current=true;},leave=()=>{hovering.current=false;};
  scroller.addEventListener('wheel',mark,{passive:true});scroller.addEventListener('touchmove',mark,{passive:true});scroller.addEventListener('pointerdown',bar);scroller.addEventListener('keydown',keys);scroller.addEventListener('pointerenter',enter);scroller.addEventListener('pointerleave',leave);
  return()=>{scroller.removeEventListener('wheel',mark);scroller.removeEventListener('touchmove',mark);scroller.removeEventListener('pointerdown',bar);scroller.removeEventListener('keydown',keys);scroller.removeEventListener('pointerenter',enter);scroller.removeEventListener('pointerleave',leave);};},[]);
 function remove(){if(!selection||!range)return;onDelete(selection);setSelection(null);root.current?.focus();}
 function key(e:KeyboardEvent){if((e.target as HTMLElement).closest('button,input,textarea,select'))return;
  const command=e.metaKey||e.ctrlKey;
  if(command&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();e.shiftKey?onRedo():onUndo();return;}
  if(command&&e.key.toLowerCase()==='a'){e.preventDefault();e.stopPropagation();if(words.length)setSelection({anchor:0,focus:words.length-1});return;}
  if(e.key==='Escape'){setSelection(null);e.stopPropagation();return;}
  if((e.key==='Delete'||e.key==='Backspace')&&selection){e.preventDefault();e.stopPropagation();remove();return;}
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)&&words.length){e.preventDefault();e.stopPropagation();userScrollAt.current=-Infinity;const direction=['ArrowLeft','ArrowUp'].includes(e.key)?-1:1;let next=e.key==='Home'?0:e.key==='End'?words.length-1:Math.max(0,Math.min(words.length-1,(selection?.focus??-direction)+direction));if(selection&&!e.shiftKey&&indices&&indices[0]!==indices[1]&&e.key.startsWith('Arrow'))next=direction<0?indices[0]:indices[1];setSelection({anchor:e.shiftKey?selection?.anchor??next:next,focus:next});onSeek(words[next].start);}
 }
 return <div className="transcript-editor" data-transcript-editor ref={root} tabIndex={0} role="region" aria-label="Editable transcript" aria-describedby={helpId} onKeyDown={key} onCopy={e=>{if(!range)return;e.clipboardData.setData('text/plain',range.text);e.preventDefault();}}>
  <span className="transcript-help" id={helpId}>Click a word to jump to it. Drag over words to select, double-click for a sentence. Delete cuts every track and closes the gap; Command Z restores it.</span>
  <div className="transcript-word-list" ref={list} onPointerDown={e=>{if(e.button!==0)return;const item=(e.target as HTMLElement).closest<HTMLElement>('[data-word-index]');if(!item)return;const index=Number(item.dataset.wordIndex);e.preventDefault();root.current?.focus();setSelection(old=>({anchor:e.shiftKey?old?.anchor??index:index,focus:index}));onSeek(words[index].start);dragging.current=true;e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!dragging.current)return;const item=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-word-index]');if(!item||!root.current?.contains(item))return;const index=Number(item.dataset.wordIndex);setSelection(old=>old?{...old,focus:index}:null);}} onPointerUp={e=>{dragging.current=false;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{dragging.current=false;}} onDoubleClick={e=>{const item=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-word-index]');if(item&&root.current?.contains(item))setSelection(sentenceSelection(words,Number(item.dataset.wordIndex)));}}>
   {sections.map(section=><section className="transcript-scene" key={section.key}>
    {section.label&&<h4 className="transcript-scene-label"><button type="button" title={`Jump to ${formatStamp(section.start)}`} onClick={()=>{userScrollAt.current=-Infinity;onSeek(section.start);}}>{section.label}{section.name&&<span>{section.name}</span>}</button></h4>}
    {section.paragraphs.map(paragraph=>{const first=paragraph.indices[0],last=paragraph.indices[paragraph.indices.length-1],selected=Boolean(indices&&indices[0]<=last&&indices[1]>=first);return <TranscriptParagraphView key={paragraph.key} paragraph={paragraph} words={words} glue={glue} selStart={selected?Math.max(indices![0],first):-1} selEnd={selected?Math.min(indices![1],last):-1}/>;})}
   </section>)}
  </div>
  <div className={range?'transcript-selection has-range':'transcript-selection'} aria-live="polite" aria-atomic="true">{range?<><span><strong>{range.wordCount} {range.wholeCaptions?'items':'words'}</strong> · {(range.end-range.start).toFixed(2)}s from all tracks{range.wholeCaptions?' · untimed captions cut whole':''}{range.limited?' · limited by overlapping timing':''}</span><button className="button danger compact" onClick={remove} title="Delete selection (⌫) · ⌘Z restores"><Scissors size={13}/>Delete</button></>:<span>Click to jump · drag to select · ⌫ cuts · ⌘Z undo</span>}</div>
 </div>;
});
