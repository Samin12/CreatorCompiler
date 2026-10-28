# Borumi project compatibility

**Recording-take history:** both export paths reject projects with Creator Compiler saved/archived takes, because that independent history cannot be preserved in Borumi. Keep the Creator Compiler project or export a video instead. This does not remove native archive records from the original snapshot used by an otherwise supported copy export.

Creator Compiler can import the SQLite project format observed in Borumi 0.32.0. Compatibility is partial: importing a project does not mean every original effect is rendered identically, and other Borumi versions have not been verified.

The compatibility exporter creates a **separate `.bmprojbundle`**. It never writes into the selected Borumi project. Export is blocked when the current changes cannot be represented by the supported mapping. It does not silently flatten an unsupported edit into a rendered movie.

## Export from the editor

Open **Export → Borumi project…**, then choose a destination folder or keep the default Creator Compiler export folder. **Preview edits** checks the current saved project and lists supported changes, limitations and any blockers. **Export copy** becomes available only after a successful review. If the project changes, review it again.

New Creator Compiler projects also require a format template selected from a previously imported Borumi project. Only its schema and migration records are used. Imports made before source preservation was available must be reimported to enable a preserved copy; the existing Creator Compiler project remains saved.

The completed dialog shows the new bundle path, with **Show in Finder** in the desktop app. Closing the dialog does not cancel a copy already being written. The original source is never a valid destination, including through a folder alias. Export does not overwrite an existing bundle.

## Import and preserved copies

Imports made with preservation enabled retain a consistent SQLite snapshot, the imported baseline and source IDs in Creator Compiler's local data folder. Media remains at its original location until a copy is exported. Keep the original media available; a missing or changed source file stops export.

An imported project's copy can currently include these changes:

- Project name, scene names and scene scripts. Edited scripts become plain paragraphs; untouched native rich text is preserved.
- Canvas width and height.
- Positive audio gain, mapped to native decibels.
- Horizontal flip on native video clips.
- Start, source range and speed for an imported clip that corresponds to one native segment, within the original scene's boundaries and without changing its duration.
- Existing plain text overlay content, timing and rectangle.
- Source-preserving splits of basic native audio/video clips, including clips imported as multiple layout pieces.
- Synchronized ripple deletion from basic audio/video tracks. Every overlapping track must remove the same source-time ranges, and scene timing must follow that same deletion. Static instant layouts are retimed with the cut.

Split/delete export validates each clip's preserved origin and source interval. Old imports without explicit clip ancestry work only when the origin is unambiguous. Arbitrary new clips, duplicated footage, moves, gaps, speed changes during structural edits, per-track ripple edits and deletion of an entire scene remain blocked. The same operations remain available inside Creator Compiler; these restrictions apply to writing a compatible Borumi copy.

Splitting or trimming through native transitions, automatic face tracking, voice enhancement or other stateful processing is blocked when its exact continuity has not been verified. Ripple changes involving unsupported timed controls, media overlays, music or generated backgrounds are also blocked. These native settings are preserved rather than removed to make an export succeed. Independent changes to scene order, media membership or paths, mute state, visual transforms, most effects, caption content/style, zooms and cursor settings remain unsupported. Caption/cursor timing produced solely by a validated ripple operation is checked against that same cut map; this does not enable new caption or cursor effects.

Native fields and files that Creator Compiler does not edit are retained in the exported copy. This preserves the original native appearance of those settings when Borumi opens the copy, even when Creator Compiler's preview uses an approximation. Symbolic links and special files are rejected rather than followed outside the selected bundle.

The copy receives a new project ID and starts a new native history. A consistent source database snapshot, including its original history, is kept inside `.sceneforge/original-project.sqlite`. The exported bundle therefore contains original source media and archived project data as well as the current edit. Creator Compiler does not invent native commit hashes.

## Projects created in Creator Compiler

A separate, narrower exporter constructs a fresh native database from Creator Compiler content. It needs the schema/migration metadata of a previously imported Borumi 0.32.0 project. No source project's media, scripts, records or history are used in the new project.

The current mapping supports contiguous scenes, scripts, video/audio sources, screen and camera video, narration and music, source trims, video/narration speed, positive gain and horizontal video flip. Explicit microphone/system-audio roles are retained, with a clip's role taking precedence over its media's role. Static custom layouts preserve supported rectangles and order. It currently requires a solid canvas with zero canvas padding/radius, and rejects effects, captions, shapes, cursor paths, overlapping videos on the same content track, and unsupported transform combinations. Each clip must fit within one scene, whose duration ends at its final video or narration clip.

This is not universal interchange. Unsupported changes must remain in Creator Compiler or be revised before exporting a native copy.

## Verification status

| Check | Status |
| --- | --- |
| Synthetic import → edit → copy → reimport | Passed; supported values and unknown records/assets checked |
| Original database unchanged during copy | Passed, including a live SQLite WAL snapshot test |
| Unsupported edit, changed media, symbolic link and snapshot tampering guards | Passed |
| New Creator Compiler AV project → native database → reimport | Passed; no original project content/history in output |
| Real imported project copy with gain and trim edits | Passed native opening, timeline readback and composed-frame rendering; original database hash unchanged |
| New Creator Compiler project opened and rendered in Borumi | Passed with a synthetic three-second audiovisual project and native script readback |
| Imported basic AV → split → Borumi copy | Passed native timeline readback and four byte-identical corresponding frame renders |
| Imported basic AV → split and synchronized ripple delete → Borumi copy | Passed; native duration changed from 3.0 to 2.5 seconds, audio/video source ranges matched, and four corresponding rendered frames were byte-identical |
| Audio from structural copy exports | Passed; decoded 48 kHz mono samples were identical to control copies edited through Borumi's own split/trim tools (144,000 samples for split, 120,000 for ripple) |
| Real imported project → unprocessed audio split → Borumi copy | Passed native opening, the two source-contiguous audio segments, unchanged project duration and composed-frame rendering; original database hash unchanged |
| Unchanged frame in the imported copy | Byte-identical to the original native render at the same frame |
| Editor copy-export workflow | Passed 25 isolated UI/API checks, including both real output paths, selected folder, blockers, stale revisions and late responses |
| All Borumi versions, all features, every project | Not established |

Native opening was checked through Borumi’s own local MCP on this Mac. The structural-edit examples cover basic AV and static layouts; they do not establish complex-effect ripple compatibility. These examples do not establish universal compatibility: a database integrity check and Creator Compiler reimport alone do not prove that Borumi accepts or renders a project correctly.
