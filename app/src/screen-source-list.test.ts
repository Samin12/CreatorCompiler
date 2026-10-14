import test from 'node:test';
import assert from 'node:assert/strict';
import {screenChoicePrompt,screenPreviewPrompt,screenSourceListNotice} from './screen-source-list';

test('recording prompt names the missing window, display, or region without claiming the preview is live',()=>{
 assert.match(screenChoicePrompt('window'),/application window/);
 assert.match(screenChoicePrompt('region'),/then the region/);
 assert.match(screenChoicePrompt('display'),/Choose a display/);
 assert.match(screenPreviewPrompt('window'),/application window/);
 assert.equal(screenSourceListNotice({loaded:false,matchCount:0,mode:'window',permission:'granted'}),null);
 assert.equal(screenSourceListNotice({loaded:true,matchCount:2,mode:'window',permission:'granted'}),null);
});
test('a granted screen permission with an empty source list asks for a relaunch instead of a new permission',()=>{
 const notice=screenSourceListNotice({loaded:true,matchCount:0,mode:'window',permission:'granted'});
 assert.match(notice!,/already allowed|is allowed/);
 assert.match(notice!,/Quit SceneForge/);
 assert.doesNotMatch(notice!,/Allow SceneForge/);
});
test('denied and missing permissions keep the setup instruction',()=>{
 assert.match(screenSourceListNotice({loaded:true,matchCount:0,mode:'display',permission:'denied'})!,/access is off/);
 assert.match(screenSourceListNotice({loaded:true,matchCount:0,mode:'window',permission:'not-determined'})!,/has not been granted/);
 assert.match(screenSourceListNotice({loaded:true,matchCount:0,mode:'window'})!,/Open the window/);
 assert.match(screenSourceListNotice({loaded:true,matchCount:0,mode:'region'})!,/Connect a display/);
});
