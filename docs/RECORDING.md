# Record by scene, keep your takes

Open **Record**, choose a scene card, and enable the sources you need. Camera and microphone previews use the selected devices. For a display, window or region, choose the source explicitly. A region is one movable, resizable rectangle on one display. Recording presets remember source choices and capture settings.

## Check the sources

A macOS permission and a working preview are different checks. Use **Mac setup** if access is blocked, then confirm the camera picture, screen preview and microphone meter. Existing footage can be imported without recording permissions. System sound can be captured separately from screen video; an audio track or Allowed label alone does not prove that sound was recorded.

Already-granted, enabled sources can open their previews without another permission request. Pending requests are shared rather than duplicated, and cancelled views release late streams. The desktop screen preview reports an error after 30 seconds if a confirmed source never opens. Initial camera/microphone permission prompts and browser choosers remain under your control.

The prerelease uses a stable Apple Development signing identity. Camera, microphone and screen grants survived an installed A→B→A update test on one Mac with no new consent requests. The first transition from an older ad-hoc build can still need fresh consent; macOS can also revoke access. [Installation and permissions](INSTALL.md).

## Record and review

The three-chime **3–2–1 countdown** is on by default and can be disabled. It finishes before capture starts; Cancel stops a pending start.

During desktop recording, the main editor hides and movable camera/script controls provide pause and stop. A green border identifies the selected display or region. Stop restores the editor, saves the sources, and opens Take Review. Check the screen and camera independently, inspect microphone/system-sound waveforms, and use playback, seeking and speed controls.

**Record another take** keeps the previous attempt and records again in the same scene. A saved take does not become active on the timeline until you confirm it. Failed confirmation leaves it available for retry.

## Choose what stays in the scene

Scene cards list saved and active takes. Confirming a take stays in the current scene; select another scene yourself when ready. **Confirm & edit** opens the timeline.

- **Confirm take** normally replaces matching screen, camera or audio roles while preserving unmatched sources. Prior takes remain archived.
- **Confirm without replacing** keeps both takes sequentially in the scene.
- **Record over** overlaps the chosen take with existing scene content.
- **Archive** removes a take's active content while retaining the saved take for reuse.
- **Delete take** removes its saved project entry. Original media files are retained.

Add a scene between cards, reorder scenes, or delete a scene with its timeline content. These are undoable project edits. Reordering preserves the scene's following gap and moves its clips, transcript timing, graphics, zooms and cursor events together. Items crossing incompatible scene boundaries must be split or shortened first; the operation stops rather than partially moving content.

Saved take metadata and scene-relative edits live in the project. Audio/video files remain in local storage. Back up the project and referenced source files together: project JSON alone is not portable footage. Legacy profile takes remain recoverable and enter the project when confirmed or archived; unfinished recording chunks can also be recovered from Home. Storage errors are shown rather than treated as a successful save.

## Verification boundary

The native path uses ScreenCaptureKit to exclude SceneForge. Earlier short installed takes passed full decoding and sampled editor/HUD exclusion; one four-source take had non-silent microphone and system audio. A separate region take had silent system audio and did not verify the intended screen content. Region redraw was subsequently verified in the installed picker, but complete four-source/region capture acceptance for the newest package remains open. Long physical-device synchronization and every-frame exclusion across all arrangements are not established. Review a short take with your own devices before important work.

The floating controls are for recording, not a complete external-display presentation system. Projects with recording-take history currently cannot export to Borumi, because its archive mapping is not implemented. See [known limits](LIMITATIONS.md), [compatibility](BORUMI-COMPATIBILITY.md) and [validation](VALIDATION.md).
