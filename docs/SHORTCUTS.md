# Keyboard shortcuts

Default macOS bindings are scoped to the current workspace. Text inputs retain ordinary typing and clipboard behavior. Settings → Keyboard shortcuts shows the full catalog, unavailable contexts, conflicts, disable/reset controls and editable keyboard bindings.

| Edit action | Default |
| --- | --- |
| Select tool / Blade tool | `A` / `B` |
| Split at playhead | `⌘B` |
| Toggle scrubbing / snapping | `S` / `N` |
| Show / hide source waveforms | `E` |
| Trim selection left / right to playhead | `Q` / `W` |
| Delete and collapse | `Delete` or `Backspace` |
| Delete leaving a gap | `⇧Delete` or `⇧Backspace` |
| Step one frame (1/30 second) | `←` / `→` |
| Previous / next edit | `↑` / `↓` |
| Zoom timeline | `⌘−` / `⌘=` |
| Play / pause | `Space` |
| Pause and reset playback rate | `K` |
| Play, then increase rate to 2× / 4× | `L` |
| Select all / clear selection | `⌘A` / `⌘⇧A` |
| Copy / paste / cut | `⌘C` / `⌘V` / `⌘X` |
| Undo / redo | `⌘Z` / `⌘⇧Z` |
| Save / close project | `⌘S` / `⌘W` |
| Horizontal timeline scroll | `⌥` + wheel |
| Timeline zoom gesture | `⌘` or `Control` + wheel |

`B` activates the blade; click a clip to cut it. `S` toggles scrubbing and does **not** split. Split at the playhead acts on selected crossing clips when present, otherwise on crossing clips. `Q/W` require an explicit selected clip crossing the playhead. Ripple behavior is track-based; linked native groups are not supported.

In Script, `⌘Enter` splits a nonempty scene at the caret. Backspace at the beginning of a later scene merges into the previous scene. In Record/Teleprompter, the catalog lists capture and word/sentence navigation bindings; the desktop bridge can register implemented recorder controls globally while that workspace is active. macOS may refuse a global shortcut already owned by another app; Creator Compiler reports the conflict.

In take review, `Space` plays or pauses, `←` / `→` seek five seconds, `J` slows playback, `K` pauses and resets the rate, `L` plays or increases the rate, and `Escape` closes review while keeping the saved take. All seven take-review bindings can be changed, disabled or reset in Settings. Workflow-review and inside-group actions remain unavailable where their corresponding feature is not implemented. Pointer/wheel rows can be disabled or reset; keyboard replacement of those gestures is unavailable. `J` is not an Edit shortcut. See the complete [source registry](../app/src/shortcuts.ts).

In Record, `⌘⇧P` opens local recording presets. Save, apply, rename, update, and delete named capture settings. Applying a preset reopens only already-authorized camera/microphone sources; screen and system sound require explicit source selection.

`E` is a Creator Compiler addition. It toggles waveform visibility without changing the audio. Focus the timeline divider and use arrow keys to resize it; double-click resets the height. Scene cards support `Alt+↑/↓` reordering.
