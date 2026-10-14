'use strict';
const surface = document.getElementById('surface'), box = document.getElementById('region'), sizeLabel = document.getElementById('dimensions'), confirm = document.getElementById('confirm');
let rect = null, drag = null, display = null;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const point = event => ({ x: clamp(event.clientX / innerWidth, 0, 1), y: clamp(event.clientY / innerHeight, 0, 1) });
function paint() {
 if (!rect) return;
 Object.assign(box.style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });
 const width = Math.round(rect.width * display.bounds.width), height = Math.round(rect.height * display.bounds.height);
 sizeLabel.textContent = `${width} × ${height} points`; confirm.disabled = width < 16 || height < 16;
}
surface.addEventListener('pointerdown', event => {
 if (!rect || event.button !== 0 || event.isPrimary === false) return;
 if (drag) { if (!drag.captureLost || event.pointerId !== drag.pointerId) return; endDrag(null, true); }
 event.preventDefault(); const start = point(event), handle = event.target.dataset.handle;
 drag = { pointerId: event.pointerId, start, rect: { ...rect }, mode: handle || (event.target === box || box.contains(event.target) ? 'move' : 'draw') };
 // Keep the last selection until movement arrives; a focus click must not erase it.
 try { surface.setPointerCapture(event.pointerId); } catch { /* Document listeners retain an in-window drag. */ }
 paint(); box.focus({ preventScroll: true });
});
function updateDrag(event) {
 if (!drag || event.pointerId !== drag.pointerId) return;
 const p = point(event), original = drag.rect, dx = p.x - drag.start.x, dy = p.y - drag.start.y;
 const minW = Math.min(16 / display.bounds.width, 1), minH = Math.min(16 / display.bounds.height, 1);
 if (drag.mode === 'move') rect = { ...original, x: clamp(original.x + dx, 0, 1 - original.width), y: clamp(original.y + dy, 0, 1 - original.height) };
 else if (drag.mode === 'draw') rect = { x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y), width: Math.abs(p.x - drag.start.x), height: Math.abs(p.y - drag.start.y) };
 else {
  let left = original.x, top = original.y, right = original.x + original.width, bottom = original.y + original.height;
  if (drag.mode.includes('w')) left = clamp(original.x + dx, 0, right - minW);
  if (drag.mode.includes('e')) right = clamp(right + dx, left + minW, 1);
  if (drag.mode.includes('n')) top = clamp(original.y + dy, 0, bottom - minH);
  if (drag.mode.includes('s')) bottom = clamp(bottom + dy, top + minH, 1);
  rect = { x: left, y: top, width: right - left, height: bottom - top };
 }
 paint();
}
function endDrag(event, cancelled = false) {
 if (!drag || (event && event.pointerId !== drag.pointerId)) return;
 const previous = drag;
 // The release position is authoritative even if intermediate moves were coalesced or lost.
 if (!cancelled && event) updateDrag(event);
 if (cancelled || (previous.mode === 'draw' && (!rect.width || !rect.height))) rect = previous.rect;
 drag = null;
 if (surface.hasPointerCapture(previous.pointerId)) surface.releasePointerCapture(previous.pointerId);
 paint();
}
// Capture at document level so crossing the floating toolbar does not lose the release.
document.addEventListener('pointermove', updateDrag, true);
document.addEventListener('pointerup', event => endDrag(event), true);
document.addEventListener('pointercancel', event => endDrag(event, true), true);
// Native capture can be lost before the final move/up is delivered. Document listeners
// still own that drag; cancel only on an actual cancellation or window focus loss.
surface.addEventListener('lostpointercapture', event => { if (drag && event.pointerId === drag.pointerId) drag.captureLost = true; });
window.addEventListener('blur', () => endDrag(null, true));
box.addEventListener('keydown', event => {
 if (!rect || !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;
 event.preventDefault(); const step = event.shiftKey ? 10 : 1;
 rect.x = clamp(rect.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0) / display.bounds.width, 0, 1 - rect.width);
 rect.y = clamp(rect.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) / display.bounds.height, 0, 1 - rect.height); paint();
});
function finish() { if (drag || !rect || confirm.disabled) return; confirm.disabled = true; window.capturePicker.finish(rect).catch(() => { document.getElementById('region-error').textContent = 'The region could not be selected. Please cancel and try again.'; }); }
confirm.addEventListener('click', finish);
document.getElementById('full-display').addEventListener('click', () => { if (display) { endDrag(null, true); rect = { x: 0, y: 0, width: 1, height: 1 }; paint(); box.focus(); } });
document.getElementById('cancel').addEventListener('click', () => window.capturePicker.cancel());
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.capturePicker.cancel(); if (event.key === 'Enter' && event.target === box) finish(); });
window.capturePicker.getData().then(data => { display = data.display; rect = data.initialRegion; document.getElementById('display-label').textContent = display.label; paint(); box.focus(); }).catch(() => { document.getElementById('region-error').textContent = 'This display is no longer available. Press Escape to close.'; });
