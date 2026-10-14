'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { captureDisplay, sourceMetadata, normalizedRect, buildSelection, sameDisplay, CaptureSelectionStore } = require('./capture-geometry.cjs');

function createCaptureManager({ BrowserWindow, desktopCapturer, screen, ipcMain, session, systemPreferences, getMainWindow, origin, inventoryTimeoutMs = 15000 }) {
 const store = new CaptureSelectionStore();
 let epoch = 0, popup = null, disposed = false;
 let lifetime = new AbortController();
 const requests = new Set();
 const isTrustedFrame = frame => {
  const window = getMainWindow();
  if (!frame || !window || window.isDestroyed() || frame !== window.webContents.mainFrame) return false;
  try { return new URL(frame.url).origin === origin; } catch { return false; }
 };
 const verify = event => { if (event.sender !== getMainWindow()?.webContents || !isTrustedFrame(event.senderFrame)) throw new Error('Untrusted capture request.'); };
 const displayList = () => screen.getAllDisplays().map(d => captureDisplay(d, screen.getPrimaryDisplay().id));
 const screenPermission = () => { try { return systemPreferences?.getMediaAccessStatus('screen') || 'unknown'; } catch { return 'unknown'; } };
 function waitForInventory(promise, signal, bounded) {
  return new Promise((resolve, reject) => {
   let settled = false, timer;
   const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(value); };
   const abort = () => finish(Object.assign(new Error('Capture selection was cancelled.'), { name: 'AbortError' }));
   signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
   if (!settled && bounded) timer = setTimeout(() => finish(Object.assign(new Error('The screen and window list did not respond. Try again, or quit and reopen SceneForge.'), { name: 'TimeoutError' })), inventoryTimeoutMs);
   // Electron does not expose cancellation for getSources; ignore any late result.
   promise.then(value => finish(null, value), error => finish(error));
  });
 }
 async function inventory({ signal = lifetime.signal, afterSelection = false } = {}) {
  signal.throwIfAborted();
  const displays = displayList();
  // Zero-size thumbnails avoid capturing or transmitting unselected screen/window images.
  let raw;
  try { raw = await waitForInventory(desktopCapturer.getSources({ types: ['screen','window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }), signal, afterSelection || screenPermission() === 'granted'); }
  catch (cause) {
   if (cause?.name === 'AbortError' || cause?.name === 'TimeoutError') throw cause;
   const status = screenPermission();
   const message = status === 'denied'
    ? 'Screen recording access is off for this build. Open Mac setup, allow SceneForge in Screen & System Audio Recording, then quit and reopen SceneForge.'
    : status === 'restricted'
     ? 'Screen recording is restricted on this Mac. Open Mac setup to review access; a device administrator may need to allow it.'
     : status === 'not-determined'
      ? 'Screen recording permission has not been granted yet. Open Mac setup to review access and respond to the macOS request, then try again.'
      : status === 'granted'
       ? 'macOS reports screen access is allowed, but the screen and window list could not load. Quit and reopen SceneForge, then try again. Open Mac setup if access still fails.'
       : 'The screen and window list could not load. Open Mac setup to check screen recording access, then quit and reopen SceneForge and try again.';
   throw new Error(message, { cause });
  }
  return { displays, raw, sources: raw.map(source => sourceMetadata(source, displays)).filter(Boolean) };
 }
 function cancel(token) {
  if (token !== undefined) { store.cancel(token); for (const request of requests) if (request.token === token) request.controller.abort(); return; }
  epoch++; store.cancel(); lifetime.abort(); lifetime = new AbortController();
  for (const request of requests) request.controller.abort();
  popup?.finish(null);
 }
 function verifyPopup(event) {
  if (!popup || popup.window.isDestroyed() || event.sender !== popup.window.webContents || event.senderFrame !== popup.window.webContents.mainFrame || event.senderFrame.url !== popup.url) throw new Error('Untrusted capture picker.');
  return popup;
 }
 const uiData = event => verifyPopup(event).data;
 const uiFinish = (event, value) => { verifyPopup(event).finish(value); };
 ipcMain.handle('capture-ui-data', uiData);
 ipcMain.handle('capture-ui-finish', uiFinish);

 function openPopup(kind, data, display) {
  popup?.finish(null);
  return new Promise((resolve, reject) => {
   const region = kind === 'region';
   const filename = path.join(__dirname, region ? 'capture-region.html' : 'capture-picker.html');
   const url = pathToFileURL(filename).href;
   const captureSession = session.fromPartition('sceneforge-capture-ui');
   captureSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
   const options = region ? { ...display.bounds, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, enableLargerThanScreen: true, acceptFirstMouse: true } : { width: 720, height: 600, minWidth: 520, minHeight: 400, parent: getMainWindow(), modal: true, title: 'Choose what to record', backgroundColor: '#fafafa' };
   const window = new BrowserWindow({ ...options, show: false, webPreferences: { preload: path.join(__dirname, 'capture-preload.cjs'), session: captureSession, contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false } });
   let value = null, failure = null, settled = false;
   const timeout = setTimeout(() => finish(null), 5 * 60 * 1000);
   const finish = result => { if (settled) return; value = result; if (!window.isDestroyed()) window.destroy(); else complete(); };
   const complete = () => { if (settled) return; settled = true; clearTimeout(timeout); if (popup?.window === window) popup = null; if (failure) reject(failure); else resolve(value); };
   popup = { window, data, url, finish };
   window.once('closed', complete);
   window.webContents.on('render-process-gone', () => finish(null));
   window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
   window.webContents.on('will-navigate', event => event.preventDefault());
   window.webContents.on('will-attach-webview', event => event.preventDefault());
   window.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); finish(null); } });
   window.setMenu(null);
   if (region) {
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
   }
   window.once('ready-to-show', () => {
    if (window.isDestroyed()) return;
    if (region) {
     window.setBounds(display.bounds);
     const actual = window.getContentBounds();
     if (['x','y','width','height'].some(key => Math.abs(actual[key] - display.bounds[key]) > .5)) {
      failure = new Error('The region selector could not cover this display accurately. Try another display or record the full display.'); finish(null); return;
     }
    }
    window.show(); window.focus();
   });
   window.loadURL(url).catch(error => { failure = error; finish(null); });
  });
 }
 async function select(options, frame, arm) {
  if (disposed || !isTrustedFrame(frame)) throw new Error('The capture window is no longer available.');
  cancel(); const current = epoch;
  const fresh = () => current === epoch && !disposed && isTrustedFrame(frame);
  let list;
  try { list = await inventory(); } catch (error) { if (!fresh()) return null; throw error; }
  if (!fresh()) return null;
  if (!options) {
   options = await openPopup('sources', { sources: list.sources, displays: list.displays });
   if (!options || !fresh()) return null;
  }
  if (typeof options !== 'object' || typeof options.sourceId !== 'string' || !['display','window','region'].includes(options.mode)) throw new Error('Invalid capture selection.');
  const source = list.sources.find(source => source.id === options.sourceId);
  if (!source) throw new Error('That screen or window is no longer available. Choose it again.');
  const display = list.displays.find(display => display.id === source.displayId);
  let region;
  if (options.mode === 'region') {
   if (!display || source.kind !== 'display') throw new Error('Choose an attached display for a region.');
   const initialRegion = options.initialRegion ? normalizedRect(options.initialRegion) : { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
   region = await openPopup('region', { display, initialRegion }, display);
   if (!region || !fresh()) return null;
  }
  const selected = buildSelection(source, list.displays, options.mode, region);
  // Re-enumeration catches closed windows and display changes while the picker was open.
  try { list = await inventory({ afterSelection: true }); } catch (error) { if (!fresh()) return null; throw error; }
  if (!fresh()) return null;
  if (!list.sources.some(s => s.id === source.id)) throw new Error('That screen or window closed before capture started.');
  if (display && !sameDisplay(display, list.displays.find(d => d.id === display.id))) throw new Error('The display changed. Please choose your capture area again.');
  return arm ? store.arm(selected, frame) : { ...selected, token: randomUUID() };
 }
 async function restore(saved, frame) {
  if (disposed || !isTrustedFrame(frame)) throw new Error('The capture window is no longer available.');
  // This path never opens a picker or asks macOS for a new grant. A prior
  // source choice may be resumed only while the existing grant is valid.
  if (screenPermission() !== 'granted') throw new Error('Screen preview needs existing screen recording access. Check Mac setup, then choose your screen.');
  if (!saved || typeof saved !== 'object' || typeof saved.sourceId !== 'string' || saved.sourceId.length > 256 || typeof saved.label !== 'string' || saved.label.length > 2048 || !['display','window','region'].includes(saved.kind)) throw new Error('Choose a screen or window to restore its preview.');
  cancel(); const current = epoch;
  const fresh = () => current === epoch && !disposed && isTrustedFrame(frame);
  let list;
  try { list = await inventory({ afterSelection: true }); } catch (error) { if (!fresh()) return null; throw error; }
  if (!fresh()) return null;
  if (screenPermission() !== 'granted') throw new Error('Screen recording access changed. Check Mac setup before restoring the preview.');
  const source = list.sources.find(source => source.id === saved.sourceId);
  if (!source || source.label !== saved.label || (source.kind === 'window') !== (saved.kind === 'window')) throw new Error('The previously selected screen or window is no longer available. Choose a source again.');
  if (source.kind === 'display') {
   const display = list.displays.find(display => display.id === source.displayId);
   if (!display || !sameDisplay({ id:saved.displayId, bounds:saved.displayBounds || {}, scaleFactor:saved.scaleFactor }, display)) throw new Error('The display arrangement changed. Choose your capture area again.');
  }
  const selected = buildSelection(source, list.displays, saved.kind, saved.kind === 'region' ? saved.crop?.normalized : undefined);
  return store.arm(selected, frame);
 }
 async function handleRequest(request, callback) {
  let done = false;
  let pending;
  const reply = value => { if (!done) { done = true; callback(value); } };
  try {
   if (!isTrustedFrame(request.frame) || !request.videoRequested) return reply(null);
   const explicitAttempt = store.hasAttempt(request.frame);
   let selection = store.consume(request.frame);
   if (explicitAttempt && !selection) return reply(null);
   if (!selection) {
    if (!request.userGesture) return reply(null);
    selection = await select(null, request.frame, false);
   }
   if (!selection || !isTrustedFrame(request.frame)) return reply(null);
   const current = epoch;
   pending = { token: selection.token, controller: new AbortController() }; requests.add(pending);
   const list = await inventory({ signal: pending.controller.signal, afterSelection: true });
   if (pending.controller.signal.aborted || current !== epoch || !isTrustedFrame(request.frame)) return reply(null);
   const source = list.raw.find(source => source.id === selection.sourceId);
   if (!source) return reply(null);
   if (selection.displayId) {
    const display = list.displays.find(d => d.id === selection.displayId);
    if (!display || display.scaleFactor !== selection.scaleFactor || ['x','y','width','height'].some(key => display.bounds[key] !== selection.displayBounds[key])) return reply(null);
   }
   reply({ video: source, ...(request.audioRequested ? { audio: 'loopback' } : {}) });
  } catch { reply(null); }
  finally { if (pending) requests.delete(pending); }
 }
 const onDisplaysChanged = () => cancel();
 screen.on('display-added', onDisplaysChanged);
 screen.on('display-removed', onDisplaysChanged);
 screen.on('display-metrics-changed', onDisplaysChanged);
 return {
  async list(event) { verify(event); const { displays, sources } = await inventory(); verify(event); return { displays, sources }; },
  choose(event, options) { verify(event); return select(options, event.senderFrame, true); },
  restore(event, saved) { verify(event); return restore(saved, event.senderFrame); },
  cancel(event, token) { verify(event); if (token !== undefined && typeof token !== 'string') throw new Error('Invalid capture token.'); cancel(token); },
  handleRequest,
  reset: () => cancel(),
  dispose() { disposed = true; cancel(); for (const name of ['display-added','display-removed','display-metrics-changed']) screen.removeListener(name, onDisplaysChanged); ipcMain.removeHandler('capture-ui-data'); ipcMain.removeHandler('capture-ui-finish'); }
 };
}
module.exports = { createCaptureManager };
