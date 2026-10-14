# Signing local macOS builds

The current source packaging pipeline signs with a persistent Apple identity. Existing downloads are not changed by this source update; check the release's own signing information.

`npm run package` requires macOS and an available valid **Apple Development**, **Mac Developer**, or **Developer ID Application** signing identity. It never silently falls back to ad-hoc signing. List available identities with:

```sh
security find-identity -v -p codesigning
```

If exactly one supported identity is available on the first build, it is selected and its certificate SHA-1 and display name are pinned in the ignored local file `app/.local/signing-identity.json`. Adding another certificate does not change the selected identity. A missing or expired pinned identity causes an actionable build error.

Choose or intentionally rotate the identity by its exact certificate SHA-1 (or unambiguous exact display name):

```sh
cd app
SCENEFORGE_SIGN_IDENTITY=YOUR_CERTIFICATE_SHA1 npm run package
```

An explicit validated change atomically updates the local pin, so later ordinary builds retain that choice. Changing signer/channel can require renewed macOS consent. No certificate, private key or local pin is included in the public source.

For disposable test artifacts only, the explicit opt-in below permits ad-hoc signing. It does not replace the local certificate pin and should not be used to update an installation whose permissions should persist.

```sh
SCENEFORGE_ALLOW_ADHOC=1 npm run package
```

## What the pipeline signs

The application keeps the identifier `com.samin.sceneforge`. Its screen recorder, Vision helper, text renderer, FFmpeg, FFprobe and Whisper tools receive stable, distinct signing identifiers. The MCP launcher is a small compiled native executable at the existing `Contents/MacOS/sceneforge-mcp` path, signed as `com.samin.sceneforge.mcp`; it forwards arguments directly without a shell. These tools are signed before the containing application; Electron components are signed inside out with `@electron/osx-sign`. Every custom tool and the completed bundle are verified.

This local signing policy deliberately uses empty entitlements, no App Sandbox, no hardened runtime and no timestamp. It introduces no extra privacy capabilities and does not reset, grant or edit macOS permissions. The signer creates the designated requirement; the pipeline does not install a permissive custom requirement.

macOS uses the designated requirement to recognize updates. Moving from an older ad-hoc build to a stable signature may require consent once. Same-identity future updates are intended to preserve permission identity; actual retention must be checked by recording after replacing and relaunching two distinct builds. A successful signature check alone is not a physical recording test. [Apple code-signing requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements).

## Runtime source and binary hashes

Signing changes binary bytes. The packaged `runtime/manifest.json` reports the **signed** binary `sha256` and `size`, while `buildSha256` and `buildSize` retain their original build values. `runtime/build-manifest.json` preserves the original build manifest byte for byte. Compare the corresponding-source archive's manifest with this build manifest.

`runtime/signing-provenance.json` records the original manifest digest and before/after hashes for all six custom binaries plus the native MCP launcher. The original `app/runtime` files and corresponding-source archive are not re-signed or rewritten during packaging.

## Public distribution is a separate gate

An Apple Development signature is for local development; it is not a notarized public release. Selecting a Developer ID certificate alone does not notarize or harden this build. A public notarized distribution also requires a reviewed hardened-runtime entitlement policy, secure timestamps, Apple's notarization, and distribution validation. [Apple notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
