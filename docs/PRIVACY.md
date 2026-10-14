# Privacy and local data

SceneForge's editor, project storage, media processing and local transcription run on your Mac. The current source contains no application analytics or advertising SDK and no hosted SceneForge account service. This document describes the implementation, not an assurance about every third-party provider or assistant you connect.

## Stored on this Mac

The default studio folder is `~/Library/Application Support/SceneForge/studio`. It contains project JSON, media catalog records, saved history/trash, uploaded or recorded media, caches, exports, local service logs and AI settings. Imported source files are referenced by absolute path and are not overwritten. Project files and logs may therefore identify local folders and include private text.

AI provider keys are stored in the local `ai-settings.json` file with owner read/write permissions. The settings API omits the key on readback. **The key is not encrypted or stored in macOS Keychain.** A program running as your user may be able to read it. Clearing the key in AI settings removes the saved value. Filesystem backups can retain earlier copies.

Current source builds also retain immutable project snapshots, resolved settings, local source fingerprints and output fingerprints in export history. These snapshots can contain scripts, transcript text and media paths, and remain after later edits or project deletion. Source media is referenced rather than copied. Face tracking runs locally through Apple Vision; its bounded caches store face coordinates and do not require a cloud upload.

Appearance and shortcut preferences use renderer local storage. Recordings are written in chunks for recovery. Removing a project moves its JSON into local trash; it does not delete source media or all cached/exported copies. There is no full-data deletion button. Quit the app and stop its local service before manually removing the studio folder; preserve any recordings or exports you need first.

Recording source and countdown preferences use the local app profile. Saved/archived take metadata and scene-relative edits persist inside the project; recorded media remains in the studio folder. A local-profile recovery copy may remain if project saving fails, and older pending takes may still use that profile until confirmed or archived. Clearing the profile can remove those recovery details without deleting the media files. Project JSON alone does not transfer footage. The floating camera preview sends bounded JPEG frames from the already-open camera stream between local application windows; it does not send those frames to an external service.

Editor chat saves messages, job status and a pre-edit project snapshot locally for guarded Undo. Chat history is limited to 50 turns or 128 MiB per project. Deleting a project does not automatically erase its chat history.

Automatic transcription is enabled by default for audible projects when opened or saved. It uses the local model even if a cloud transcription provider is selected in settings. Source transcripts, generated caption metadata, quick-action proposals, pre-edit snapshots and generated visual assets are stored locally. Automatic transcription can be disabled in AI & transcription settings. The service retains up to 50 recent automation jobs per project; removing a project does not remove all associated caches or job records.

New recordings retain whether audio came from the microphone or system sound. Automatic transcription prefers an enabled microphone during overlap, including quiet portions. Imported projects use explicit source-role metadata when available; older untagged projects keep their existing source order. Roles are not inferred from filenames or voice identity.

Media recovery reads and hashes the chosen local replacement, probes its metadata and decodes bounded samples locally. Reviews retain file paths, fingerprints and a pre-edit snapshot in service memory. Applied project/catalog references and history remain on disk; source footage is not overwritten. External MCP recovery results include local paths and project details. These tools are excluded from in-app Claude editing chat. [Recovery guide](RECOVERY.md).

## Optional network use

- **Cloud transcription:** an explicit transcription request sends prepared audio and your requested language/model parameters to the configured provider. API credentials authenticate that request.
- **Script assistance:** an explicit script request sends the project's scene scripts, scene names and your prompt to the configured compatible chat provider.
- **MCP assistant:** the MCP server itself communicates with the local SceneForge service. The connected assistant can read project data and request composed images, transcripts or media operations. If that assistant uses a cloud model, its own handling of tool results determines what leaves your Mac.
- **Claude Code editor chat:** pressing Send invokes your installed Claude Code CLI using its existing authentication and configuration. SceneForge does not copy its credential files. The request includes your prompt, project identity, playhead, selected clip IDs/time range, relevant project metadata and up to four completed chat turns from that project. Local source paths and importer metadata are removed from tool responses. If Claude requests frame inspection, composed images at authorized times are supplied; these can show overlapping unselected layers. Selection limits edits, not strict layer-data visibility, and earlier chat turns can contain broader context. With no clip or time selection, the editor explicitly uses the entire project. Claude's provider and your CLI configuration determine how submitted content is processed and retained.
- **Optional Claude narrative cuts:** enabling Claude analysis in Auto-cut sends the project's timed transcript and scene names/times through the installed Claude Code CLI. It does not send media files, local source paths or chat history. This can use your Claude plan or incur provider charges. The planner has no editing tools; it returns unchecked cut proposals for review. Ordinary Auto-cut and Visualize use local processing and existing project content.
- **Installation/building:** npm dependencies, upstream runtime sources and optional models may be downloaded during setup. The static public website links to GitHub and Apple; those services have their own policies.

Local Whisper and local speech-following use local audio processing. Provider selection does not by itself authorize a cloud operation; the app sends content when the corresponding operation is invoked. An authorized MCP assistant can invoke such an operation using your configured provider.

## Local control boundary

The HTTP service binds to loopback and checks request hosts/origins. It has no per-client authentication token. Other programs running locally can call it; a configured MCP client can read and edit projects. Do not proxy it onto a public network. The MCP launcher may keep the local editing service running after a client disconnects.

Editor chat exposes only the request's scoped SceneForge editing tools through a temporary authenticated proxy. Built-in shell/file/browser tools and other MCP servers are disabled for that invocation. These CLI restrictions are not an operating-system sandbox. Administrator-managed settings, hooks and enforced plugins can still apply; SceneForge does not bypass them. Review your organization's Claude Code policy when relevant. Cancellation stops the owned CLI process and rejects later tool calls, but edits committed before cancellation remain visible and can be undone if no later edit conflicts. See the official [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) and [settings reference](https://code.claude.com/docs/en/settings-reference).

No diagnostic upload or public sharing service is built into this preview. Before posting an issue, inspect attachments and remove API keys, private media, scripts, personal paths and unrelated project data.
