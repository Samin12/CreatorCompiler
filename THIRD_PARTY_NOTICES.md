# Third-party notices

Creator Compiler's independently authored application code and identity assets are covered by the root [MIT license](LICENSE). Third-party software remains under its own license; that MIT grant does not relicense bundled dependencies, models or codec programs. No Borumi source code, proprietary media, logo, hosted service credentials or extracted assets are included in the public application.

## JavaScript application dependencies

The complete locked production dependency inventory, declared licenses, and exact installed license/copyright texts are in [docs/NPM-NOTICES.md](docs/NPM-NOTICES.md) and [docs/licenses/npm](docs/licenses/npm). These notices include transitive dependencies and conservatively include packages that may be removed by bundling.

Direct packages in `app/package-lock.json`:

| Package | Version | License |
| --- | --- | --- |
| React | 19.3.0 | MIT |
| React DOM | 19.3.0 | MIT |
| Express | 5.3.0 | MIT |
| Multer | 2.4.0 | MIT |
| Model Context Protocol TypeScript SDK | 1.32.1 | MIT |
| Zod | 3.25.76 | MIT |
| Iconoir React | 7.11.0 | MIT |
| Lucide React | 0.468.0 | ISC; included Feather-derived portions retain their stated MIT attribution |

Iconoir's upstream icon design license credits **Luca Burgio**, and the installed React package notice credits **Daniel Martin**. Both notices are preserved: [upstream Iconoir](docs/licenses/iconoir/LICENSE) and the [installed package](docs/licenses/npm/iconoir-react@7.11.0/LICENSE). The app uses the open Iconoir package through an independent adapter, plus independently drawn interface glyphs and the Creator Compiler identity.

## Electron and Chromium

The desktop shell uses Electron 44.7.1. Electron's MIT `LICENSE` and its `LICENSES.chromium.html` third-party notices are included by the upstream Electron distribution in the packaged application. These cover Electron/Chromium and their embedded dependencies; do not remove them when repackaging. Build-tool dependencies such as Vite, TypeScript, esbuild and Electron Packager retain their own license files in their installed npm packages.

## Media and speech command-line runtime

The pinned build recipe is [app/scripts/build-runtime.mjs](app/scripts/build-runtime.mjs). It builds separate executable programs, invoked as subprocesses by Creator Compiler. No FFmpeg libraries are linked into Creator Compiler's own JavaScript or Swift implementation.

| Component | Pinned version | License / notices |
| --- | --- | --- |
| FFmpeg / FFprobe | 9.0.2 | GPL-2.0-or-later for this configured build; [GPL text](docs/licenses/runtime/ffmpeg/COPYING.GPLv2), [upstream license explanation](docs/licenses/runtime/ffmpeg/LICENSE.md) |
| x264 | r3222, commit `b35605ace3ddf7c1a5d67a2eb553f034aef41d55` | GPL-2.0-or-later; [COPYING](docs/licenses/runtime/x264/COPYING) |
| libvpx | 1.17.0 | BSD-3-Clause and patent grant; [LICENSE](docs/licenses/runtime/libvpx/LICENSE), [PATENTS](docs/licenses/runtime/libvpx/PATENTS) |
| Opus | 1.6.1 | BSD-style terms and included notices; [COPYING](docs/licenses/runtime/opus/COPYING) |
| whisper.cpp / bundled ggml | 1.9.4 | MIT; [LICENSE](docs/licenses/runtime/whisper.cpp/LICENSE) |

FFmpeg is configured with `--enable-gpl` and `--enable-libx264`, without `--enable-version3` or `--enable-nonfree`. Its executable is therefore GPL-2.0-or-later, rather than the LGPL-only configuration. [FFmpeg explains its optional GPL components here](https://ffmpeg.org/legal.html).

The desktop release provides **[runtime sources archive](https://github.com/Samin12/CreatorCompiler/releases/latest/download/SceneForge-runtime-sources.zip)** from the same release/download location. The generated archive includes the matching unmodified upstream source tarballs, pinned archive hashes, license texts, build recipe, exact commands and generated configuration. No upstream source patches are applied by the current recipe. Inspect the version-specific runtime `manifest.json` and release checksum list for the exact distributed build; a newer branch can differ from an older binary.

The build uses Apple system SDK/frameworks. Those system components are not redistributed as part of the source archive. The command-line runtime is supplied without warranty under its respective licenses. Codec patent rights, where applicable, are separate from software copyright licenses; no patent license beyond the included upstream grants is asserted.

## Bundled speech model

The desktop package includes OpenAI Whisper's English `base.en` model in GGML format as `runtime/models/ggml-base.en.bin`. Whisper model weights and code are MIT licensed according to [the upstream Whisper repository](https://github.com/openai/whisper#license). The package retains the model's MIT notice, download provenance and SHA-256 manifest in `runtime/models/`; the bundled model's SHA-256 is `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`. Other models selected by users remain subject to their own licenses.

## Regenerating notices

After `npm ci`, run `node docs/generate-licenses.mjs` from the repository root. Review changed package licenses, retain all required notices in the desktop bundle, and update this file when runtime components or model packaging change.
