# AI control with MCP

The current source provides 39 tools backed by the local editing service, including six media/trash recovery tools and two durable-export recovery tools. The uninstalled tracking/export candidate passed 39-tool discovery and saved-export recovery. Older installed packages expose 31 tools; they require an updated build for recovery. Check `tools/list` on the server you actually use. Use the packaged launcher shown in [the README](../README.md#ai-control-with-mcp), or run `npm run mcp` from `app` while the matching development service is running. `SCENEFORGE_URL` can point to a different loopback service URL; remote HTTP hosts are rejected.

For the in-app **Ask Claude** panel, see [Edit with Claude Code](CLAUDE-CHAT.md). That panel reuses local Claude authentication and exposes a smaller, selection-aware editing toolset; the connection described here has broader project and export access.

## Editing workflow

1. Call `get_guides`, `list_projects`, and `get_project_overview`. For a new experiment, `duplicate_project` protects the existing edit.
2. Use `get_timeline`, `get_scenes`, and `get_transcript` as needed. Use `inspect_timeline` with the project ID and up to six times in **seconds** to see actual composed frames of committed state.
3. Call `begin_project_edit` and retain its `tx_id`. Read and change that transaction rather than guessing from stale data.
4. Stage edits. Read the staged `get_project` or `get_timeline` and check timing, source bounds, layers, text and audio settings.
5. Call `commit_project_edit` with a concrete `change_summary`, or `abort_project_edit`. A changed committed revision causes a conflict; reread and begin again. Transactions are isolated in memory, expire after one hour, and disappear on server restart.
6. Inspect actual frames **after commit**. `inspect_timeline` does not render staged state. A clean open editor updates automatically; a dirty editor preserves its local changes and pauses autosave until the conflict is resolved.
7. Call `export_video`, poll `get_export_status`, and inspect the resulting output. Use `cancel_export` when needed.

Importing media registers a local asset even if its edit transaction is later aborted; it does not overwrite the source file. The transaction commit applies timeline/project changes, not an atomic filesystem rollback of imported catalog records.

## Tool catalog

| Purpose | Tools |
| --- | --- |
| Orientation | `get_guides`, `list_projects`, `get_project`, `get_project_overview` |
| Project creation | `create_project`, `duplicate_project` |
| Read content | `get_scenes`, `get_timeline`, `get_transcript`, `inspect_timeline` |
| Transaction | `begin_project_edit`, `commit_project_edit`, `abort_project_edit` |
| Edit structure | `rename_project`, `update_scenes`, `add_clips`, `update_clip`, `split_clip`, `delete_clips`, `trim_timeline` |
| Composition | `update_canvas`, `set_captions`, `set_elements`, `set_zooms`, `set_cursor`, `import_media` |
| Export | `export_video`, `get_export_status`, `cancel_export`, `list_export_jobs`, `restart_export` |
| AI proposals | `request_transcription`, `analyze_project` |
| Media recovery | `get_media_status`, `plan_media_relink`, `apply_media_relink`, `undo_media_relink` |
| Deleted projects | `list_trashed_projects`, `restore_trashed_project` |

`request_transcription` returns source-media timestamps without applying captions. Retiming them through every audible clip occurrence is the client's responsibility. Silence/filler/script analysis returns proposals; it does not apply them. `trim_timeline` removes overlapping caption blocks, so review or regenerate affected captions after cuts.

The canonical schema is [shared/types.ts](../app/shared/types.ts), and tool argument schemas are in [server/mcp.ts](../app/server/mcp.ts). Timing is seconds; clip source bounds and speed define duration. Clip transforms are normalized to canvas dimensions; corner radii are canvas pixels. Read existing objects and preserve required fields rather than inventing a different editor's schema.

## Reviewed recovery

Recovery operates on committed projects. All six tools reject `tx_id` and unexpected arguments at runtime. Finish or abort staged edits first: a recovery changes the project revision, so an earlier transaction cannot overwrite it. These tools are excluded from **Ask Claude**, including its whole-project scope; use the recovery UI or an explicitly connected external MCP client.

1. Call `get_media_status` with `project_id`. Review each file's availability and separate `catalogStatus`: an existing file can still have a missing or mismatched playback reference. Keep the returned `revision`.
2. Call `plan_media_relink` with `project_id`, `media_id`, an absolute `replacement_path`, and `expected_revision` equal to that reviewed revision. This probes and samples decoding, checks required source bounds including retained effect timing, and fingerprints the replacement. Review `compatible`, `blockers`, `warnings`, `requiredAcknowledgements`, source details and fingerprint with the user. Sampling is not a full-file integrity check or proof that two recordings contain the same content.
3. Only apply a compatible, reviewed plan using `apply_media_relink` with `project_id`, `plan_id`, the plan's `revision` as `expected_revision`, and `acknowledgements` containing exactly the warning IDs the user accepted. Unknown original frame rate requires an explicit acknowledgement; never infer consent. Replacement bytes are checked again before applying. A fresh media ID repairs references only in the selected project; other projects, prior history and the old catalog entry are preserved.
4. Keep the apply response. `undo_media_relink` accepts `project_id`, `plan_id`, and its returned `revision` as `expected_revision`. It restores the exact prior project content only while that applied revision is still current. Later edits require review instead of a forced undo.

For deleted projects, call `list_trashed_projects`, then review the chosen item and its `collision` flag. Call `restore_trashed_project` with `trash_id` and the item's `revision` as `expected_revision`. The default `as_copy:false` restores the same project identity and rejects a collision. Only an explicit user choice should set `as_copy:true`, which creates a fresh project identity while keeping the existing project. The consumed trash item cannot be restored twice. No permanent-delete tool is supplied.

`expected_revision` must be the exact 64-character lowercase hexadecimal revision, without quotes; the MCP adapter supplies the HTTP `If-Match` header. There is no automatic refresh, retry, overwrite or fallback to a copy. HTTP `409` conflicts and `410` unavailable/expired review plans are returned as MCP errors with their HTTP status. After a conflict, obtain fresh state and review a new action; do not substitute the latest revision into an old approval. Relink plans expire after 30 minutes before application and disappear on service restart; guarded undo also depends on that service's retained applied plan.

## Trust and provider use

There is no connected-client badge asserting that a particular assistant is trusted or authenticated. The connection grants local editing capability. Read [privacy](PRIVACY.md) before connecting an assistant, especially one backed by a hosted model. Cloud AI operations use the provider and key configured in Creator Compiler; costs and provider policies are separate.


## Saved export recovery

Call `list_export_jobs` with an optional `project_id`, `offset` and `limit` (1–200) to inspect saved versions, settings, status and output availability. `nextOffset` advances through history. These are durable user exports; temporary frame-inspection jobs are excluded.

After reviewing one receipt, call `restart_export` with its `job_id` and explicit `acknowledge_runtime_change:false`. Changed or missing source content blocks recovery. If the response reports changed rendering tools, review that change and obtain an explicit decision before using `true`; the adapter never changes this flag or retries automatically. The new job renders the saved version and settings from the beginning, without changing the current project. Poll its returned ID with `get_export_status`. This is restart, not partial-chunk resume. Both saved-export tools are excluded from in-app Claude editing scopes.
