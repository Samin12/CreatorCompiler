# SceneForge local API

The editor and stdio MCP server use the same loopback HTTP service. The default base URL is `http://127.0.0.1:4174/api`. The service binds to `127.0.0.1`, checks request hosts and permitted local origins, and has no per-client authentication token. Do not expose it through a public proxy. See [privacy and local control](../../docs/PRIVACY.md).

JSON is the default request/response format. Errors use `{ "error": "message" }`: validation failures generally return `400`, missing files/resources `404`, and stale conditional project writes `409`. Binary routes and server-sent events are exceptions. The JSON body limit is 30 MB.

The independent model is defined in [types.ts](types.ts). Times are seconds. Clip source bounds are source-media seconds; `speed` maps them to timeline duration. Transform positions and dimensions are normalized to the canvas; corner radii are canvas pixels. Imported original media is referenced without overwriting it. This contract is not compatible with another editor's private API.

## Capabilities and launcher discovery

| Route | Response |
| --- | --- |
| `GET /ready` | `{application:'SceneForge',version:string}` immediately, without media probing. Launchers poll this. |
| `GET /health` | Capability object below, plus `dataDir`. |
| `GET /capabilities` | The same capability object without `dataDir`. |

The media capability probe (FFmpeg encoder list and a VideoToolbox test encode) starts in the background when the service boots and is memoized, so `/health` normally answers without waiting for it.

```ts
{
  application: 'SceneForge',
  version: string,
  ffmpeg: boolean,
  ffprobe: boolean,
  hardwareEncode: boolean,
  transcription: { local: boolean, command?: string, providers: string[] },
  vision: {
    personSegmentation: boolean,
    faceDetection: boolean,
    engine: 'Apple Vision',
    limitations: string[]
  },
  mcp: { command: string, args: [], toolCount: number }
}
```

`mcp.command` uses `SCENEFORGE_MCP_COMMAND` when provided. The packaged bootstrap derives that value from the actual app bundle, including an app moved to `/Applications`. An unconfigured development service falls back to `~/Applications/SceneForge.app/Contents/MacOS/sceneforge-mcp`; that fallback is not proof the launcher exists. The current source tool count is 39; earlier validated packages expose 31. Discovery describes the running service's tools; it does not assert that an assistant is connected. Capability flags describe detection/platform support rather than a guarantee that every device, codec or model request succeeds.

## Projects and conditional writes

| Route | Body | Response |
| --- | --- | --- |
| `GET /projects` | — | `ProjectSummary[]`, most recently updated first; optional `thumbnailMediaId`. |
| `POST /projects` | `{name?:string}` | New `Project`. |
| `GET /projects/:id` | — | `Project`, with quoted SHA-256 `ETag`. |
| `PUT /projects/:id` | Complete `Project`; body ID must match route ID | Saved `Project`, with its new quoted `ETag`. With `Prefer: return=minimal`, `{minimal:true,id,updatedAt}` and the same `ETag`. |
| `DELETE /projects/:id` | — | `{ok:true}`; moves project JSON to local trash. |
| `POST /projects/:id/duplicate` | — | Independent project copy with a new ID. |
| `GET /projects/:id/history` | — | Up to 100 `{id,createdAt,name}` entries. |
| `POST /projects/:id/restore` | `{historyId:string}` | Restored `Project`, with a checkpoint of the prior state. |
| `POST /projects/:id/checkpoint` | — | Saved `Project`, with an explicit history checkpoint. |

`ETag` is the SHA-256 revision of the persisted project JSON. Send that exact quoted value as `If-Match` on a subsequent `PUT`. The service serializes writes per project, checks the expected revision against current committed state, validates the project and atomically replaces the JSON file. It assigns `updatedAt`; clients should adopt the returned project and revision.

`Prefer: return=minimal` is for the editor's autosave. The service stores the request body unchanged except `updatedAt`, so the minimal response means the committed project equals the request with that one value replaced (key order unchanged) and its revision is the returned `ETag`. If that equality cannot be guaranteed the full project is returned instead, so clients must accept either shape (`Preference-Applied: return=minimal` marks the minimal one). Requests without the header are unaffected.

Project files are compact JSON, and the revision is the SHA-256 of exactly that JSON. History snapshots are copies of the committed file. The service caches the committed JSON and revision keyed by file identity, so reads of an unchanged project and conditional writes do not reparse it; any external change to the file is detected and reread.

A stale or missing current project with a supplied revision returns `409` without writing or emitting a save event. `If-Match` is supported but **not mandatory** at the raw HTTP layer: omitting it permits an unconditional write. The editor and MCP transaction client use conditional writes. Comparing `updatedAt` alone is not the concurrency contract. The endpoint accepts a single exact revision; HTTP wildcard/list/precondition negotiation is not implemented.

History restore now requires a reviewed `If-Match` revision. The optional-header behavior above applies to `PUT /projects/:id`, not restore or the recovery routes below.

## Reviewed project and media recovery

Recovery contracts are defined in [recovery.ts](recovery.ts). Every recovery `POST` below requires a single exact lowercase SHA-256 `If-Match`, raw or quoted. Missing/malformed/stale revisions return `409`. They do not act on MCP transactions. Six external MCP tools map to these routes with runtime-validated arguments; none are available in in-app Claude chat.

| Route | Body | Response |
| --- | --- | --- |
| `GET /trash` | — | `{items:TrashProjectSummary[]}` with snapshot revisions and identity collisions. |
| `POST /trash/:trashId/restore` | `{asCopy?:boolean}` | `TrashRestoreResult`; collisions reject unless copy was explicitly selected. |
| `GET /projects/:id/media-recovery` (alias `/media-status`) | — | `MediaRecoveryInspection`; file status is separate from playback catalog status. |
| `POST /projects/:id/media-recovery/plan` | `{mediaId,replacementPath}` | `MediaRelinkPlan`; includes fingerprint, blockers, warnings and required acknowledgement IDs. |
| `POST /projects/:id/media-recovery/apply` | `{planId,acknowledgements?:string[]}` | `MediaRelinkResult`; fresh media UUID, returned project and revision. |
| `POST /projects/:id/media-recovery/undo` | `{planId}` | `MediaRelinkResult`; exact prior content restored with a new save timestamp/revision. |

Planning checks kind, audio presence, geometry, known frame rate and all used source bounds including retained effect intervals. It samples first-used and last-used video frames and early audio rather than decoding the whole file. Unknown original frame rate requires explicit acknowledgement. Apply verifies the replacement fingerprint again and uses conditional save; it does not overwrite a shared catalog record. A replacement changes only the chosen project's media entry, clip references and canvas background reference. History and duplicate projects retain their old identities.

Plans are in memory; unapplied plans expire after 30 minutes. Missing, expired, wrong-project or unusable plan state returns `410`. Undo must use the exact apply response revision and is blocked by later edits. Neither HTTP nor MCP automatically refreshes a review or retries a conflicting action. Trash restore consumes one snapshot after publishing the restored project without overwriting an existing ID. There is no permanent-delete route.

## Live project updates

`GET /events` returns `text/event-stream` with cache disabled. It immediately sends:

```text
event: ready
data: {}
```

After a successful saved write or move to trash, it emits:

```text
event: project
data: {"id":"project-id","revision":"raw-sha256","updatedAt":"ISO-time","action":"saved"}
```

`action` is `saved` or `trashed`. Unlike the HTTP `ETag`, the event revision is unquoted. A save made by the local transcription pipeline also carries `"source":"automatic-captions"`; that save changes only `captions` (plus `updatedAt`) relative to the revision it replaced, so a client can merge it without treating it as a conflicting edit. Save events follow durable atomic replacement; trash events follow the rename. Rejected writes emit nothing. A heartbeat comment is sent every 15 seconds. There are no event IDs or replay log; clients should re-read on `ready`/reconnection.

The editor waits for its own pending saves before handling an event, ignores its acknowledged save revision, and refreshes clean external changes. Unsaved edits cause a conflict notice and paused autosave instead of silent replacement. A clean externally trashed project closes. Clients must handle `trashed` even if its revision equals the last acknowledged saved revision.

## Composed frame inspection

`POST /projects/:id/inspect` reads committed project state and renders the requested frames:

```json
{"times":[0,2.5,8],"width":960}
```

The response is:

```ts
{
  frames: Array<{
    time: number,
    requestedTime: number,
    width: number,
    height: number,
    url: string // /api/inspection-images/<opaque-token>
  }>
}
```

Provide one to six finite times. The renderer clamps times to valid timeline frames and reports the actual frame-aligned `time` separately from `requestedTime`. The HTTP width is positive, clamped to 64–1920 and made even; aspect ratio is retained with a 4320-pixel height bound. MCP applies stricter inputs: nonnegative times and integer width 160–1920. A project needs a positive duration.

`GET /inspection-images/:id` serves the generated PNG. Its opaque route does not expose the local cache path. The route map is process-local; after a service restart, inspect again if a previous URL returns `404`. Cache identity incorporates committed project content, output dimensions and source-file identity. This endpoint does not render in-memory MCP transactions. The MCP tool `inspect_timeline` fetches these local images and returns actual MCP image content blocks plus timing/size metadata.

## Media, proxies and local Vision

| Route | Body/query | Response |
| --- | --- | --- |
| `POST /media/import` | `{paths:string[]}`, up to 100 absolute local paths | Registered `Media[]`. |
| `POST /media/upload` | Multipart field `files`, up to 100 files | Uploaded and registered `Media[]`. |
| `GET /media/:id/file` | — | Original file, with file/range serving. |
| `GET /media/:id/thumbnail` | — | Cached/generated JPEG. |
| `GET /media/:id/waveform` | — | `{peaks:number[]}`. |
| `POST /media/:id/proxy` | — | Asynchronous proxy `Job`. |
| `GET /media/:id/proxy` | — | Proxy file when available, otherwise original. |
| `GET /media/:id/face-track` | `?start=<source-seconds>&end=<source-seconds>`; finite `start>=0`, `end>start`, range at most 30 seconds | `FaceTrack`: `{version:1,sampleRate:4,start,end,points:[{time,face}],subject:"largest-face"}`. A face is normalized `{x,y,width,height,confidence}` or `null`. |
| `GET /media/:id/vision` | `?time=<source-seconds>` | `{time,width,height,face,maskUrl}`. |
| `GET /media/:id/vision-mask.png` | `?time=<source-seconds>` | PNG subject mask: white subject, black background. |
| `POST /import/borumi` | `{path:string}` | Converted independent `Project`, with warnings for unsupported semantics. |
| `POST /import/project` | Complete `Project` | Imported project with a new ID. |

Vision uses Apple Vision locally on macOS. Face tracking samples the largest face at up to 4 Hz and interpolates crop motion for preview and export; it is not identity recognition or per-frame detection. Source-time tiles are shared across clip splits and export chunks. An aborted tracking request releases its consumer; shared work stops when no consumers remain. Missing detections and cold preview tiles can use a centered crop. The separate mask endpoint retains reduced resolution/cadence and debounced paused preview. All Vision route times refer to source media, not project time.

## Borumi copy export

Importing Borumi now preserves a managed SQLite snapshot under the local studio folder. Compatibility export writes a new bundle; it never writes the source bundle. Unknown preserved records and unsupported operations have explicit compatibility boundaries.

| Route | Body | Response |
| --- | --- | --- |
| `GET /borumi/templates` | — | `{templates:[{id,name}]}` for imports with preserved format metadata. |
| `POST /projects/:id/borumi/plan` | `{}` | `{revision,plan,requiresTemplate}` with supported changes, blockers and warnings. |
| `POST /projects/:id/borumi/export` | `{templateProjectId?:string,outputDirectory?:string}` | New-copy result and `sourceRevision`. |

Export requires `If-Match` equal to the reviewed plan revision; a missing or stale revision returns `409`. A new SceneForge project requires a prior-import template ID for observed native schema metadata. Optional `outputDirectory` must be an absolute local folder; omission uses the managed export folder. Resolved paths inside the original/template bundle are rejected, including symlink aliases. The exporter chooses a unique new bundle path and rejects unsupported project changes. Native opening was checked on the recorded acceptance fixtures; universal Borumi-version compatibility is not claimed.

## Recoverable recording

| Route | Body/query | Response |
| --- | --- | --- |
| `POST /recordings` | `{name:string,mimeType:string}` | `{id:string}`; `video/webm`, `audio/webm`, `video/mp4` or `audio/mp4`, with optional `;codecs=` parameters. |
| `PUT /recordings/:id/chunks` | `?index=<integer>`; nonempty `application/octet-stream`, maximum 16 MB | `{ok:true,index:number}`. |
| `POST /recordings/:id/finish` | — | Final registered `Media`. |
| `GET /recordings/recovery` | — | Incomplete recordings with metadata and a `chunks` count. |

Chunk indexes begin at zero and are sequential. Repeating the same index with identical bytes is safe; different bytes are rejected. Writes are serialized per recording, use temporary files/rename, and check free disk space. Finalization branches on the session's MIME type. WebM chunks are losslessly remuxed to `take.webm` to add duration and seek cues. MediaRecorder MP4 is fragmented, so its chunks concatenate byte-wise and are remuxed with stream copy to `take.mp4` with the index at the front (`+faststart`). `cat` streams the chunks in order into FFmpeg's standard input, one open file at a time, so there is no intermediate copy and no limit on take length from open-file limits. Finalization registers the media, records completion and responds; completed chunks are then deleted in the background, and any left behind by an interrupted cleanup are removed when the service next starts. The renderer creates sessions when its countdown starts, so a cancelled start leaves a session with no chunks. Recovery ignores those, and the service deletes ones older than five minutes, containing nothing but their metadata, when it next starts. Audio takes, and audio imported through `POST /media/import` with an `audioRole` (native system sound), warm their waveform cache in the background so take review does not wait for a decode. A warm waits while any recording session is open, so it never competes with the next take. Recovery of unfinished sessions handles both containers. A repeated successful finish returns the existing media. Capture streams themselves are managed by the renderer's MediaRecorder APIs.

## Export and jobs

| Route | Body | Response |
| --- | --- | --- |
| `POST /export` | `{projectId:string,options:ExportOptions}` plus reviewed `If-Match` | Durable `ExportRecord`; immutable snapshot persisted before queue. |
| `GET /jobs` | — | `Job[]`. |
| `GET /jobs/:id` | — | `Job`, or `404`. |
| `DELETE /jobs/:id` | — | Cancellation result `Job`, or `404`. |
| `GET /jobs/:id/download` | — | Attachment for a completed job with output. |

`ExportOptions` supports `mp4`, `webm`, `wav`, `srt`, `txt`, `md`, and `json`, with optional dimensions, FPS, quality, hardware preference, burned captions, and `{range:{start,end}}` in project seconds. Export reads committed state. Job status is `queued`, `running`, `complete`, `failed`, or `cancelled`; inspect `message`/`error` as well as `progress`. User exports are durable. Internal frame-inspection/proxy jobs remain ephemeral. `interrupted` is an additional export status after an unclean or graceful service shutdown.

## AI configuration and operations

| Route | Body/query | Response |
| --- | --- | --- |
| `GET /ai/settings` | — | `AISettings` without `apiKey`, plus `hasApiKey`. |
| `PUT /ai/settings` | Partial `AISettings`; an empty `apiKey` clears it | Redacted settings. |
| `POST /ai/transcribe` | `{projectId,mediaId}` | `{captions:Caption[],provider:string}` in source-media time. |
| `POST /ai/analyze` | `{projectId,kind:'silence'|'fillers'|'script',prompt?:string}` | `{suggestions:AISuggestion[]}` without applying changes. |
| `POST /ai/voice-follow` | `?projectId=<id>&cursor=<word-index>`; raw `audio/wav` | `{cursor:number,transcript:string,confidence:number}`. |

Transcription validates that the media belongs to the project. Explicit transcription runs at normal priority. Returned captions are proposals: map source ranges through all intended audible clip occurrences before saving timeline captions. Silence/filler/script analysis does not modify projects. Provider keys are saved locally with owner-only file permissions and are not encrypted in Keychain.

Voice following accepts mono 16 kHz PCM16 WAV batches, greater than zero and at most 10 seconds/350,000 bytes. It aligns speech against the joined project scene scripts; the cursor is the next script-word index. It forces local inference even when a cloud transcription provider is selected and permits one inference batch at a time. The validated WAV goes to Whisper without an FFmpeg conversion, and the joined script is reparsed only when the project's committed revision changes.

## Automatic transcription and quick actions

Shared contracts are in [automation.ts](automation.ts). Automatic transcription defaults to enabled and runs locally when an audible project is opened or saved. Imported or recorded media starts the pipeline once attached to a saved project. The global persisted setting does not change the provider used by explicit `/ai/transcribe` requests.

Media and clips may carry `audioRole: 'microphone' | 'system'` from explicit capture/import provenance. `POST /recordings` and `POST /media/import` accept this optional field; recording recovery and catalog reimports preserve it. During overlapping speech windows, an enabled microphone takes priority even if quiet; system sound is a fallback after untagged narration/video sources. Clip role overrides media role. Untagged older projects retain their original track/start/ID selection order. Filenames and audio levels never determine the role. Muted, zero-gain, music, image, and known-silent media are excluded.

| Route | Body/query | Response |
| --- | --- | --- |
| `GET /automation/settings` | — | `{automaticTranscription:boolean}`. |
| `PUT /automation/settings` | `{automaticTranscription:boolean}` | Saved setting; disabling cancels automatic queued/running jobs. |
| `GET /projects/:id/automation` | — | `{jobs:AutomationJob[]}`, up to 50 recent jobs. |
| `POST /projects/:id/transcribe` | `{force?:boolean}` | Local transcription job; source caches remain reusable. |
| `POST /projects/:id/quick-action` | `{kind:'auto-cut'|'visualize',semantic?:boolean}` | Asynchronous review job. `semantic:true` explicitly invokes optional Claude analysis for Auto-cut. |
| `GET /automation/:id` | — | Current persisted job snapshot. |
| `DELETE /automation/:id` | — | Cancelled job; previously saved project edits are not rolled back. |
| `POST /automation/:id/apply` | `{changeIds:string[]}` | `{job,project}` after applying only the named proposed changes. |
| `POST /automation/:id/undo` | — | `{job,project}` restored only while the applied revision remains current. |
| `GET /automation/:id/preview` | `phase=before|after&time=<seconds>&changes=<comma-separated-ids>` | Actual composed PNG at width 640. Omit changes for recommended defaults; an empty changes value previews no changes. |

`AutomationJob.status` is `queued`, `running`, `ready`, `complete`, `conflict`, `failed`, or `cancelled`. Quick actions stop at `ready`; they do not apply edits automatically. The proposal includes its base revision, changes/reasons, warnings, and before/after duration. Applying a stale proposal or undoing over a newer edit returns `409`. `/events` also emits `event: automation` with job snapshots. Source work uses one bounded worker queue, deduplicates active project/kind requests, and caches source transcripts by file/model identity. Automatic transcription runs FFmpeg and Whisper at macOS background QoS (`taskpolicy -b`) with two Whisper threads. It does not start while a browser recording session is open (created through `POST /recordings` and not yet finished) or within a few seconds of the last one finishing. A session that has not received a chunk yet (sessions are created at countdown start) stops deferring work after 10 seconds. Each chunk renews a session, and a session with no chunk activity for 60 seconds stops deferring work. The session closes only after chunk uploads queued before `finish` are written. A running automatic FFmpeg or Whisper process is suspended (`SIGSTOP`, with its timeout paused) when a capture opens and resumed afterwards. Cancellation and shutdown still terminate a suspended process. Requested jobs are not deferred. Interrupted jobs are reported failed after restart and can be retried.

The local pipeline chooses an audible primary narration track, maps source words through trims/speed, and preserves manual or edited captions. Background retry of the same failed/cancelled input is suppressed until explicit retry or changed input. Auto-cut selects measured quiet gaps that do not overlap transcript words; exact repeated phrases and optional Claude narrative cuts are unchecked review proposals. Cuts ripple synchronized timeline tracks and retime captions. Review intentional pauses and joins, including clip-relative effects after splitting. Visualize uses existing screen/camera media, a generated static dot grid, chapter slates and source labels. It reports missing proof instead of inventing external research or assets. These actions implement a bounded part of the reference editing workflow.

## Desktop renderer bridge

Electron exposes `window.sceneForge` through its isolated preload. The browser development editor does not have this bridge.

```ts
interface ShortcutStatus {
  active: boolean;
  registered: Array<{action:string; accelerator:string}>;
  conflicts: Array<{action:string; accelerator:string; reason:string}>;
}

interface SceneForgeBridge {
  platform: string;
  chooseMedia(): Promise<string[]>;
  chooseBorumi(): Promise<string | null>;
  reveal(path: string): Promise<void>;
  setShortcutContext(context: {
    workspace: 'home' | 'script' | 'record' | 'edit' | 'teleprompter';
    editable: boolean;
    timelineFocused: boolean;
    availableActions: string[];
    bindings?: ShortcutOverrides;
  }): Promise<ShortcutStatus>;
  onShortcutAction(callback: (action: string) => void): () => void;
  onShortcutStatus(callback: (status: ShortcutStatus) => void): () => void;
}
```

`ShortcutOverrides` is defined in [src/shortcuts.ts](../src/shortcuts.ts). Subscription methods return unsubscribe functions. Action payloads are action-ID strings, not synthetic key events. Report editable focus, workspace, supported actions and binding changes to the main process. The native bridge validates the sending renderer, intercepts handled menu combinations once, and preserves normal native text editing when an editable field has focus.

Only implemented recorder/word/sentence actions are eligible for OS-global registration, and only while Record or Teleprompter is active. Registration conflicts are reported; `active:true` identifies that workspace, not proof every requested shortcut registered. Loading, reloading, crashing or closing the window clears registrations. Named recorder presets and try-again actions are not implemented. See [keyboard behavior](../../docs/SHORTCUTS.md).

## MCP service relationship

[server/mcp.ts](../server/mcp.ts) is an independent stdio MCP server using the loopback API. `SCENEFORGE_URL` overrides the default loopback base. Importing its module does not start the server.

`begin_project_edit` clones the current project into an isolated in-memory transaction with its SHA-256/ETag revision. Staged reads and mutations use `tx_id`; `commit_project_edit` sends a conditional `PUT` with `If-Match` and a required human-readable summary. A conflicting commit fails and closes that transaction. Successful commits emit normal project events. Transactions expire after one hour and do not survive process restart. Frame inspection and export always read committed projects. The packaged launcher starts or reuses a healthy local service before opening the stdio transport. See the [MCP guide](../../docs/MCP.md) for the tool catalog and editing workflow.

## Claude Code editor chat

Shared types: `shared/agent-chat.ts`. `GET /api/agent/status?refresh=1` returns sanitized installed/version/authenticated/supported state. It never returns credentials.

- `GET /api/projects/:id/agent-chat` → `{jobs:AgentChatJob[]}` (local project chat history).
- `POST /api/projects/:id/agent-chat` with `AgentChatRequest` → asynchronous job. Request requires message, selectedClipIds (empty means no clip selection), playhead and optional range. No clip/range selection means explicit project scope.
- `GET /api/agent-chat/:id` → current job snapshot.
- `GET /api/agent-chat/:id/events` → SSE `job` events carrying full snapshots; initial snapshot is immediate.
- `DELETE /api/agent-chat/:id` → cancels owned CLI/ephemeral tool capability; returns job.
- `POST /api/projects/:id/agent-chat/:jobId/undo` → restored Project, only if current revision still equals the exact committed chat edit.
- `POST /api/agent-chat/:id/tools` is an internal stdio proxy endpoint requiring the private one-request bearer capability. It is not a general unscoped MCP endpoint.

Selected IDs and ranges are enforced against the staged commit; outside selected content is preserved. Hard ranges conservatively reject splitting clips when clip-relative fades/DSP would change outside content. Changes enter ordinary project version history. Cancellation does not roll back an already-accepted commit; guarded Undo is separate. Records of interrupted requests are marked failed on reload.

## Transcript ripple edits and effect origins

The browser's shared `cutTimelineRange` model operation removes a selected transcript interval on every track, retimes captions/scenes/elements/zooms/cursor points, and stores optional `Clip.effectTiming: {sourceIn:number, sourceOut:number}` on surviving split clips. These are original source seconds for fade phase and continuous denoise/normalization, not new media or a playback trim. `clipEffectTiming` derives the timeline offset/duration using the current speed. Values must be finite, nonnegative and increasing. Media preprocessing cache identity includes this original source interval. Projects omitting the field retain ordinary clip-local effects. A Borumi compatibility plan can reject effect origins it cannot represent.

Transcript deletion is one normal revision-guarded project save and one local Undo checkpoint. Word selection uses existing recognition timestamps, up to 20 ms padding bounded by adjacent words; text without valid word alignment is cut as a whole caption. The UI does not promise sample-accurate speech alignment from imperfect recognition.


## Durable export history and recovery

- `GET /api/exports?projectId=...&offset=0&limit=200` returns `{jobs:ExportRecord[],nextOffset:number|null,diagnostics:{unavailableCount,message?}}`. Limit is capped at 200; a full final page can return a next offset whose page is empty. Project filter is optional.
- `GET /api/exports/:id` returns public saved metadata and live output availability. The large project snapshot and source paths/fingerprints are not included.
- `POST /api/exports/:id/restart` accepts `{acknowledgeRuntimeChange?:boolean}` and creates a new job ID from the saved project and resolved options. It never changes the current project. Source content/realpath changes block restart. Renderer/source-code/tool changes require explicit acknowledgment. Concurrent retries of the same receipt, or another retry while its child is active, return 409.
- `DELETE /api/exports/:id` cancels an active export. Existing `/api/jobs` lookup/cancel/download routes also work for durable exports.
- `GET /api/exports/:id/download` checks completed output content/identity, then streams the verified open file. Missing, changed or unreadable output is unavailable rather than silently regenerated.

`ExportRecord` is defined in `shared/export-history.ts`. Its revision increases on persisted job updates; live filesystem availability can change without a revision increment. A refreshed equal-revision record may therefore update output availability. Snapshot and record files are private local JSON (mode 0600). Snapshots are separate and loaded on restart, not loaded for every history item. Up to 500 terminal receipt bodies are cached; older disk records remain addressable and list pages contain at most 200 entries. The small project/time index remains in memory.

Only one export service may own a data folder. A live owner blocks another service from changing job states. A dead owner is reclaimed under an exclusive claim before active receipts become `interrupted`. Incomplete ownership claims fail closed. Malformed/unsupported receipt files are preserved and reported through diagnostics; they do not prevent other projects or valid history from loading.

Recovery restarts the entire export. It does not resume chunks. Source media is referenced, not copied into a snapshot: SHA-256 checks run before initial queueing, before restart, and before successful completion. Hashing large source files adds I/O. This detects changed/missing sources at those checks but does not make external media immutable during the render. Graceful service shutdown interrupts jobs and terminates its owned encoders before releasing ownership; hard process termination is recovered at next startup.
