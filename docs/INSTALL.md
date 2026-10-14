# Install and build SceneForge

## Desktop preview

The target is macOS 14 or later on Apple Silicon (M1 or newer). Intel macOS, Windows and Linux desktop releases are not provided.

1. Download **`SceneForge-macOS-arm64.dmg`** from the [release page](https://github.com/Samin12/SceneForge/releases/tag/v0.1.0-preview.2) and compare it with the checksum published for that release.
2. Open the disk image and drag **SceneForge** onto **Applications**. Eject the disk image, then open SceneForge from Applications.
3. This prerelease is Apple Development signed with a stable identity, but is not Apple-notarized. If macOS blocks it, read [Apple's instructions](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac) and decide whether you trust that release.
4. Follow setup to enable the capture sources you want, or skip permissions and import existing media. Check your live preview and review a short export before starting important work.

The **`SceneForge-macOS-arm64.zip`** download is an alternative: unzip it, then move `SceneForge.app` into Applications yourself. Both downloads contain the same application. They are not separate editions.

Screen, camera and microphone capture use macOS permissions. Setup requests access only when you choose a source or press its enable button. You can close setup while a system prompt is pending and return through **Setup** or Settings. A system prompt may remain open after setup closes. The available display/window/audio sources depend on Electron, macOS and the selected device. Grant only the access you intend to use.

The desktop download includes `ffmpeg`, `ffprobe`, `whisper-cli`, the English `ggml-base.en.bin` model, and precompiled SceneForge text/Vision helpers. You do not need Homebrew, Xcode or a separate media-tool installation to use the downloaded app. The packaged runtime was tested with an isolated service/MCP profile and `PATH=/usr/bin:/bin`: local transcription, MCP edits, composed-frame inspection, an audiovisual export and Apple Vision processing passed. This was not a fresh GUI profile or a separate physical Mac. See [current validation](VALIDATION.md) for completed export checks and remaining physical capture boundaries. The included `runtime/manifest.json` records the runtime build; `runtime/models/model.json` records model provenance and its checksum. Other languages require a suitable Whisper model.

The app has no automatic updater. Download and install a newer release manually; replacing the app does not intentionally erase the local studio folder. Current releases pin the same signing identity for the application and its helpers. Camera, microphone and screen access survived an installed A→B→A update test on one Mac without new consent prompts. This is not a guarantee against macOS revoking access. The first transition from an older ad-hoc build can require consent once.

If access is blocked, open **Mac setup** and review the current OS status. Enable only the sources you want and answer the actual macOS prompt. Quit and reopen after changing screen-recording permission. If an old ad-hoc SceneForge entry remains enabled but the new app is denied, remove that stale entry in **System Settings → Privacy & Security → Screen & System Audio Recording**, add the current app from Applications, and allow it. Authenticate if macOS asks. The app does not bypass or reset these permissions. [Signing details](SIGNING.md).

## Data location

By default, projects, history, trash, recordings, cache, exports, catalog entries and AI configuration are stored under:

```text
~/Library/Application Support/SceneForge/studio
```

Imported original media remains at its source path. Back up the studio folder **and** referenced source media; project JSON alone is not a portable media archive. Appearance and keyboard preferences are stored in the desktop renderer's local storage. See [privacy](PRIVACY.md).

## Run from source

Prerequisites: Node.js 24 and npm, macOS 14+ Apple Silicon, and Xcode command-line tools for the native helpers. The media service needs FFmpeg and FFprobe on `PATH`. `whisper-cli` and a model are needed only for local transcription and speech-following.

```sh
cd app
npm ci
npm run dev
```

The development editor runs on `http://127.0.0.1:4173`; the API runs on `http://127.0.0.1:4174`. In another shell:

```sh
cd app
npm test
npm run build:all
npm run desktop
```

`build:all` compiles the renderer/server and the Swift text/Vision helpers. The helpers use Apple frameworks; they are independently authored and do not load a proprietary editor's libraries.

## Build the native runtime

The pinned recipe downloads upstream source archives, verifies SHA-256, builds local command-line programs, checks their arm64 architecture/minimum OS and dynamic dependencies, and creates a matching source archive. It needs CMake and pkg-config in addition to the source prerequisites.

```sh
node app/scripts/build-runtime.mjs
```

Outputs are in `app/runtime/`; corresponding sources and build configuration are packaged as `release/SceneForge-runtime-sources.zip`. Build caches and downloaded sources are ignored by Git. The recipe does not claim byte-for-byte reproducibility across different Apple SDK or compiler versions.

Run the application build and packaging from `app`:

```sh
npm run build:all
npm run package
```

Current-source packaging requires a valid Apple signing identity and pins the selected certificate locally. It fails if that identity is unavailable instead of silently creating an ad-hoc update. Read [local signing and permission continuity](SIGNING.md) for identity selection, explicit fixture-only ad-hoc builds, and signed-runtime hash provenance. This does not change the signing identity of previously downloaded releases.

Packaging targets Apple Silicon. Release maintainers must verify bundled program/model licenses, matching source downloads, actual import/export/transcription behavior without Homebrew, app signing verification, and the final archive checksum before publishing a binary. A successful local build alone is not a clean-machine acceptance result.

## Configuration

| Variable | Use |
| --- | --- |
| `SCENEFORGE_DATA_DIR` | Separate local studio directory, useful for development/test data. |
| `SCENEFORGE_PORT` | Local service port; default `4174`. |
| `SCENEFORGE_URL` | MCP loopback API URL; default `http://127.0.0.1:4174/api`. |
| `SCENEFORGE_WHISPER_MODEL` | Fallback local Whisper GGML model path. |
| `RUNTIME_JOBS` | Native runtime build parallelism, capped at 32. |

A packaged MCP connection normally needs only the launcher command; do not expose the HTTP service on a public network.
