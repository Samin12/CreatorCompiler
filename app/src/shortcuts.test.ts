import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveShortcut, captureShortcut, findShortcutConflicts, loadShortcutOverrides, saveShortcutOverrides, isEditableTarget, shortcutLabel, shortcutDefinitions, type ShortcutContext, type ShortcutInput, type ShortcutOverrides} from './shortcuts.ts';
const edit: ShortcutContext = {scope:'edit', platform:'mac'};
const action = (event: ShortcutInput, context = edit, overrides: ShortcutOverrides = {}) => resolveShortcut(event,context,overrides)?.id;

test('B chooses blade, Cmd+B cuts, A selects, S scrubs, and extra modifiers never match',()=>{
  assert.equal(action({key:'b'}),'bladeTool');
  assert.equal(action({key:'b',metaKey:true}),'split');
  assert.equal(action({key:'a'}),'selectTool');
  assert.equal(action({key:'s'}),'toggleScrubbing');
  assert.equal(action({key:'s',metaKey:true}),'saveProject');
  for(const event of [{key:'S',shiftKey:true},{key:'b',altKey:true},{key:'b',metaKey:true,ctrlKey:true}])assert.equal(action(event),undefined);
});
test('platform command modifier is exact and portable mapping is explicit',()=>{
  assert.equal(action({key:'b',ctrlKey:true}),undefined);
  assert.equal(action({key:'b',ctrlKey:true},{...edit,platform:'windows'}),'split');
  assert.equal(action({key:'b',metaKey:true},{...edit,platform:'windows'}),undefined);
  assert.equal(shortcutLabel('split',{},'mac'),'⌘B');
  assert.equal(shortcutLabel('split',{},'windows'),'Ctrl+B');
});
test('typing, IME, dialogs and already-handled events never edit the timeline',()=>{
  for(const key of ['b','s','q','w','Backspace','Delete',' ','ArrowLeft']){
    assert.equal(action({key},{...edit,editable:true}),undefined);
    assert.equal(action({key,isComposing:true}),undefined);
    assert.equal(action({key,keyCode:229}),undefined);
    assert.equal(action({key,defaultPrevented:true}),undefined);
    assert.equal(action({key,type:'keyup'}),undefined);
  }
  assert.equal(action({key:'b',metaKey:true},{...edit,modal:true}),undefined);
});
test('editable-target detection works for form, contenteditable and absent browser globals',()=>{
  const node=(hit:boolean,editable=false)=>({isContentEditable:editable,closest:()=>hit?{}:null}) as unknown as EventTarget;
  assert.equal(isEditableTarget(node(true)),true);
  assert.equal(isEditableTarget(node(false,true)),true);
  assert.equal(isEditableTarget(node(false)),false);
  assert.equal(isEditableTarget(null),false);
});
test('held navigation repeats while held cut/delete/play cannot duplicate mutations',()=>{
  assert.equal(action({key:'ArrowLeft',repeat:true}),'frameBackward');
  assert.equal(action({key:'=',metaKey:true,repeat:true}),'zoomIn');
  for(const event of [{key:'b'},{key:'b',metaKey:true},{key:'Delete'},{key:' '},{key:'s'}])assert.equal(action({...event,repeat:true}),undefined);
});
test('same keys resolve in their own scope; edit has no invented J playback binding',()=>{
  assert.equal(action({key:'ArrowLeft'}),'frameBackward');
  assert.equal(action({key:'ArrowLeft'},{scope:'take-preview',platform:'mac',modal:true}),'takeSeekBackward');
  assert.equal(action({key:'j'}),undefined);
  assert.equal(action({key:'j'},{scope:'take-preview',platform:'mac'}),'takeSlower');
  assert.equal(action({key:'b'},{scope:'script',platform:'mac'}),undefined);
  assert.equal(action({key:' '},{scope:'record',platform:'mac'}),undefined);
});
test('delete and shift-delete remain distinct on both physical delete keys',()=>{
  for(const key of ['Delete','Backspace']){
    assert.equal(action({key}),'deleteRipple');
    assert.equal(action({key,shiftKey:true}),'deleteLeaveGap');
    assert.equal(action({key,metaKey:true}),undefined);
  }
});
test('script splitting and boundary-backspace require an explicit script editor context',()=>{
  const script:ShortcutContext={scope:'script',platform:'mac',editable:true};
  assert.equal(action({key:'Enter',metaKey:true},script),undefined);
  assert.equal(action({key:'Enter',metaKey:true},{...script,scriptEditing:true}),'createSceneAtCursor');
  assert.equal(action({key:'Backspace'},{...script,scriptEditing:true}),'deleteOrMergeBackward');
  assert.equal(action({key:'Backspace'},{...edit,editable:true,scriptEditing:true}),undefined);
});
test('timeline gestures require their surface and exact modifiers',()=>{
  const context:ShortcutContext={...edit,surface:'timeline'};
  assert.equal(action({type:'wheel',altKey:true},context),'timelineScroll');
  assert.equal(action({type:'wheel',metaKey:true},context),'timelineZoom');
  assert.equal(action({type:'wheel',ctrlKey:true},context),'timelineZoom');
  assert.equal(action({type:'wheel',shiftKey:true},context),undefined);
  assert.equal(action({type:'wheel',metaKey:true}),undefined);
  assert.equal(action({type:'click',button:0,altKey:true},context),'selectInsideGroup');
  assert.equal(action({type:'click',button:2,altKey:true},context),undefined);
});
test('recorder shortcuts use physical codes and all three required modifiers',()=>{
  const context:ShortcutContext={scope:'recorder',platform:'mac'};
  const event={key:'r',code:'KeyR',ctrlKey:true,metaKey:true,shiftKey:true};
  assert.equal(action(event,context),'record');
  assert.equal(action({...event,key:'ф'},context),'record');
  assert.equal(action({...event,code:'KeyT'},context),'tryAgain');
  assert.equal(action({...event,shiftKey:false},context),undefined);
  assert.equal(action(event),undefined);
});
test('unimplemented handlers are not consumed and overrides replace defaults',()=>{
  assert.equal(action({key:'b',metaKey:true},{...edit,availableActions:['bladeTool']}),undefined);
  assert.equal(action({key:'b'},{...edit,availableActions:['bladeTool']}),'bladeTool');
  const custom=captureShortcut({key:'d',metaKey:true,shiftKey:true},'mac');
  assert.deepEqual(custom,{kind:'keyboard',key:'D',modifiers:['Mod','Shift']});
  assert.equal(action({key:'b',metaKey:true},edit,{split:[custom!]}),undefined);
  assert.equal(action({key:'D',metaKey:true,shiftKey:true},edit,{split:[custom!]}),'split');
  assert.equal(action({key:'b',metaKey:true},edit,{split:[]}),undefined);
  for(const event of [{key:'Meta'},{key:'Escape'},{key:'Dead'},{key:'d',repeat:true},{key:'d',isComposing:true}])assert.equal(captureShortcut(event,'mac'),null);
});
test('conflicts include app-wide/global commands but ignore unrelated contexts',()=>{
  const conflicts=(key:string,modifiers:('Mod'|'Control'|'Meta'|'Shift')[]=[])=>findShortcutConflicts('split',{kind:'keyboard',key,modifiers},{},'mac').map(d=>d.id);
  assert.deepEqual(conflicts('Z',['Mod']),['undo']);
  assert.deepEqual(conflicts('J'),[]);
  assert.deepEqual(conflicts('B'),['bladeTool']);
  assert.deepEqual(conflicts('R',['Control','Shift','Meta']),['record']);
});
test('persistence validates corrupt and untrusted storage and reports failed writes',()=>{
  let stored='';const storage={getItem:()=>stored||null,setItem:(_:string,value:string)=>{stored=value;}};
  assert.equal(saveShortcutOverrides({split:[{kind:'keyboard',key:'D',modifiers:['Mod']}]},storage),true);
  assert.equal(loadShortcutOverrides(storage).split?.[0].key,'D');
  stored='{';assert.deepEqual(loadShortcutOverrides(storage),{});
  stored=JSON.stringify({split:[{kind:'keyboard',key:'X',modifiers:['Mod','Surprise']}],bladeTool:[],hacked:[{key:'Q'}]});
  assert.deepEqual(loadShortcutOverrides(storage),{bladeTool:[]});
  assert.equal(saveShortcutOverrides({},{getItem:()=>null,setItem:()=>{throw new Error('disabled');}}),false);
  assert.equal(shortcutDefinitions.filter(d=>!d.extension).length,49);
});


test('gesture customization preserves input kind and rejects unusable keyboard overrides',()=>{
  assert.deepEqual(captureShortcut({type:'wheel',altKey:true},'mac'),{kind:'wheel',modifiers:['Alt']});
  assert.deepEqual(captureShortcut({type:'pointerdown',button:0,metaKey:true},'mac'),{kind:'pointer',button:0,modifiers:['Mod']});
  const stored=JSON.stringify({timelineZoom:[{kind:'keyboard',key:'D',modifiers:['Mod']}],split:[{kind:'wheel',modifiers:['Alt']}],timelineScroll:[{kind:'wheel',modifiers:['Shift']}]});
  const overrides=loadShortcutOverrides({getItem:()=>stored,setItem:()=>{}});
  assert.deepEqual(overrides,{timelineScroll:[{kind:'wheel',modifiers:['Shift']}]});
  assert.equal(action({type:'wheel',shiftKey:true},{...edit,surface:'timeline'},overrides),'timelineScroll');
  assert.equal(action({type:'wheel',altKey:true},{...edit,surface:'timeline'},overrides),undefined);
});
