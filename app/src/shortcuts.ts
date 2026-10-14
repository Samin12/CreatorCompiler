/** Independent shortcut model, derived from Borumi 0.32.0's macOS catalog.
 * Supported behavior and limits: docs/SHORTCUTS.md.
 */
export type ShortcutPlatform = 'mac' | 'windows' | 'linux';
export type ShortcutScope = 'app' | 'script' | 'record' | 'recorder' | 'edit' | 'take-preview' | 'workflow-review';
export type ShortcutModifier = 'Mod' | 'Meta' | 'Control' | 'Alt' | 'Shift';
export interface ShortcutBinding {
  kind: 'keyboard' | 'wheel' | 'pointer';
  key?: string;
  code?: string;
  modifiers: ShortcutModifier[];
  button?: number;
}
export type ShortcutAction =
  | 'undo' | 'redo' | 'copy' | 'paste' | 'cut' | 'selectAll' | 'deselectAll'
  | 'workflowPlay' | 'takePlay' | 'takeSeekBackward' | 'takeSeekForward' | 'takeSlower' | 'takePauseReset' | 'takeFaster' | 'takeClose'
  | 'playPause' | 'pauseReset' | 'playFaster' | 'selectTool' | 'bladeTool' | 'frameBackward' | 'frameForward' | 'previousEdit' | 'nextEdit'
  | 'zoomOut' | 'zoomIn' | 'deleteRipple' | 'deleteLeaveGap' | 'split' | 'trimLeft' | 'trimRight' | 'toggleSnapping' | 'toggleScrubbing'
  | 'timelineScroll' | 'timelineZoom' | 'selectInsideGroup' | 'createSceneAtCursor' | 'deleteOrMergeBackward' | 'recordingPresets'
  | 'closeProject' | 'quit' | 'record' | 'tryAgain' | 'stopRecord' | 'pauseRecord' | 'previousSentence' | 'nextSentence' | 'previousWord' | 'nextWord'
  | 'saveProject' | 'toggleWaveforms';
export interface ShortcutDefinition {
  id: ShortcutAction;
  label: string;
  scope: ShortcutScope;
  bindings: ShortcutBinding[];
  description: string;
  availability: 'renderer' | 'native' | 'global' | 'contextual';
  surface?: 'timeline' | 'transcript';
  repeat?: boolean;
  editable?: 'script' | 'any';
  extension?: boolean;
}
const key = (key: string, ...modifiers: ShortcutModifier[]): ShortcutBinding => ({kind: 'keyboard', key, modifiers});
const globalKey = (code: string): ShortcutBinding => ({kind: 'keyboard', code, modifiers: ['Control', 'Shift', 'Meta']});
const def = (id: ShortcutAction, label: string, scope: ShortcutScope, bindings: ShortcutBinding[], extra: Partial<ShortcutDefinition> = {}): ShortcutDefinition => ({id, label, scope, bindings, description: label, availability: 'renderer', ...extra});
export const shortcutDefinitions: readonly ShortcutDefinition[] = [
  def('undo', 'Undo', 'app', [key('Z', 'Mod')]),
  def('redo', 'Redo', 'app', [key('Z', 'Mod', 'Shift')]),
  def('copy', 'Copy', 'app', [key('C', 'Mod')]),
  def('paste', 'Paste', 'app', [key('V', 'Mod')]),
  def('cut', 'Cut', 'app', [key('X', 'Mod')]),
  def('selectAll', 'Select all', 'app', [key('A', 'Mod')]),
  def('deselectAll', 'Deselect all', 'app', [key('A', 'Mod', 'Shift')]),
  def('workflowPlay', 'Play / Pause', 'workflow-review', [key('Space')], {availability: 'contextual'}),
  def('takePlay', 'Play / Pause', 'take-preview', [key('Space')], {availability: 'contextual'}),
  def('takeSeekBackward', 'Seek backward 5 seconds', 'take-preview', [key('ArrowLeft')], {repeat: true, availability: 'contextual'}),
  def('takeSeekForward', 'Seek forward 5 seconds', 'take-preview', [key('ArrowRight')], {repeat: true, availability: 'contextual'}),
  def('takeSlower', 'Play slower', 'take-preview', [key('J')], {availability: 'contextual'}),
  def('takePauseReset', 'Pause and reset speed', 'take-preview', [key('K')], {availability: 'contextual'}),
  def('takeFaster', 'Play faster', 'take-preview', [key('L')], {availability: 'contextual'}),
  def('takeClose', 'Close preview', 'take-preview', [key('Escape')], {availability: 'contextual'}),
  def('playPause', 'Play / Pause', 'edit', [key('Space')]),
  def('pauseReset', 'Pause and reset speed', 'edit', [key('K')], {description: 'Pause playback and return playback speed to 1×.'}),
  def('playFaster', 'Play faster', 'edit', [key('L')], {description: 'Start playback at 1×, or increase playing speed to 2× then 4×.'}),
  def('selectTool', 'Select tool', 'edit', [key('A')]),
  def('bladeTool', 'Blade tool', 'edit', [key('B')], {description: 'Switch to the blade tool; click a clip to cut at the pointer.'}),
  def('frameBackward', 'Step backward one frame', 'edit', [key('ArrowLeft')], {repeat: true, description: 'Pause and step backward by 1/30 second.'}),
  def('frameForward', 'Step forward one frame', 'edit', [key('ArrowRight')], {repeat: true, description: 'Pause and step forward by 1/30 second.'}),
  def('previousEdit', 'Go to previous edit', 'edit', [key('ArrowUp')], {repeat: true}),
  def('nextEdit', 'Go to next edit', 'edit', [key('ArrowDown')], {repeat: true}),
  def('zoomOut', 'Zoom timeline out', 'edit', [key('-', 'Mod')], {repeat: true}),
  def('zoomIn', 'Zoom timeline in', 'edit', [key('=', 'Mod')], {repeat: true}),
  def('deleteRipple', 'Delete', 'edit', [key('Delete'), key('Backspace')], {description: 'Delete selected clips and collapse the removed time.'}),
  def('deleteLeaveGap', 'Delete and leave gap', 'edit', [key('Delete', 'Shift'), key('Backspace', 'Shift')]),
  def('split', 'Split at playhead', 'edit', [key('B', 'Mod')], {description: 'Split selected clips crossing the playhead, or all crossing clips if none selected cross it.'}),
  def('trimLeft', 'Trim left to playhead', 'edit', [key('Q')]),
  def('trimRight', 'Trim right to playhead', 'edit', [key('W')]),
  def('toggleSnapping', 'Toggle snapping', 'edit', [key('N')]),
  def('toggleScrubbing', 'Toggle scrubbing', 'edit', [key('S')], {description: 'Toggle preview scrubbing as the pointer moves across the timeline.'}),
  def('timelineScroll', 'Horizontal scroll with wheel', 'edit', [{kind: 'wheel', modifiers: ['Alt']}], {surface: 'timeline'}),
  def('timelineZoom', 'Zoom with wheel', 'edit', [{kind: 'wheel', modifiers: ['Mod']}, {kind: 'wheel', modifiers: ['Control']}], {surface: 'timeline'}),
  def('selectInsideGroup', 'Select single segment inside group', 'edit', [{kind: 'pointer', button: 0, modifiers: ['Alt']}], {surface: 'timeline', availability: 'contextual'}),
  def('createSceneAtCursor', 'Create scene at cursor', 'script', [key('Enter', 'Mod')], {editable: 'script', availability: 'contextual'}),
  def('deleteOrMergeBackward', 'Delete or merge backward', 'script', [key('Backspace')], {editable: 'script', availability: 'contextual', description: 'At the start of script text, delete an empty scene or merge with the previous scene.'}),
  def('recordingPresets', 'Show recording presets', 'record', [key('P', 'Mod', 'Shift')], {editable: 'any', availability: 'contextual'}),
  def('closeProject', 'Close project', 'app', [key('W', 'Mod')]),
  def('quit', 'Quit SceneForge', 'app', [key('Q', 'Mod')], {availability: 'native'}),
  def('record', 'Record', 'recorder', [globalKey('KeyR')], {availability: 'global'}),
  def('tryAgain', 'Try again', 'recorder', [globalKey('KeyT')], {availability: 'global'}),
  def('stopRecord', 'Stop', 'recorder', [globalKey('KeyE')], {availability: 'global'}),
  def('pauseRecord', 'Pause / Resume', 'recorder', [globalKey('KeyY')], {availability: 'global'}),
  def('previousSentence', 'Go to previous sentence', 'recorder', [globalKey('ArrowUp')], {availability: 'global', repeat: true}),
  def('nextSentence', 'Go to next sentence', 'recorder', [globalKey('ArrowDown')], {availability: 'global', repeat: true}),
  def('previousWord', 'Go to previous word', 'recorder', [globalKey('ArrowLeft')], {availability: 'global', repeat: true}),
  def('nextWord', 'Go to next word', 'recorder', [globalKey('ArrowRight')], {availability: 'global', repeat: true}),
  def('toggleWaveforms', 'Show or hide waveforms', 'edit', [key('E')], {extension:true,description:'Show source audio loudness inside timeline clips.'}),
  def('saveProject', 'Save project', 'app', [key('S', 'Mod')], {extension: true, description: 'Save the current SceneForge project.'}),
];
export type ShortcutOverrides = Partial<Record<ShortcutAction, ShortcutBinding[]>>;
export interface ShortcutInput {
  key?: string;
  code?: string;
  type?: string;
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  defaultPrevented?: boolean;
  target?: EventTarget | null;
}
export interface ShortcutContext {
  scope: ShortcutScope;
  surface?: 'timeline' | 'transcript';
  platform?: ShortcutPlatform;
  modal?: boolean;
  editable?: boolean;
  scriptEditing?: boolean;
  availableActions?: readonly ShortcutAction[];
}
export function shortcutPlatform(): ShortcutPlatform {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform;
  return /Mac|iPhone|iPad/.test(platform) ? 'mac' : /Win/.test(platform) ? 'windows' : 'linux';
}
export function normalizeShortcutKey(value?: string): string {
  if (!value) return '';
  if (value === ' ' || value === 'Spacebar') return 'Space';
  if (value === 'Esc') return 'Escape';
  return value.length === 1 ? value.toUpperCase() : value;
}
export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  return element.isContentEditable || !!element.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
}
function physicalModifiers(binding: ShortcutBinding, platform: ShortcutPlatform): Set<string> {
  return new Set(binding.modifiers.map(m => m === 'Mod' ? platform === 'mac' ? 'Meta' : 'Control' : m));
}
function eventModifiers(event: ShortcutInput): string[] {
  return [event.metaKey && 'Meta', event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift'].filter(Boolean) as string[];
}
function sameModifiers(binding: ShortcutBinding, event: ShortcutInput, platform: ShortcutPlatform): boolean {
  const modifiers = physicalModifiers(binding, platform), actual = eventModifiers(event);
  return actual.length === modifiers.size && actual.every(m => modifiers.has(m));
}
export function bindingsFor(definition: ShortcutDefinition, overrides: ShortcutOverrides = {}): ShortcutBinding[] {
  return overrides[definition.id] ?? definition.bindings;
}
/** No side effects: caller prevents default only after choosing an implemented handler. */
export function resolveShortcut(event: ShortcutInput, context: ShortcutContext, overrides: ShortcutOverrides = {}): ShortcutDefinition | null {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.type === 'keyup') return null;
  if (context.modal && !['take-preview', 'workflow-review', 'recorder'].includes(context.scope)) return null;
  const kind = event.type === 'wheel' ? 'wheel' : event.type === 'click' || event.type === 'pointerdown' ? 'pointer' : 'keyboard';
  const editable = context.editable ?? isEditableTarget(event.target);
  const platform = context.platform ?? shortcutPlatform();
  for (const definition of shortcutDefinitions) {
    if (context.availableActions && !context.availableActions.includes(definition.id)) continue;
    if (definition.scope !== 'app' && definition.scope !== context.scope) continue;
    if (definition.surface && definition.surface !== context.surface) continue;
    if (event.repeat && !definition.repeat) continue;
    if (editable && definition.editable !== 'any' && !(definition.editable === 'script' && context.scriptEditing)) continue;
    if (definition.editable === 'script' && !context.scriptEditing) continue;
    if (bindingsFor(definition, overrides).some(binding => binding.kind === kind && sameModifiers(binding, event, platform) &&
      (kind === 'keyboard' ? binding.code ? event.code === binding.code : normalizeShortcutKey(event.key) === normalizeShortcutKey(binding.key) :
        kind === 'pointer' ? (event.button ?? 0) === (binding.button ?? 0) : true))) return definition;
  }
  return null;
}
export function captureShortcut(event: ShortcutInput, platform = shortcutPlatform()): ShortcutBinding | null {
  if (event.isComposing || event.keyCode === 229) return null;
  const modifiers = eventModifiers(event).map(m => m === (platform === 'mac' ? 'Meta' : 'Control') ? 'Mod' : m) as ShortcutModifier[];
  if (event.type === 'wheel') return {kind: 'wheel', modifiers};
  if (event.type === 'click' || event.type === 'pointerdown') return [0, 1, 2].includes(event.button ?? 0) ? {kind: 'pointer', button: event.button ?? 0, modifiers} : null;
  const normalized = normalizeShortcutKey(event.key);
  if (event.repeat || event.isComposing || event.keyCode === 229 || !normalized || ['Meta', 'Control', 'Alt', 'Shift', 'Escape', 'Dead', 'Unidentified', 'Process'].includes(normalized)) return null;
  return key(normalized, ...modifiers);
}
function scopesOverlap(a: ShortcutDefinition, b: ShortcutDefinition): boolean {
  if (a.availability === 'global' || b.availability === 'global') return true;
  return (a.scope === 'app' || b.scope === 'app' || a.scope === b.scope) && (!a.surface || !b.surface || a.surface === b.surface);
}
function sameBinding(a: ShortcutBinding, b: ShortcutBinding, platform: ShortcutPlatform): boolean {
  if (a.kind !== b.kind) return false;
  const am = physicalModifiers(a, platform), bm = physicalModifiers(b, platform);
  if (am.size !== bm.size || ![...am].every(m => bm.has(m))) return false;
  if (a.kind === 'wheel') return true;
  if (a.kind === 'pointer') return (a.button ?? 0) === (b.button ?? 0);
  // Global registrations use physical codes; conservative conflict checks map Latin keys.
  const normalize = (binding: ShortcutBinding) => binding.code?.replace(/^Key(?=[A-Z]$)/, '').replace(/^Digit(?=[0-9]$)/, '') ?? normalizeShortcutKey(binding.key);
  return normalize(a) === normalize(b);
}
export function findShortcutConflicts(action: ShortcutAction, binding: ShortcutBinding, overrides: ShortcutOverrides = {}, platform = shortcutPlatform()): ShortcutDefinition[] {
  const current = shortcutDefinitions.find(d => d.id === action);
  if (!current) return [];
  return shortcutDefinitions.filter(d => d.id !== action && scopesOverlap(current, d) && bindingsFor(d, overrides).some(b => sameBinding(binding, b, platform)));
}
export function bindingLabel(binding: ShortcutBinding, platform = shortcutPlatform()): string {
  const mods = physicalModifiers(binding, platform);
  const names: Record<string, string> = platform === 'mac' ? {Meta: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧'} : {Meta: 'Win', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift'};
  const parts = ['Meta', 'Control', 'Alt', 'Shift'].filter(m => mods.has(m)).map(m => names[m]);
  const keyName = binding.key ?? binding.code?.replace(/^Key/, '').replace(/^Digit/, '') ?? '';
  const friendly: Record<string, string> = {ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Space: 'Space'};
  parts.push(binding.kind === 'wheel' ? 'Wheel' : binding.kind === 'pointer' ? 'Click' : friendly[keyName] ?? keyName);
  return parts.join(platform === 'mac' ? '' : '+');
}
export function shortcutLabel(definition: ShortcutDefinition | ShortcutAction, overrides: ShortcutOverrides = {}, platform = shortcutPlatform()): string {
  const actual = typeof definition === 'string' ? shortcutDefinitions.find(d => d.id === definition) : definition;
  return actual ? bindingsFor(actual, overrides).map(b => bindingLabel(b, platform)).join(' / ') : '';
}
export const SHORTCUT_STORAGE_KEY = 'sceneforge.shortcuts.v1';
interface ShortcutStorage {getItem(key: string): string | null; setItem(key: string, value: string): void;}
function validBinding(value: unknown): value is ShortcutBinding {
  if (!value || typeof value !== 'object') return false;
  const b = value as ShortcutBinding;
  if (!['keyboard', 'wheel', 'pointer'].includes(b.kind) || !Array.isArray(b.modifiers) || b.modifiers.some(m => !['Mod','Meta','Control','Alt','Shift'].includes(m)) || new Set(b.modifiers).size !== b.modifiers.length) return false;
  if (b.kind === 'keyboard') return typeof (b.key ?? b.code) === 'string' && (b.key ?? b.code)!.length > 0 && (b.key ?? b.code)!.length < 40;
  return b.kind === 'wheel' || [0, 1, 2].includes(b.button ?? 0);
}
export function loadShortcutOverrides(storage?: ShortcutStorage): ShortcutOverrides {
  try {
    const source = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
    const parsed: unknown = JSON.parse(source?.getItem(SHORTCUT_STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: ShortcutOverrides = {};
    for (const d of shortcutDefinitions) {
      const value = (parsed as Record<string, unknown>)[d.id];
      if (Array.isArray(value) && value.length <= 8 && value.every(b => validBinding(b) && b.kind === d.bindings[0]?.kind)) result[d.id] = value;
    }
    return result;
  } catch {return {};}
}
export function saveShortcutOverrides(overrides: ShortcutOverrides, storage?: ShortcutStorage): boolean {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
    if (!target) return false;
    const serialized = JSON.stringify(overrides);
    const validated = loadShortcutOverrides({getItem: () => serialized, setItem: () => {}});
    target.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(validated));
    return true;
  } catch {return false;}
}
