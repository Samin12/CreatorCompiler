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
/** Cuts through a plain view; see cutTimelineRange about nested objects shared with the previous state. */
export function deleteTranscriptSelection(p:Project,selection:WordSelection,padding=.02){const view=plainView(p),words=transcriptWords(view),range=selectedTranscriptRange(view,words,selection,padding);if(!range)throw Error('Select words with usable timing before deleting.');cutTimelineRange(p,range.start,range.end,true,view);return range;}
/** Replace highlighted wording in one caption. Timed words keep the original span; this does not cut footage. */
export function rewriteTranscriptSelection(p:Project,selection:WordSelection,text:string){
 const words=transcriptWords(p),indexes=selectionIndices(words,selection);if(!indexes)throw Error('Select words before editing them.');
 const chosen=words.slice(indexes[0],indexes[1]+1),next=text.replace(/\s+/g,' ').trim();if(!next)throw Error('Enter the replacement wording, or delete the selection.');
 if(new Set(chosen.map(word=>word.captionId)).size!==1)throw Error('Edit one caption at a time.');
 const caption=p.captions.find(item=>item.id===chosen[0].captionId);if(!caption)throw Error('That caption is no longer in the project.');
 if(chosen.some(word=>!word.timed)||!caption.words?.length){caption.text=next;delete caption.words;return {text:next};}
 const source=caption.words;let first=-1;
 for(let i=0;i<=source.length-chosen.length;i++)if(chosen.every((word,offset)=>source[i+offset].text===word.text&&Math.abs(source[i+offset].start-word.start)<1e-4)){first=i;break;}
 if(first<0)throw Error('The selection no longer matches this caption. Select it again.');
 const start=chosen[0].start,end=chosen[chosen.length-1].end,tokens=next.split(' '),step=Math.max(end-start,tokens.length*.02)/tokens.length;
 const replacement=tokens.map((token,index)=>({text:token,start:start+index*step,end:index===tokens.length-1?Math.max(end,start+tokens.length*step):start+(index+1)*step}));
 source.splice(first,chosen.length,...replacement);caption.text=source.map(word=>word.text.trim()).join(' ');caption.start=source[0].start;caption.end=source[source.length-1].end;return {text:caption.text};
}
export function sentenceSelection(words:TranscriptWord[],index:number):WordSelection{let a=index,b=index;const end=(w:TranscriptWord)=>/[.!?。！？][”"')\]]*$/.test(w.text)||!w.timed;while(a>0&&!end(words[a-1]))a--;while(b<words.length-1&&!end(words[b]))b++;return {anchor:a,focus:b};}
