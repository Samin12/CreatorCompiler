# SceneForge v0.1.0-preview.3

The moving dotted canvas is now the default for new projects, with explicit layer controls and draggable scene groups. Requires Apple Silicon and macOS 14 or later.

- New projects start with a dark dotted background that drifts slowly across the canvas. Preview, frame inspection and export use the project timeline, so cuts and render chunks do not restart the motion.
- Choose Moving dots or Solid color in Canvas settings. Existing projects and imported backgrounds keep their saved appearance.
- Add video or audio layers directly from the timeline. Rename or remove custom layers; removing a layer preserves its clips on a compatible row. Undo restores layer edits.
- Drag scene cards or timeline scene headers to reorder whole scene groups, including their media, captions and effects.
- Auto-cut and Visualize are available on each scene. These review-first actions affect the chosen scene and retain the scene groups.
- Drag the divider above the timeline to increase its height. Audio waveforms are visible in clips by default; E shows or hides them. The top bar has more spacing around window controls, tabs and actions.
- The rounded Creator camera frame and shadow, magnetic edge snapping and automatic screen preview restoration from preview 2 remain included.

[Download DMG](https://github.com/Samin12/SceneForge/releases/download/v0.1.0-preview.3/SceneForge-macOS-arm64.dmg) · [ZIP](https://github.com/Samin12/SceneForge/releases/download/v0.1.0-preview.3/SceneForge-macOS-arm64.zip) · [Runtime sources](https://github.com/Samin12/SceneForge/releases/download/v0.1.0-preview.3/SceneForge-runtime-sources.zip)

This is Apple Development signed and has not been notarized by Apple. There is no automatic updater. Complete Borumi parity/round-trip compatibility, automatic magnetic insertion, 4K capture and long-session hardware synchronization remain unfinished. Custom layers and animated backgrounds block Borumi copy export to avoid silently losing them. Read [installation](INSTALL.md), [validation](VALIDATION.md) and [limitations](LIMITATIONS.md).
