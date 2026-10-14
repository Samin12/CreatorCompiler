import {projectDuration,type Project} from '../shared/types';
import {cutTimelineRange} from '../shared/timeline-edits';
import {plainView} from './project-draft';
export interface TranscriptWord {id:string;captionId:string;text:string;start:number;end:number;timed:boolean;}
export interface WordSelection {anchor:number;focus:number;}
const normalized=(s:string)=>s.replace(/\s+/g,' ').trim();
export function transcriptWords(p:Project):TranscriptWord[]{return p.captions.flatMap(c=>{
 const words=c.words?.filter(w=>Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.end>w.start);
 if(words?.length&&normalized(words.map(w=>w.text).join(' '))===normalized(c.text))return words.map((w,i)=>({...w,id:`${c.id}:${i}`,captionId:c.id,timed:true}));
 return [{id:c.id,captionId:c.id,text:c.text,start:c.start,end:c.end,timed:false}];
 }).sort((a,b)=>a.start-b.start||a.end-b.end);}
export function selectionIndices(words:TranscriptWord[],selection:WordSelection|null){if(!selection||!words.length)return null;const a=Math.min(selection.anchor,selection.focus),b=Math.max(selection.anchor,selection.focus);return Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b<words.length?[a,b] as const:null;}
export function selectedTranscriptRange(p:Project,words:TranscriptWord[],selection:WordSelection|null,padding=.02){
 const indexes=selectionIndices(words,selection);if(!indexes)return null;const [a,b]=indexes,chosen=words.slice(a,b+1),first=Math.min(...chosen.map(w=>w.start)),last=Math.max(...chosen.map(w=>w.end));
 // Limit optional 20ms padding to genuine gaps; never consume an adjacent word.
 const before=words.filter((w,i)=>i<a&&w.timed).reduce((n,w)=>Math.max(n,w.end),0),after=words.filter((w,i)=>i>b&&w.timed).reduce((n,w)=>Math.min(n,w.start),projectDuration(p));
 const start=Math.max(0,before,first-Math.max(0,padding)),end=Math.min(projectDuration(p),after,last+Math.max(0,padding));
 if(end-start<.001)return null;
 return {start,end,text:chosen.map(w=>w.text).join(' '),wordCount:chosen.length,wholeCaptions:chosen.some(w=>!w.timed),limited:start>first+.000001||end<last-.000001};
}
export function deleteTranscriptSelection(p:Project,selection:WordSelection,padding=.02){const view=plainView(p),words=transcriptWords(view),range=selectedTranscriptRange(view,words,selection,padding);if(!range)throw Error('Select words with usable timing before deleting.');cutTimelineRange(p,range.start,range.end,true,view);return range;}
export function sentenceSelection(words:TranscriptWord[],index:number):WordSelection{let a=index,b=index;const end=(w:TranscriptWord)=>/[.!?。！？][”"')\]]*$/.test(w.text)||!w.timed;while(a>0&&!end(words[a-1]))a--;while(b<words.length-1&&!end(words[b]))b++;return {anchor:a,focus:b};}
