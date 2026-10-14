import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../shared/types';
import {insertGeneratedSpeech} from './speech-insert';

test('generated speech lands on the audio track at the playhead and carries captions',()=>{
 const project=createProject('Speech');project.scenes[0].duration=4;
 const media={id:'spoken',name:'Hello there',path:'/tmp/spoken.mp3',kind:'audio' as const,duration:1.2,width:0,height:0,hasAudio:true};
 insertGeneratedSpeech(project,media,[{id:'old',start:0,end:1.2,text:'Hello there',words:[{text:'Hello',start:0,end:.4},{text:'there',start:.4,end:1.2}]}],2);
 assert.equal(project.media[0].id,'spoken');assert.equal(project.clips[0].track,'audio');assert.equal(project.clips[0].start,2);assert.equal(project.clips[0].sourceOut,1.2);
 assert.equal(project.captions[0].text,'Hello there');assert.equal(project.captions[0].words![1].start,2.4);assert.equal(project.scenes[0].duration,4);
});
