import test from 'node:test';
import assert from 'node:assert/strict';
import {clipDuration,createProject,defaultEffects,defaultTransform,type Project,type TrackKind} from '../shared/types';
import {confirmTake,saveProjectTake,sceneTakes,type SavedTake} from './recorded-takes';
import {listSceneTakes,sceneCardData} from './recording-scene-data';
const take=(sceneId:string,id:string,createdAt:string,duration=3):SavedTake=>({id,sceneId,createdAt,media:(['screen','microphone'] as const).map(role=>({id:`${id}-${role}`,name:role,path:`/local/${id}-${role}`,kind:role==='screen'?'video' as const:'audio' as const,duration,width:640,height:360,hasAudio:role==='microphone',...(role==='microphone'?{audioRole:'microphone' as const}:{})})),tracks:['screen','audio'] as TrackKind[],offsets:[0,.5],clipIds:[`${id}-c1`,`${id}-c2`]});
// The previous per-render derivation, kept as the reference for equivalence.
function reference(project:Project,takes:SavedTake[],sceneId:string){
 const unique=new Map(takes.filter(t=>t.sceneId===sceneId).map(t=>[t.id,t]));const states=new Map(sceneTakes({...project,recordedTakes:[...unique.values()]},sceneId).map(t=>[t.id,t.activeClipCount>0]));
 const scene=project.scenes.find(s=>s.id===sceneId)!;
 return {all:[...unique.values()].sort((a,b)=>(Date.parse(a.createdAt)||0)-(Date.parse(b.createdAt)||0)||a.id.localeCompare(b.id)).map((take,index)=>({take,number:index+1,active:states.get(take.id)||project.clips.some(c=>take.clipIds?.includes(c.id)),duration:Math.max(0,...take.media.map((m,i)=>Math.max(0,take.offsets[i]||0)+m.duration))})).reverse(),
  legacyFootage:project.clips.some(c=>!c.recordingTakeId&&!takes.some(t=>t.clipIds?.includes(c.id))&&c.track!=='music'&&c.start<scene.start+scene.duration&&c.start+clipDuration(c)>scene.start&&project.media.some(m=>m.id===c.mediaId&&(m.kind==='video'||m.kind==='audio')))};
}
test('precomputed scene card data matches the per-scene derivation for active, archived, local and legacy footage',()=>{
 const p=createProject(),first=p.scenes[0].id;
 const a=take(first,'a','2026-10-01T10:00:00Z'),b=take(first,'b','2026-10-01T09:00:00Z'),local=take(first,'local','2026-10-02T09:00:00Z');
 saveProjectTake(p,a);confirmTake(p,a);saveProjectTake(p,b);
 p.scenes.push({id:'two',name:'Two',script:'',notes:'',start:p.scenes[0].duration,duration:5},{id:'three',name:'Three',script:'',notes:'',start:p.scenes[0].duration+5,duration:4});
 const media={id:'legacy-media',name:'old',path:'/local/old.mp4',kind:'video' as const,duration:5,width:640,height:360,hasAudio:false};p.media.push(media,{...media,id:'music-media',kind:'audio' as const,path:'/local/music.wav'});
 const clip=(id:string,mediaId:string,track:TrackKind,start:number)=>({id,mediaId,name:id,track,start,sourceIn:0,sourceOut:5,speed:1,gain:1,muted:false,effects:defaultEffects(),transform:defaultTransform()});
 p.clips.push(clip('legacy','legacy-media','screen',p.scenes[1].start),clip('music','music-media','music',p.scenes[2].start),clip('local-c1','legacy-media','screen',p.scenes[2].start));
 const takes=[...(p.recordedTakes??[]),local,{...b,name:'Older copy'}];
 const data=sceneCardData(p,takes);
 assert.deepEqual([...data.keys()],p.scenes.map(s=>s.id));
 for(const scene of p.scenes)assert.deepEqual(data.get(scene.id),reference(p,takes,scene.id));
 assert.deepEqual(data.get(first)!.all.map(t=>[t.take.id,t.number,t.active]),[['local',3,true],['a',2,true],['b',1,false]]);
 assert.deepEqual(p.scenes.map(s=>data.get(s.id)!.legacyFootage),[false,true,false]);
 assert.deepEqual(listSceneTakes(p,takes,first),data.get(first)!.all);
});
