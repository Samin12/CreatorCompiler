# SceneForge v0.1.0-preview.2

This preview improves timeline interaction, recording previews and camera styling. Requires Apple Silicon and macOS 14 or later.

- Drag clips between compatible rows or onto an insertion line to create a new layer. Mostly vertical drags retain timing; selected clips retain their offsets.
- Magnetic edge snapping aligns with clips, scene boundaries and the playhead and shows an alignment guide. Toggle it with N.
- Screen preview restores the previously selected source after review or returning to Record, while existing macOS access remains granted. Missing sources and changed display arrangements require a new choice.
- Tighter spacing and matched type sizes across recording, take review, editor controls and settings.
- Rounded Creator camera framing and soft shadow default for new combined recordings, with editable settings and matching export support. Native regular-corner shadow settings import correctly.

[Download DMG](https://github.com/Samin12/SceneForge/releases/download/v0.1.0-preview.2/SceneForge-macOS-arm64.dmg) · [ZIP](https://github.com/Samin12/SceneForge/releases/download/v0.1.0-preview.2/SceneForge-macOS-arm64.zip) · [Runtime sources](https://github.com/Samin12/SceneForge/releases/download/v0.1.0-preview.2/SceneForge-runtime-sources.zip)

This is Apple Development signed and has not been notarized by Apple. There is no automatic updater. Complete Borumi parity/round-trip compatibility, automatic magnetic insertion, 4K capture and long-session hardware synchronization remain unfinished. Custom timeline layers block Borumi copy export to avoid silently losing them. Read [installation](INSTALL.md), [validation](VALIDATION.md) and [limitations](LIMITATIONS.md).
