import {test} from 'node:test';
import assert from 'node:assert/strict';
import {navigateScript} from './teleprompter-navigation';
test('word and sentence shortcuts stay inside script and preserve punctuation boundaries',()=>{
 const script="First two words. Here's another sentence!\nNext scene here.";
 assert.equal(navigateScript(script,1,'nextWord'),2);assert.equal(navigateScript(script,1,'previousWord'),1);
 assert.equal(navigateScript(script,2,'nextSentence'),4);assert.equal(navigateScript(script,5,'previousSentence'),4);
 assert.equal(navigateScript(script,4,'previousSentence'),1);assert.equal(navigateScript(script,4,'nextSentence'),7);
 assert.equal(navigateScript(script,999,'nextWord'),9);assert.equal(navigateScript('',0,'nextWord'),0);
});
