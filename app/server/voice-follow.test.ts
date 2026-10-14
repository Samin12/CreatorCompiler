import test from 'node:test';
import assert from 'node:assert/strict';
import {alignSpeech,inspectVoiceWav,scriptTokens} from './voice-follow.js';
test('Voice alignment advances to next word while ignoring hesitation and punctuation',()=>{
 const r=alignSpeech('Welcome to Scene Forge. Write your script and record your story.','Um welcome to scene forge',0);assert.equal(r.cursor,4);assert.equal(r.confidence,1);
});
test('Repeated phrases choose the occurrence nearest the active cursor',()=>{
 const script='We make videos today. First we plan. We make videos today. Then we record.';
 assert.equal(alignSpeech(script,'we make videos today',8).cursor,11);assert.equal(alignSpeech(script,'we make videos today',0).cursor,4);
});
test('A nearby deliberate rewind is allowed while a far jump is bounded',()=>{
 const script='One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.';
 assert.equal(alignSpeech(script,'five six seven',10).cursor,7);
 const long=Array.from({length:200},(_,i)=>`word${i}`).join(' ');assert.equal(alignSpeech(long,'word150 word151 word152',0).cursor,0);
});
test('Disfluencies and a one-character recognition error align but unrelated speech does not jump',()=>{
 const script='Write your script then record your story with confidence.';
 assert.equal(alignSpeech(script,'write your um script then record your storey',0).cursor,7);
 assert.equal(alignSpeech(script,'the weather outside is purple',3).cursor,3);
 assert.equal(alignSpeech(script,'um uh',3).cursor,3);
});
test('Word tokenization ignores markdown punctuation and supports apostrophes and Unicode',()=>assert.deepEqual(scriptTokens("# Don't skip naïve ideas."),["Don't",'skip','naïve','ideas']));
test('Voice batches validate format and duration before inference',()=>{
 const wav=Buffer.alloc(44+32000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
 assert.equal(inspectVoiceWav(wav).duration,1);wav.writeUInt16LE(2,22);assert.throws(()=>inspectVoiceWav(wav),/mono/);assert.throws(()=>inspectVoiceWav(Buffer.alloc(20)),/PCM WAV/);
});
