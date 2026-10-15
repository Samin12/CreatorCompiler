# SceneForge UX coherence implementation plan

**Goal:** Make starting, recording, editing, reviewing AI changes and exporting predictable, with consistent action placement and visual states.

**Design:** The approved in-chat design covers the dashboard, navigation, recording readiness, floating island, contextual editor controls, scoped AI, transcript/caption separation, proposal review and common interaction styling.

**Architecture:** Preserve the existing React editor, Express API, project model and Electron companion. Use existing controls, theme variables and test runner. Change public behavior in vertical test-first slices; inspect visual changes in the running app. Do not add a second UI framework or replace the media engine.

## Test boundaries

User confirmed these boundaries before tests were added, as required by Matt Pocock's TDD skill:

- UI actions and observable results: detects incorrect targets, labels, visibility and action outcomes; does not establish native device reliability or visual quality.
- Project HTTP API: detects incorrect AI scope, invalid scene IDs, proposal selection and applied project changes; external providers use a local HTTP fixture.
- Desktop companion public IPC/state: detects command semantics, layout state, window bounds and capture-independent preview toggles; does not establish macOS permission behavior or actual capture exclusion.

## Execution

- [x] Establish current-main baseline; work on `feat/ux-coherence`.
- [x] Script AI: pass the clicked scene through UI and API, reject missing scenes, review original/proposed script and apply only to its original target. Keep project-wide analysis explicit.
- [x] Visual proposals: use outcome labels, leave audience-facing badges/source labels unselected by default, distinguish exported elements from review notes.
- [x] Dashboard/navigation: record/import/write starting actions; stable workspace navigation; single project identity and Settings entry; contextual teleprompter.
- [x] Recording: show real source readiness independently of source inclusion; keep permissions and source setup explicit.
- [x] Editor/transcript: give preview priority, reveal clip controls contextually, remove duplicate transcription actions, separate transcript generation from caption visibility.
- [x] Floating island: fixed top recording controls, independent camera/script expansion, neutral theme, explicit state, real microphone meter, saved/clamped bounds and collapse preferences. No device labels over the camera image. Preview collapse never changes recorded sources.
- [x] Proposal review: playable original/edited cut comparison at the cut join; retain rendered frame comparison for visual treatments.
- [x] Interaction polish: common control sizes, action hierarchy, visible keyboard focus, predictable hover/pressed/disabled/loading states, restrained shadows, readable dark theme and reduced motion.
- [x] Verify changed behavior, full tests and production builds; review complete diff; inspect real workflows at laptop sizes in light/dark appearances. Record any native checks that cannot be completed.

## Acceptance and review focus

- Scene actions never silently widen to the entire project or overwrite another scene.
- Late AI results and project/scene changes cannot apply stale scripts.
- Hiding a preview, script or companion never silently stops a recorded source.
- Stop stays accessible and stationary while the companion expands; paused/saving status is explicit.
- Existing projects and explicit automation selections preserve compatibility.
- Empty and populated projects, missing transcript engines, long labels and narrow windows remain usable.
- Changes to styles must preserve timeline drag, resize, selection and transport hit targets.
- No claim of native microphone/screen correctness based only on mocked IPC or browser previews.

## Verification and delivery

- Implemented on `feat/ux-coherence`, based on `Samin12/main` at `4594c65`. The original local `main` remains unchanged.
- Added behavior tests in vertical red/green slices: scene-scoped script generation and replacement, stale revisions, distinct dashboard actions, contextual editor panels, source readiness, optional exported graphics, real cut-review snapshots and playback controls, island commands/layout persistence and reading controls.
- Final full suite: **618 passed, 1 skipped, 0 failed** (`npm test`). A preceding run hit the existing agent-chat subprocess startup deadline while the production build was running; its focused run and the subsequent full run passed. No timeout was changed to hide the failure.
- `npm run build:all` passes, including TypeScript, Vite and the server bundle. Vite retains the existing large-chunk warning. `git diff --check` passes.
- Independent review findings fixed: restoring an expanded script after a scriptless take now reserves adequate height; opening Ask Claude does not reserve an absent inspector column. Actual browser inspection also found and corrected transport overlap and an off-screen proposal Apply action.
- Browser inspection used isolated development data and synthetic footage, not user projects: dashboard, populated editor, transcript/caption states, AI proposal selection, playable edited cut review, and island light/dark appearances. Actual media playback advanced and stopped at the review boundary.
- Native Electron island checked through CUA using the production HTML/CSS/JS and a clearly labeled paused preview fixture. Expand/collapse, reading settings, slider accessibility and fixed Stop placement were verified. Camera/script expansion never sends recording commands.
- Latest user refinement: tray-style teleprompter toggle, consistent SVG icons, text-size slider with live value, reading settings popover, native scrolling instead of paragraph navigation and a start-scrolling footer, restrained light/dark surfaces and aligned recording actions.

- Follow-up scrolling refinement: normal wheel/trackpad/scrollbar/keyboard behavior is the default. Auto-scroll is an optional reading-settings switch, initially off; manual interaction turns it off without blocking native scrolling. Removed paragraph jump controls and their animation code. Updated behavior test failed before implementation and passes afterward. All 23 island/companion tests and `npm run build:all` pass. In the running browser, a real scroll moved the text 160 px while Stop remained fixed; optional auto-scroll advanced the content, and keyboard interaction disabled it. Wheel cancellation is covered by the UI behavior test.

- Approved dashboard refinement implemented: returning users see compact creation actions and a prominent latest-project continuation; empty libraries keep the explanatory starting cards. Projects sort by last edit, search finds older work, project actions live in keyboard-accessible overflow menus, and project-file import/trash live under library options. Continuation labels use the API’s actual timeline clip count; a planned scene duration does not imply footage. Missing clip-count metadata falls back to “Continue project.” Removed the duplicate header creation button and misleading brand dropdown chevron. Scroll speed can be adjusted before enabling auto-scroll, with Slower/Faster labels.
- Dashboard refinement verification: two added public UI tests cover continuing/searching projects and overflow action targets/Escape focus restoration; updated island behavior test proves speed can change while auto-scroll stays off. Full suite: 618 passed, 1 skipped. Independent review found no actionable regressions. Actual dashboard and isolated empty/multi-project fixtures inspected in light/dark themes; checked long titles and a 700px viewport. Dashboard no longer inherits the editor's 840px minimum width.

## Remaining manual validation

Actual camera/microphone/screen capture, macOS permission prompts, recording exclusion and saved recording output require a real device session. The native preview and IPC tests do not establish these. Export rendering internals were preserved; the web/server production build was checked, not a newly packaged signed desktop release. Integration target: `Samin12/SceneForge` → `main`.
