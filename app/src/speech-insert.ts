import type {Caption,Media,Project} from '../shared/types';
import {makeId} from '../shared/types';
import {insertMedia} from './api';

/** Place generated narration on the audio track and shift its captions to the timeline. */
export function insertGeneratedSpeech(project:Project,media:Media,captions:Caption[],at:number){
 const start=Math.max(0,Number.isFinite(at)?at:0);
 insertMedia(project,[media],start,'audio');
 const end=start+(media.duration||0);
 const scene=[...project.scenes].reverse().find(item=>start>=item.start-1e-6)??project.scenes[0];
 if(scene){
  const next=project.scenes.find(item=>item.start>scene.start+1e-6);
  const limit=next?next.start:end;
  const capped=Math.min(end,limit);
  if(scene.start+scene.duration<capped)scene.duration=capped-scene.start;
 }
 for(const caption of captions){
  if(!(caption.end>caption.start)||!caption.text.trim())continue;
  project.captions.push({...structuredClone(caption),id:makeId(),start:caption.start+start,end:caption.end+start,words:caption.words?.map(word=>({...word,start:word.start+start,end:word.end+start}))});
 }
 project.captions.sort((a,b)=>a.start-b.start||a.end-b.end);
}
