import type {Scene} from '../shared/types';
import type {TranscriptWord} from './transcript-editing';
import {currentWordIndices,partitionPoint} from './editor-view';
/** Display-only shaping of the transcript: scene sections, prose paragraphs, token joins and the live word. Stored captions are never changed. */
export interface TranscriptParagraph {key:string;indices:number[]}
export interface TranscriptSection {key:string;label:string;name:string;start:number;paragraphs:TranscriptParagraph[]}
export interface ActiveWord {index:number;part:number}
const OPEN=/^[[({“‘«¿¡]+$/,CLOSE=/^[\])}.,!?;:%…”’»]+$/,CONTRACTION=/^(?:['’](?:s|m|d|t|re|ve|ll)|n['’]t)$/i,SENTENCE_END=/[.!?。！？…][”"')\]]*$/;
export const wordTokens=(text:string)=>text.split(/\s+/).filter(Boolean);
/** 1 where a word should render glued to the previous one: stray punctuation, split contractions ("It 's") and a lone capital split off its word ("G rogbot"). */
export function displayGlue(words:readonly TranscriptWord[]):Uint8Array{const out=new Uint8Array(words.length);
 for(let i=1;i<words.length;i++){const a=words[i-1],b=words[i];if(!a.timed||!b.timed||a.captionId!==b.captionId)continue;
  if(CLOSE.test(b.text)||OPEN.test(a.text))out[i]=1;
  else if(CONTRACTION.test(b.text)&&/[A-Za-z]$/.test(a.text))out[i]=1;
  else if(/^[B-HJ-Z]$/.test(a.text)&&/^[a-z]/.test(b.text)&&b.start-a.end<.35)out[i]=1;}
 return out;}
/** Words grouped under the scene they start in, then into paragraphs at long pauses or after a sentence once a paragraph is long. */
export function transcriptSections(words:readonly TranscriptWord[],scenes:readonly Scene[],{gap=1.6,maxWords=70}:{gap?:number;maxWords?:number}={}):TranscriptSection[]{
 const order=scenes.map((scene,index)=>({scene,index})).sort((a,b)=>a.scene.start-b.scene.start||a.index-b.index),sections:TranscriptSection[]=[];
 let j=0,section:TranscriptSection|undefined,paragraph:TranscriptParagraph|undefined;
 words.forEach((word,i)=>{
  while(j+1<order.length&&order[j+1].scene.start<=word.start+1e-6)j++;
  const entry=order[j],key=entry?.scene.id??'transcript';
  if(section?.key!==key){const label=entry?`Scene ${j+1}`:'',name=entry&&entry.scene.name.trim().toLowerCase()!==label.toLowerCase()?entry.scene.name.trim():'';section={key,label,name,start:entry?.scene.start??0,paragraphs:[]};sections.push(section);paragraph=undefined;}
  const prev=words[i-1];
  if(!paragraph||prev.captionId!==word.captionId&&(word.start-prev.end>=gap||paragraph.indices.length>=maxWords&&(SENTENCE_END.test(prev.text)||paragraph.indices.length>=maxWords*2))){paragraph={key:word.id,indices:[]};section.paragraphs.push(paragraph);}
  paragraph.indices.push(i);
 });
 return sections;}
/** The single word to highlight at `time`: the latest-starting word under the playhead, or the previous word through a short pause.
 * Untimed captions are one word for editing, so `part` interpolates which of their tokens is being spoken (character weighted). */
export function activeWord(words:readonly TranscriptWord[],ceilings:ArrayLike<number>,time:number,hold=.6):ActiveWord|null{
 const live=currentWordIndices(words,ceilings,time);let index=live.length?live[live.length-1]:-1;
 if(index<0){const before=partitionPoint(words.length,i=>words[i].start<=time)-1;if(before<0||time-ceilings[before]>=hold)return null;index=before;}
 const word=words[index];if(word.timed)return {index,part:-1};
 const tokens=wordTokens(word.text);if(tokens.length<2)return {index,part:0};
 const weights=tokens.map(t=>t.length+1),total=weights.reduce((a,b)=>a+b,0),at=Math.max(0,Math.min(1,(time-word.start)/Math.max(1e-6,word.end-word.start)))*total;
 let sum=0;for(let part=0;part<tokens.length;part++){sum+=weights[part];if(at<sum)return {index,part};}
 return {index,part:tokens.length-1};}
export const formatStamp=(t:number)=>{const s=Math.max(0,t);return `${Math.floor(s/60)}:${(s%60).toFixed(1).padStart(4,'0')}`;};
