import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const { captureDisplay, sourceMetadata, normalizedRect, cropMetadata, buildSelection, CaptureSelectionStore } = require('../desktop/capture-geometry.cjs');
const { createCaptureManager } = require('../desktop/capture.cjs');
const base = 'http://127.0.0.1:4174';
const physical = { id: 8, label: 'Left Retina', bounds: { x: -1512, y: -40, width: 1512, height: 982 }, scaleFactor: 2 };

test('capture geometry preserves negative global DIP bounds and maps normalized crop to local Retina pixels', () => {
 const display = captureDisplay(physical, 1);
 assert.deepEqual(display.bounds, physical.bounds);
 assert.deepEqual(display.pixelSize, { width: 3024, height: 1964 });
 const crop = cropMetadata({ x: .25, y: .25, width: .5, height: .5 }, display);
 assert.deepEqual(crop.dip, { x: 378, y: 245.5, width: 756, height: 491 });
 assert.deepEqual(crop.pixels, { x: 756, y: 491, width: 1512, height: 982 });
 assert.equal(display.primary, false);
});
test('capture geometry rejects invalid/outside/tiny rectangles and rounds shared edges consistently', () => {
 for (const rect of [{ x: NaN, y: 0, width: 1, height: 1 }, { x: -.1, y: 0, width: 1, height: 1 }, { x: .2, y: 0, width: .9, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }]) assert.throws(() => normalizedRect(rect));
 const display = captureDisplay({ ...physical, scaleFactor: 1.25 }, 8);
 assert.throws(() => cropMetadata({ x: 0, y: 0, width: .001, height: .1 }, display));
 const left = cropMetadata({ x: 0, y: 0, width: 1 / 3, height: 1 }, display), right = cropMetadata({ x: 1 / 3, y: 0, width: 2 / 3, height: 1 }, display);
 assert.equal(left.pixels.width, right.pixels.x);
 assert.equal(right.pixels.x + right.pixels.width, display.pixelSize.width);
});
test('display identity uses display_id, never source ordering or assumed scale/rotation', () => {
 const rotated = captureDisplay({ id: 3, bounds: { x: 0, y: 0, width: 1080, height: 1920 }, scaleFactor: 1, rotation: 90 }, 3);
 const left = captureDisplay(physical, 3);
 assert.equal(sourceMetadata({ id: 'screen:0:0', display_id: '8', name: 'Screen two' }, [rotated, left]).displayId, '8');
 const unmapped = sourceMetadata({ id: 'screen:1:0', display_id: '', name: 'Unknown display' }, [rotated, left]);
 assert.equal(unmapped.displayId, undefined);
 assert.throws(() => buildSelection(unmapped, [rotated, left], 'region', { x: 0, y: 0, width: 1, height: 1 }));
 assert.throws(() => buildSelection(unmapped, [rotated, left], 'window'));
 assert.deepEqual(rotated.pixelSize, { width: 1080, height: 1920 });
});
test('capture authorization is owner-bound, one-use, expires, and cancellation leaves a denial tombstone', () => {
 let now = 100; const store = new CaptureSelectionStore(() => now), owner = {}, other = {};
 const first = store.arm({ sourceId: 'screen:1' }, owner);
 assert.equal(store.consume(other), null); assert.equal(store.consume(owner).token, first.token); assert.equal(store.consume(owner), null);
 store.arm({ sourceId: 'window:2' }, owner); now += 60001; assert.equal(store.hasAttempt(owner), true); assert.equal(store.consume(owner), null);
 const current = store.arm({ sourceId: 'screen:3' }, owner); store.cancel(first.token); assert.equal(store.consume(owner).token, current.token);
 store.arm({ sourceId: 'screen:3' }, owner); store.cancel(); assert.equal(store.hasAttempt(owner), true); assert.equal(store.consume(owner), null);
});

function setup(options:{inventoryTimeoutMs?:number}={}) {
 const handlers = new Map<string, (...args: any[]) => any>(), windows: any[] = [], calls: any[] = [];
 const mainFrame = { url: base + '/' };
 const main = { isDestroyed: () => false, webContents: { mainFrame } };
 const state = { displays: [physical, { id: 3, label: 'Main', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }], sources: [{ id: 'screen:8:0', name: 'Left Retina', display_id: '8' }, ...Array.from({ length: 24 }, (_, i) => ({ id: `window:${i}:0`, name: `Window ${i}`, display_id: '' }))], beforeSources: null as null | (() => Promise<void>), screenStatus: 'granted' };
 const screen = Object.assign(new EventEmitter(), { getAllDisplays: () => state.displays, getPrimaryDisplay: () => state.displays[1] });
 class Window extends EventEmitter {
  options: any; dead = false; bounds: any; visible = false;
  webContents: any = Object.assign(new EventEmitter(), { mainFrame: { url: '' }, setWindowOpenHandler: () => {} });
  constructor(options: any) { super(); this.options = options; windows.push(this); }
  isDestroyed() { return this.dead; }
  destroy() { this.dead = true; this.emit('closed'); }
  setMenu() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} focus() {}
  setBounds(value: any) { this.bounds = value; } getContentBounds() { return this.bounds; } show() { this.visible = true; }
  async loadURL(url: string) { this.webContents.mainFrame.url = url; this.emit('ready-to-show'); }
 }
 const manager = createCaptureManager({ BrowserWindow: Window, desktopCapturer: { getSources: async (options: any) => { calls.push(options); await state.beforeSources?.(); return state.sources; } }, screen, ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn), removeHandler: (name: string) => handlers.delete(name) }, session: { fromPartition: () => ({ setPermissionRequestHandler: () => {} }) }, systemPreferences: { getMediaAccessStatus: (kind: string) => { assert.equal(kind, 'screen'); return state.screenStatus; } }, getMainWindow: () => main, origin: base, ...options });
 const event = { sender: main.webContents, senderFrame: mainFrame };
 const uiEvent = () => ({ sender: windows.at(-1).webContents, senderFrame: windows.at(-1).webContents.mainFrame });
 const request = { frame: mainFrame, videoRequested: true, audioRequested: false, userGesture: false };
 const response = async (extra = {}) => { const results: any[] = []; await manager.handleRequest({ ...request, ...extra }, (result: any) => results.push(result)); assert.equal(results.length, 1); return results[0]; };
 const finish = (value: any) => handlers.get('capture-ui-finish')!(uiEvent(), value);
 return { manager, event, handlers, windows, calls, state, screen, mainFrame, uiEvent, response, finish };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('source enumeration failure reports actual permission status without granting access or falling back', async () => {
 const h = setup(); try {
  h.state.beforeSources = async () => { throw new Error('Failed to get sources.'); };
  for (const [status, message] of [['denied', /access is off for this build/], ['restricted', /restricted on this Mac/], ['not-determined', /not been granted yet/], ['granted', /reports screen access is allowed/], ['unknown', /could not load/]] as const) {
   h.state.screenStatus = status;
   await assert.rejects(h.manager.list(h.event), (error: Error) => message.test(error.message) && !error.message.includes('Failed to get sources'));
   assert.equal(h.windows.length, 0);
  }
  assert.equal(await h.response(), null);
  h.state.beforeSources = null; h.state.screenStatus = 'granted';
  assert.equal((await h.manager.list(h.event)).sources.length, 25);
 } finally { h.manager.dispose(); }
});

test('native sources include every window without thumbnails and reject untrusted subframes', async () => {
 const h = setup(); try {
  const list = await h.manager.list(h.event); assert.equal(list.sources.length, 25); assert.equal(list.sources.at(-1).label, 'Window 23');
  assert.deepEqual(h.calls[0], { types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  await assert.rejects(h.manager.list({ ...h.event, senderFrame: { url: base + '/' } }), /Untrusted/);
  assert.equal(await h.response({ frame: { url: base + '/' } }), null);
  assert.equal(await h.response({ frame: null }), null);
 } finally { h.manager.dispose(); }
});
test('native capture consumes the exact selected window once and refuses disappearance', async () => {
 const h = setup(); try {
  await h.manager.choose(h.event, { sourceId: 'window:23:0', mode: 'window' });
  const result = await h.response({ audioRequested: true }); assert.equal(result.video.id, 'window:23:0'); assert.equal(result.audio, 'loopback');
  assert.equal(await h.response(), null);
  await h.manager.choose(h.event, { sourceId: 'window:22:0', mode: 'window' }); h.state.sources = h.state.sources.filter(s => s.id !== 'window:22:0');
  assert.equal(await h.response(), null); assert.equal(h.windows.length, 0);
 } finally { h.manager.dispose(); }
});
test('region overlay uses exact negative DIP display bounds and returns normalized crop after closing', async () => {
 const h = setup(); try {
  const selecting = h.manager.choose(h.event, { sourceId: 'screen:8:0', mode: 'region', initialRegion: { x: .2, y: .3, width: .5, height: .4 } }); await tick();
  const overlay = h.windows[0]; assert.equal(overlay.options.x, -1512); assert.equal(overlay.options.y, -40); assert.deepEqual(overlay.bounds, physical.bounds);
  assert.equal(overlay.options.webPreferences.sandbox, true); assert.equal(overlay.options.webPreferences.nodeIntegration, false);
  const data = h.handlers.get('capture-ui-data')!(h.uiEvent()); assert.equal(data.display.id, '8'); assert.equal(data.initialRegion.x, .2);
  assert.throws(() => h.handlers.get('capture-ui-finish')!({ sender: h.event.sender, senderFrame: h.event.senderFrame }, {}), /Untrusted/);
  const rect = { x: .1, y: .2, width: .6, height: .5 }; h.finish(rect);
  const selected = await selecting; assert.equal(overlay.dead, true); assert.deepEqual(selected.crop.normalized, rect); assert.equal(selected.kind, 'region');
  assert.equal((await h.response()).video.id, 'screen:8:0');
 } finally { h.manager.dispose(); }
});
test('region cancel, renderer reset, and display hotplug deny capture without opening another picker', async () => {
 const h = setup(); try {
  let selecting = h.manager.choose(h.event, { sourceId: 'screen:8:0', mode: 'region' }); await tick(); h.finish(null); assert.equal(await selecting, null);
  selecting = h.manager.choose(h.event, { sourceId: 'screen:8:0', mode: 'region' }); await tick(); h.screen.emit('display-removed'); assert.equal(await selecting, null); assert.equal(h.windows.at(-1).dead, true);
  const selected = await h.manager.choose(h.event, { sourceId: 'screen:8:0', mode: 'display' }); h.manager.cancel(h.event, selected.token);
  const count = h.windows.length; assert.equal(await h.response({ userGesture: true }), null); assert.equal(h.windows.length, count);
  await h.manager.choose(h.event, { sourceId: 'screen:8:0', mode: 'display' }); h.manager.reset(); assert.equal(await h.response({ userGesture: true }), null);
 } finally { h.manager.dispose(); }
});
test('unarmed trusted user gesture opens uncapped source picker; cancellation denies exactly once', async () => {
 const h = setup(); try {
  const result = h.response({ userGesture: true }); await tick();
  assert.equal(h.handlers.get('capture-ui-data')!(h.uiEvent()).sources.length, 25);
  h.finish({ sourceId: 'window:23:0', mode: 'window' }); assert.equal((await result).video.id, 'window:23:0');
  const canceled = h.response({ userGesture: true }); await tick(); h.finish(null); assert.equal(await canceled, null);
 } finally { h.manager.dispose(); }
});
test('display metrics changes and stale inventory never arm or capture an outdated source', async () => {
 const h = setup(); try {
  const selecting = h.manager.choose(h.event, { sourceId: 'screen:8:0', mode: 'region' }); await tick();
  h.state.displays[0] = { ...physical, scaleFactor: 1 }; h.finish({ x: 0, y: 0, width: 1, height: 1 }); await assert.rejects(selecting, /display changed/);
  let release!: () => void; h.state.beforeSources = () => new Promise<void>(resolve => { release = resolve; });
  const stale = h.manager.choose(h.event, { sourceId: 'window:1:0', mode: 'window' }); h.manager.reset(); release(); assert.equal(await stale, null);
  h.state.beforeSources = null; assert.equal(await h.response(), null);
 } finally { h.manager.dispose(); }
});

async function within<T>(promise:Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('desktop capture waiter did not settle')),300);})]);}finally{clearTimeout(timer!);}}
test('granted source enumeration times out and retry remains available without fallback',async()=>{
 const h=setup({inventoryTimeoutMs:15});try{h.state.beforeSources=()=>new Promise(()=>{});await assert.rejects(within(h.manager.list(h.event)),/list did not respond/);assert.equal(h.windows.length,0);h.state.beforeSources=null;assert.equal((await h.manager.list(h.event)).sources.length,25);}finally{h.manager.dispose();}
});
test('confirmed source callback denies exactly once after an inventory timeout, including late completion',async()=>{
 const h=setup({inventoryTimeoutMs:15});try{await h.manager.choose(h.event,{sourceId:'screen:8:0',mode:'display'});let release!:()=>void;h.state.beforeSources=()=>new Promise(resolve=>{release=resolve;});const results:any[]=[];await within(h.manager.handleRequest({frame:h.mainFrame,videoRequested:true,audioRequested:true,userGesture:false},(value:any)=>results.push(value)));assert.deepEqual(results,[null]);release();await tick();assert.deepEqual(results,[null]);assert.equal(h.windows.length,0);}finally{h.manager.dispose();}
});
test('cancelling the consumed selection settles a hung callback before inventory returns',async()=>{
 const h=setup();try{const selected=await h.manager.choose(h.event,{sourceId:'screen:8:0',mode:'display'});let release!:()=>void;h.state.beforeSources=()=>new Promise(resolve=>{release=resolve;});const pending=h.response();h.manager.cancel(h.event,'different-token');h.manager.cancel(h.event,selected.token);assert.equal(await within(pending),null);release();await tick();}finally{h.manager.dispose();}
});
test('reset settles a pending source selection without needing native enumeration to finish',async()=>{
 const h=setup();try{h.state.beforeSources=()=>new Promise(()=>{});const pending=h.manager.choose(h.event,{sourceId:'window:1:0',mode:'window'});h.manager.reset();assert.equal(await within(pending),null);assert.equal(h.windows.length,0);}finally{h.manager.dispose();}
});
test('initial undetermined permission enumeration has no arbitrary deadline but can be cancelled',async()=>{
 const h=setup({inventoryTimeoutMs:10});try{h.state.screenStatus='not-determined';h.state.beforeSources=()=>new Promise(()=>{});let settled=false;const pending=h.manager.choose(h.event,{sourceId:'window:1:0',mode:'window'}).finally(()=>{settled=true;});await new Promise(resolve=>setTimeout(resolve,30));assert.equal(settled,false);h.manager.reset();assert.equal(await within(pending),null);}finally{h.manager.dispose();}
});
