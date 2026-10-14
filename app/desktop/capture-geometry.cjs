'use strict';
const { randomUUID } = require('node:crypto');

function finiteRect(rect) {
 return !!rect && ['x','y','width','height'].every(key => typeof rect[key] === 'number' && Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0;
}
function normalizedRect(rect) {
 if (!finiteRect(rect) || rect.x < 0 || rect.y < 0 || rect.x + rect.width > 1 + 1e-9 || rect.y + rect.height > 1 + 1e-9) throw new Error('The region must fit inside the selected display.');
 return { x: rect.x, y: rect.y, width: Math.min(rect.width, 1 - rect.x), height: Math.min(rect.height, 1 - rect.y) };
}
function captureDisplay(display, primaryId) {
 if (!finiteRect(display.bounds) || !Number.isFinite(display.scaleFactor) || display.scaleFactor <= 0) throw new Error('The display has invalid dimensions.');
 const bounds = { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height };
 return { id: String(display.id), label: display.label || `Display ${display.id}`, bounds, scaleFactor: display.scaleFactor, pixelSize: { width: Math.round(bounds.width * display.scaleFactor), height: Math.round(bounds.height * display.scaleFactor) }, primary: String(display.id) === String(primaryId) };
}
function sourceMetadata(source, displays) {
 const kind = source.id.startsWith('screen:') ? 'display' : source.id.startsWith('window:') ? 'window' : null;
 if (!kind) return null;
 // Electron's source display_id is authoritative. Source order is not display order.
 const display = kind === 'display' ? displays.find(d => d.id === source.display_id) : undefined;
 return { id: source.id, kind, label: source.name || (display?.label ?? 'Untitled window'), ...(display ? { displayId: display.id } : {}) };
}
function cropMetadata(rect, display) {
 const normalized = normalizedRect(rect);
 const { width, height } = display.bounds;
 const dip = { x: normalized.x * width, y: normalized.y * height, width: normalized.width * width, height: normalized.height * height };
 if (dip.width < 16 || dip.height < 16) throw new Error('Select a region at least 16 points wide and high.');
 const size = display.pixelSize;
 const left = Math.round(normalized.x * size.width), top = Math.round(normalized.y * size.height);
 const right = Math.min(size.width, Math.round((normalized.x + normalized.width) * size.width));
 const bottom = Math.min(size.height, Math.round((normalized.y + normalized.height) * size.height));
 return { normalized, dip, pixels: { x: left, y: top, width: right - left, height: bottom - top }, sourcePixelSize: { ...size } };
}
function buildSelection(source, displays, mode, region) {
 if (!source || !['display','window','region'].includes(mode) || (mode === 'window') !== (source.kind === 'window')) throw new Error('Choose a matching screen or window source.');
 const display = displays.find(d => d.id === source.displayId);
 if (mode === 'region' && !display) throw new Error('This source cannot be mapped to an attached display. Choose another display.');
 return { sourceId: source.id, kind: mode, label: source.label, ...(display ? { displayId: display.id, displayBounds: { ...display.bounds }, scaleFactor: display.scaleFactor } : {}), ...(mode === 'region' ? { crop: cropMetadata(region, display) } : {}) };
}
function sameDisplay(a, b) {
 return !!a && !!b && a.id === b.id && a.scaleFactor === b.scaleFactor && ['x','y','width','height'].every(k => a.bounds[k] === b.bounds[k]);
}
class CaptureSelectionStore {
 constructor(now = Date.now) { this.now = now; this.pending = null; }
 arm(selection, owner) { const result = { ...selection, token: randomUUID() }; this.pending = { result, owner, expires: this.now() + 60000 }; return result; }
 hasAttempt(owner) { return this.pending?.owner === owner; }
 consume(owner) { const pending = this.pending; if (!pending || pending.owner !== owner) return null; this.pending = null; return pending.expires > this.now() ? pending.result : null; }
 // Keep a one-use tombstone: a canceled/expired explicit selection must not open
 // another picker and accidentally pair a different source with the old crop.
 cancel(token) { if (this.pending && (token === undefined || this.pending.result?.token === token)) this.pending = { ...this.pending, result: null }; }
}
module.exports = { finiteRect, normalizedRect, captureDisplay, sourceMetadata, cropMetadata, buildSelection, sameDisplay, CaptureSelectionStore };
