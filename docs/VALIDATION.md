# Preview validation

Source update for **v0.1.0-preview.3**, October 13, 2026. Prior completed checkpoints below retain their original test scope. These are scoped source, packaged-runtime and physical checks. They do not establish complete parity, certification on every Mac or every-frame visual correctness.

## Moving canvas, scenes and timeline update

The combined source suite passed 467 tests: 466 passed, zero failed and one known private-portrait fixture was skipped; production builds passed. New checks cover the moving dotted canvas across 510 exported frames, range/frame inspection, 16-second loops and chunk boundaries; source-time waveforms including long/quiet/stereo media; layer controls; scene-only proposals and cross-boundary caption/zoom preservation; and timeline resizing.

Actual component checks cover 21 timeline-resizer cases, 19 recording-scene action cases, 55 timeline/layer/scene/waveform cases, and 16 moving-canvas/dialog cases. The background uses a small repeated animated tile with bilinear movement, rather than regenerating the full canvas each frame. These measurements and examples do not establish general performance superiority or full native parity.

The signed package of this source passed `codesign --verify --deep --strict` with the same Apple Development identity as preview 2. Its bundled server started with the packaged ffmpeg, ffprobe, whisper model, and MCP launcher. In that packaged editor, a new project opened on Moving dots; adding a video layer, removing it, and opening a scene's Auto-cut and Visualize actions worked. Timeline height, zoom, and waveform controls were present. Preview 2 was still the running single-instance app, so this check did not replace it or repeat a physical recording pass. Public download checksums are on the v0.1.0-preview.3 release.

## Interaction and styling update

The new source has targeted checks for vertical layer creation/movement, shared-offset dragging, magnetic edge snapping, cancellation, saved-screen preview restoration, and Creator camera framing/shadows. Actual component checks cover 37 design states, 20 timeline interactions, 21 recording-preview lifecycle cases and 14 Creator Inspector cases. Six server tests render and inspect real video pixels, validate saved layers/styles, and exercise immutable export restart and compatibility blockers. These are bounded checks; hosted CI and installed hardware acceptance remain separate release gates.

## Previous completed checkpoints

| Check | Verified result | Boundary |
| --- | --- | --- |
| Full complex-project export | A 1,202.536-second, 905-clip project produced 36,077 decoded video frames with no decode errors. Original project/source data remained unchanged. | This is one private acceptance fixture; its footage is not distributed. |
| Whole-output audio | Independent source-aligned comparison covered all 19,240,581 mono analysis samples. No missing 10ms bins or suspicious windows; minimum active-window correlation 0.9975 and maximum gain difference 0.121dB. | Lossy AAC is not sample-identical to the reference. This checks export, not physical capture synchronization. |
| Sampled visual regressions | 65 comparisons at 59 distinct frame indices: 54 source/layout checks, 10 cursor visibility/location checks, terminal content, and the two formerly clipped faces passed. | Not an all-frame review. Cursor artwork, camera crop motion and some animated source pixels differ; exact native visual parity is false. |
| Stable installed permissions | A→B→A installation cycle retained camera, microphone and screen Allowed status without new consent requests, despite different code hashes. Camera and microphone were live before the cycle. | One Mac and signer. First transition from old ad-hoc identity, OS revocation and system-audio-only consent remain separate. |
| Packaged runtime and MCP | Actual 39-tool discovery, local Whisper transcription, scoped project edits, composed-frame inspection, audiovisual export and saved-version restart passed with an isolated data profile and no Homebrew on PATH. | Isolated service/runtime checks do not substitute for a fresh physical GUI recording test. |
| Claude editing | Real Claude Code inspected a composed frame, edited selected visual content and completed guarded Undo. Earlier selection/range and concurrent-edit guards also passed. | Provider availability and output vary. Scoped edits are not strict pixel privacy. |
| Export recovery | Hard-crash direct/chunked exports reopened as interrupted; explicit restarts decoded correctly while current edits stayed unchanged. Changed sources block restart, and runtime changes require acknowledgment. | Restart begins at zero; source files are not copied into snapshots. |
| Transcript theme and editing | 31 actual-component checks pass with full production CSS: dark/light selection contrast, hover, focus, real pointer/keyboard selection, Delete/Undo/Redo, compact layout and accessibility media modes. Dark selection contrast improved from 1:1 to 8.83:1. | This scoped UI check does not establish every editor control's visual parity. |
| Scene and script operations | 15 helper tests and 7 actual Script component checks cover scene add/delete/reorder, script split/merge, all AV roles, captions and word times, graphics, zooms, cursor boundaries, gaps, archived take IDs, source/DSP preservation and atomic failure. | Unsafe recorded-scene merges and cross-boundary items with incompatible movement are rejected. These are source/UI checks, not hardware capture acceptance. |
| Durable takes and scene cards | 52 focused take-model tests, 32 actual scene-card component checks and 25 full-App checks passed. Full-App checks used a synthetic native bridge with the real local API and MediaRecorder. | Exercises save, confirmation, replacement, archive and editing paths in that fixture; does not establish physical camera/mic/screen behavior. |
| Startup and runtime fallbacks | Renderer fingerprint tests accept a bounded metadata-only retry only when full file hashes agree, while source/content/path changes remain rejected. A real six-frame export used software encoding when the hardware probe failed; forced CPU-only Vision detection, tracking and segmentation also passed. | These source regressions do not prove every Mac's hardware support or final-package first-launch behavior. |
| Current clean public source | An isolated 354-file public snapshot passed all 378 tests (377 passed, zero failed, one known private-portrait fixture skip) and `build:all`. It reused an independent copy of the prior clean `npm ci` dependencies after confirming the lockfile was unchanged. | The private portrait fixture is excluded from public source. This is local clean-source acceptance; hosted GitHub CI execution and final-package hardware checks are separate. |

## Physical recording remains a separate gate

Earlier installed short screen/window/region recordings passed strict decode and sampled editor/HUD exclusion. One 27.97-second take recorded all four sources with non-silent microphone and system audio; automatic captions used microphone narration, and transcript Delete/Undo worked. A separate region take had digitally silent system audio and unverified intended screen content.

The region picker later passed its exact native resize → move → outside-redraw sequence with a 900×600 accepted region. Complete four-source/region recording acceptance in the final package is still open, as are long-session physical A/V synchronization and every-frame host-window exclusion across arrangements. A green border, permission label, live preview or passing unit suite alone cannot close those checks.

## Reproduce source checks

Use Node.js 24 and FFmpeg/FFprobe on a supported Mac:

```sh
cd app
npm ci
npm test
npm run build:all
```

GitHub CI runs these checks on `macos-14`. The public source excludes private media, credentials, local research, runtime caches and acceptance artifacts. The public sample uses independently authored synthetic content. Consult [limitations](LIMITATIONS.md) and [recording guidance](RECORDING.md) when evaluating the preview.
