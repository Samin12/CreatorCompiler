/** Cursor is a one-based active word, consistent with local speech-follow output. */
export function navigateScript(text:string,cursor:number,action:'previousSentence'|'nextSentence'|'previousWord'|'nextWord'):number{
 const words=[...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)];if(!words.length)return 0;
 const current=Math.max(0,Math.min(words.length-1,cursor-1));
 if(action==='previousWord')return Math.max(1,current);
 if(action==='nextWord')return Math.min(words.length,current+2);
 const starts=[0];for(let i=1;i<words.length;i++){const previous=words[i-1],between=text.slice(previous.index!+previous[0].length,words[i].index);if(/[.!?。！？\n]/.test(between))starts.push(i);}
 if(action==='nextSentence')return (starts.find(index=>index>current)??words.length-1)+1;
 return ([...starts].reverse().find(index=>index<current)??0)+1;
}
/** Auto-scroll keeps a float position and writes whole device pixels: adding sub-pixel steps to scrollTop rounds slow speeds to nothing.
 * A scrollTop that moved by more than 1 px since the last write (wheel, keys, Back to top) resyncs it. Returns the value to write, or null. */
export function scrollAdvance(state:{pos:number;set:number},scrollTop:number,distance:number,dpr:number):number|null{
 if(Math.abs(scrollTop-state.set)>1)state.pos=scrollTop;state.pos+=distance;const next=Math.round(state.pos*dpr)/dpr;if(next===state.set)return null;state.set=next;return next;
}
