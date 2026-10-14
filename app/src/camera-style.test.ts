import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyCreatorLayout,creatorCameraTransform,creatorScreenTransform} from '../shared/camera-style';
import {createProject,defaultTransform,type Clip,type RecordedTake} from '../shared/types';
import {activateSceneTake,confirmTake,takePreviewProject} from './recorded-takes';

function fixture():{project:ReturnType<typeof createProject>;take:RecordedTake}{
 const project=createProject();
 return {project,take:{id:'capture',sceneId:project.scenes[0].id,createdAt:'2026-10-13',tracks:['screen','camera'],offsets:[0,.1],media:['screen','camera'].map(id=>({id,name:id,path:`/fixture/${id}.mp4`,kind:'video',duration:3,width:1920,height:1080}))}};
}
test('creator geometry scales effects by the minimum canvas dimension, with independent nested objects',()=>{
 for(const canvas of [{width:1920,height:1080},{width:1080,height:1920},{width:640,height:360}]){
  const camera=creatorCameraTransform(canvas),screen=creatorScreenTransform(canvas),scale=Math.min(canvas.width,canvas.height)/1080;
  assert.ok(Math.abs(camera.borderRadius-19.2*scale)<1e-9);assert.deepEqual(camera.shadow,{x:0,y:20*scale,blur:20*scale,color:'#00000064'});
  assert.equal(camera.x,.7966337703449105);assert.equal(screen.width,.7675755);assert.equal(camera.fit,'cover');
  assert.notEqual(screen.shadow,camera.shadow);camera.shadow!.blur=999;assert.equal(creatorCameraTransform(canvas).shadow!.blur,20*scale);
 }
});
test('new composed take review and confirmed timeline use identical creator geometry without mutating existing edits',()=>{
 const {project,take}=fixture(),before=structuredClone(project),preview=takePreviewProject(project,take);
 assert.deepEqual(project,before);confirmTake(project,take);
 assert.deepEqual(preview.clips.map(c=>c.transform),project.clips.map(c=>c.transform));
 assert.deepEqual(project.clips.map(c=>c.start),[0,.1]);assert.equal(project.clips[0].transform.shadow!.color,'#00000064');
 const camera=project.clips[1];camera.transform.x=.33;camera.transform.shadow!.blur=7;
 const replacement={...structuredClone(take),id:'replacement',media:take.media.map(m=>({...m,id:m.id+'2',path:m.path+'2'}))};
 confirmTake(project,replacement);activateSceneTake(project,take.sceneId,take.id);
 assert.equal(project.clips[1].transform.x,.33);assert.equal(project.clips[1].transform.shadow!.blur,7);
 const review=takePreviewProject(project,project.recordedTakes!.find(t=>t.id===take.id)!);
 assert.equal(review.clips[1].transform.x,.33);assert.equal(review.clips[1].transform.shadow!.blur,7);
 review.clips[1].transform.shadow!.blur=88;assert.equal(project.clips[1].transform.shadow!.blur,7);
});
test('single-source recordings remain full frame and applying the preset is explicit',()=>{
 for(const track of ['camera','screen'] as const){const {project,take}=fixture();take.tracks=[track];take.offsets=[0];take.media=[take.media[0]];assert.deepEqual(takePreviewProject(project,take).clips[0].transform,defaultTransform());confirmTake(project,take);assert.deepEqual(project.clips[0].transform,defaultTransform());}
 const {project,take}=fixture();confirmTake(project,take);const audio={...structuredClone(project.clips[0]),id:'audio',track:'audio'} as Clip,background={...structuredClone(project.clips[0]),id:'background',zIndex:-1000};project.clips.push(audio,background);
 project.clips[0].transform.rotation=12;project.clips[0].transform.opacity=.4;const untouched=structuredClone([audio,background]);
 applyCreatorLayout(project);assert.equal(project.clips[0].transform.rotation,12);assert.equal(project.clips[0].transform.opacity,.4);assert.deepEqual(project.clips.slice(2),untouched);
});
