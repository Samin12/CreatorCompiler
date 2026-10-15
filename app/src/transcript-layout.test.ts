import test from 'node:test';import assert from 'node:assert/strict';
import type {Scene} from '../shared/types';
import type {TranscriptWord} from './transcript-editing';
import {wordEndCeilings} from './editor-view';
import {activeWord,displayGlue,formatStamp,transcriptSections} from './transcript-layout';
const w=(text:string,start:number,end:number,captionId='c',timed=true,i=0):TranscriptWord=>({id:`${captionId}:${i}:${start}`,captionId,text,start,end,timed});
const scene=(id:string,name:string,start:number,duration:number):Scene=>({id,name,script:'',notes:'',start,duration});
test('display glue joins split pieces without touching real words',()=>{
 const words=[w('G',5.247,5.337),w('rogbot',5.527,5.857),w('is',5.86,6),w('I',6,6.1),w('think',6.1,6.3),w('It',7,7.1),w("'s",7.1,7.2),w('[',8,8.1),w('Inaud',8.1,8.5),w(']',8.5,8.6),w('A',9,9.1),w('dog',9.1,9.3),w('video,',10,10.2),w("'m",10.3,10.4)];
 const glue=displayGlue(words);
 assert.deepEqual([...glue],[0,1,0,0,0,0,1,0,1,1,0,0,0,0]);
 assert.equal(displayGlue([w('G',0,.1,'a'),w('rogbot',.15,.5,'b')])[1],0,'never joins across captions');
 assert.equal(displayGlue([w('G',0,.1),w('rogbot',1,1.5)])[1],0,'never joins across a real pause');});
test('sections follow scene starts, label default and custom names, and break paragraphs at pauses',()=>{
 const words=[w('Hello',0,.5,'a'),w('there.',.5,1,'a'),w('Still',1.2,1.5,'b'),w('intro.',1.5,2,'b'),w('Later',5,5.5,'c'),w('Setup',10,10.5,'d'),w('here.',10.5,11,'d')];
 const sections=transcriptSections(words,[scene('s2','Setup',10,5),scene('s1','Scene 1',0,10)]);
 assert.deepEqual(sections.map(s=>[s.key,s.label,s.name]),[['s1','Scene 1',''],['s2','Scene 2','Setup']]);
 assert.deepEqual(sections[0].paragraphs.map(p=>p.indices),[[0,1,2,3],[4]]);
 assert.deepEqual(sections[1].paragraphs.map(p=>p.indices),[[5,6]]);
 assert.deepEqual(transcriptSections(words,[]).map(s=>s.paragraphs.length),[3]);
 const long=Array.from({length:30},(_,i)=>w(i%10===9?'end.':'word',i*.3,i*.3+.25,`c${Math.floor(i/10)}`,true,i));
 assert.deepEqual(transcriptSections(long,[],{maxWords:10}).flatMap(s=>s.paragraphs.map(p=>p.indices.length)),[10,10,10]);});
test('active word follows timing, holds through short pauses and interpolates untimed captions',()=>{
 const words=[w('one',0,1),w('two',1,2),w('three',3,4),w('alpha beta gamma',10,13,'u',false)],ceilings=wordEndCeilings(words);
 assert.deepEqual(activeWord(words,ceilings,.5),{index:0,part:-1});
 assert.deepEqual(activeWord(words,ceilings,2.3),{index:1,part:-1},'short gap keeps previous word');
 assert.equal(activeWord(words,ceilings,2.8),null,'long gap clears');
 assert.equal(activeWord(words,ceilings,-1),null);
 assert.deepEqual([10.1,11.5,12.9].map(t=>activeWord(words,ceilings,t)?.part),[0,1,2]);
 assert.equal(formatStamp(65.25),'1:05.3');assert.equal(formatStamp(3),'0:03.0');});
