# SceneForge v0.1.0-preview.1

An early independent desktop editor for Apple Silicon Macs running macOS 14 or later. Complete Borumi feature, format, visual or performance parity is not claimed. Keep source footage and review exports.

## Download

- [DMG installer](https://github.com/Samin12/SceneForge/releases/download/v0.1.0-preview.1/SceneForge-macOS-arm64.dmg): drag SceneForge into Applications.
- [ZIP archive](https://github.com/Samin12/SceneForge/releases/download/v0.1.0-preview.1/SceneForge-macOS-arm64.zip): the same application, installed manually.
- [Runtime sources](https://github.com/Samin12/SceneForge/releases/download/v0.1.0-preview.1/SceneForge-runtime-sources.zip): matching media/speech sources, build recipe and licenses.
- [12-second sample](https://github.com/Samin12/SceneForge/releases/download/v0.1.0-preview.1/SceneForge-demo.mp4): original synthetic content exported through SceneForge.

Compare downloads with the release checksums. This preview is **Apple Development signed with a stable identity, not Apple-notarized**. It has no automatic updater. FFmpeg/FFprobe, Whisper, an English speech model and native text/Vision helpers are included; downloaded-app editing and export need no Homebrew installation. [Install guide](INSTALL.md).

## Included workflows

- **Script and record:** scenes, teleprompter, camera/microphone previews, explicit display/window/region selection, presets, countdown, floating recording controls and a capture border.
- **Review and retain takes:** separate-source playback and waveforms, scene cards, replacement of matching source roles, sequential Keep both, overlapping Record over, and archived attempts. Confirm stays in the current scene. Saved take metadata persists in the project; source files remain local.
- **Edit:** a multitrack timeline, configurable shortcuts, transcript-word ripple deletion and Undo. Light/dark transcript selection now uses readable blue highlights, including the current word, with clear prospective Delete copy.
- **Local quick actions:** automatic transcription is on by default. Auto-cut and Visualize create whole-project proposals for review, frame comparison and selected application. Verified quiet gaps are preselected; repeated phrases need review. Optional Claude narrative analysis is off by default and shares transcript context with your Claude account.
- **Claude and MCP:** selection-aware in-app Claude Code editing with guarded Undo, plus 39 MCP tools for external assistants. Packaged edit/inspect/export and real-provider scoped-edit checks passed. Provider costs and data handling apply.
- **Recovery:** Trash restoration, explicit Restore as copy, reviewed media relinking with guarded Undo, and durable export history. Restart saved export uses its frozen version/settings from the beginning; it does not resume chunks or overwrite current edits.
- **Face centering:** local largest-face detections at up to 4 Hz with interpolated crop motion in preview/export. This is not identity tracking or exact original-editor motion.
- **Limited native project copies:** reviewed Borumi export supports documented mappings and blocks unsupported edits. Recording-take history is currently blocked to avoid archive loss. [Compatibility guide](BORUMI-COMPATIBILITY.md).

## Verified, with boundaries

A complete 20-minute, 905-clip project export decoded all 36,077 frames and passed independent whole-audio comparison. Review of 65 sampled comparisons covered source/layout presence, cursor position/visibility, the terminal frame and the two previously clipped faces. Those regression checks pass; cursor artwork, camera framing and some animated-source pixels still differ from Borumi.

Camera, microphone and screen permissions survived an installed A→B→A update cycle on one Mac with no new consent prompts. App and helper identities remain stable across different code hashes; there is no silent ad-hoc signing fallback. This does not guarantee that macOS never revokes permissions or that an initial identity transition needs no consent.

Complete four-source/region capture acceptance for the final package, long-device A/V synchronization and all-frame visual parity remain open. Earlier short takes and sampled exclusion checks are useful checkpoints, not blanket hardware certification. Source tests and CI likewise do not prove every physical device or imported project. [Validation](VALIDATION.md) · [Known limits](LIMITATIONS.md) · [Privacy](PRIVACY.md).
