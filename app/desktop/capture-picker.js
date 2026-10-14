'use strict';
document.getElementById('cancel').addEventListener('click', () => window.capturePicker.cancel());
window.capturePicker.getData().then(data => {
 const main = document.getElementById('sources'); main.replaceChildren();
 for (const kind of ['display', 'window']) {
  const section = document.createElement('section'), heading = document.createElement('h2');
  heading.textContent = kind === 'display' ? 'Displays' : 'Windows'; section.append(heading);
  const list = document.createElement('div'); list.className = 'source-list';
  for (const source of data.sources.filter(source => source.kind === kind)) {
   const button = document.createElement('button'); button.className = 'source-item';
   const label = document.createElement('strong'); label.textContent = source.label; button.append(label);
   const display = data.displays.find(display => display.id === source.displayId);
   const detail = document.createElement('span');
   detail.textContent = display ? `${display.bounds.width} × ${display.bounds.height} points${display.primary ? ' · Main display' : ''}` : kind === 'display' ? 'Entire display' : 'This window only';
   button.append(detail); button.addEventListener('click', () => { for (const item of main.querySelectorAll('button')) item.disabled = true; window.capturePicker.finish({ sourceId: source.id, mode: kind }).catch(() => { for (const item of main.querySelectorAll('button')) item.disabled = false; }); });
   list.append(button);
  }
  if (!list.childElementCount) { const empty = document.createElement('p'); empty.textContent = `No ${kind === 'display' ? 'displays' : 'windows'} available. Check Screen Recording in System Settings.`; list.append(empty); }
  section.append(list); main.append(section);
 }
 main.querySelector('button')?.focus();
}).catch(() => { document.getElementById('sources').textContent = 'Sources could not be loaded. Close this picker and try again.'; });
