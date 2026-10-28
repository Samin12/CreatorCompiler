# Recover projects and missing media

These controls are available in the current source build. The earlier 31-tool desktop package does not include them; an updated package still needs acceptance testing.

## Restore a deleted project

Open **Trash** from the project library. Review the project name, deletion date and contents, then choose **Restore**. Creator Compiler restores its project file while retaining the existing source media and history.

If that project identity already exists, ordinary Restore stops. Choose **Restore as copy** to keep both projects. The recovered copy has a new identity and a “recovered copy” name. It shares references to the same source files; it does not duplicate footage or copy the original project's history into a new history folder.

Trash contains project files, not independent media backups. Moving or deleting the original footage can still leave a restored project with missing media. There is no permanent-delete control in this preview.

## Locate a source file

When files or playback references need attention, open **Locate media** from the project notice or media library. Select one source and choose its replacement file. Browser builds accept an absolute local path instead of opening the native chooser.

Creator Compiler checks the media kind, dimensions, audio presence, known frame rate and the source interval needed by your edits. Preserved effect intervals can require more footage than the visible clip. An unknown original frame rate requires an explicit acknowledgement. Incompatible candidates cannot be applied.

Review the original and replacement details before **Apply replacement**. Matching properties cannot establish that two files contain the same take. Validation hashes the candidate and decodes small video/audio samples; it does not decode every frame or prove whole-file integrity. The project revision and candidate file are checked again when applying.

Applying changes this project's source references, preserving clip timing and edits. Other projects and historical versions retain their earlier references. If the project or file changes after review, review the replacement again.

**Undo relink** restores the project immediately preceding that replacement if no later edit has changed it. After further edits or an app restart, review **Version history** instead. A replacement review expires after 30 minutes and does not survive restarting the service.

## Restore a saved version

Open **Version history**, select the version, and restore it after review. If the project changes while history is open, use **Refresh** before restoring. Creator Compiler refuses a stale restore so it cannot silently overwrite a newer revision.

## Agent access

The external MCP exposes media inspection, reviewed plan/apply/undo, trash listing and explicit restore-as-copy. The in-app Claude editing chat does not expose recovery tools. See the [MCP contract](MCP.md) for the required revisions and arguments.

Recovery runs locally. External MCP tool results can include source paths and project details, so the connected assistant's data handling still applies. See [privacy](PRIVACY.md).


## Saved exports

Current source builds retain export history with the project version, settings and source fingerprints used for each attempt. Open **Export**, then **History** to inspect a saved attempt. Closing the dialog leaves an active export running; **Cancel export** stops it. App/service interruption marks the attempt **Interrupted** instead of starting it again automatically.

Choose **Review saved export to restart**, check its saved version and settings, then **Restart saved export**. This creates a new attempt from the beginning. It does not replace current edits or resume partially rendered chunks. **Export current version** uses the current saved project instead.

Missing or changed source files block a saved restart. Rendering-tool changes require explicit acknowledgment because the result may differ. The snapshot preserves project data, not copies of source media; keep the original files available. Completed files that are missing, changed or unreadable are unavailable for download. A damaged history entry is reported while its original file and valid entries are preserved.

History is shown per open project with **Load older** pagination. External MCP clients can list retained export receipts independently of an open project with `list_export_jobs`; `restart_export` requires an explicit runtime-change choice. Both tools are excluded from in-app Claude chat. See [MCP recovery](MCP.md#saved-export-recovery).
