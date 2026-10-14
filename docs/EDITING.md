# Transcription and quick edits

Automatic transcription is enabled by default. When a project with audible source clips is opened or saved, SceneForge uses its local speech model and maps the words through the clip trims and playback speeds. The downloaded app includes an English model. Other languages need a suitable local model.

Change **Settings → AI & transcription → Automatic transcription** to turn it off. The Transcript panel shows progress, Cancel and Retry. Automatic jobs run locally even when a cloud provider is selected for manual AI requests. Existing or manually edited captions are preserved where they overlap generated words. Speech recognition can be wrong; listen before deleting or exporting.

## Delete words and their footage

In **Edit → Transcript**, drag across timed words to select a phrase. The selection shows its time interval. Press **Delete** or **Backspace**, or click **Delete selection**, to remove that interval from all timeline tracks and close the gap. SceneForge adjusts captions and other timed items with the edit. Use **Undo** to restore it.

Double-click selects a sentence. Shift-arrow extends a selection; Escape clears it. Select All while the transcript has focus selects the transcript words. Text without usable word timing is selected as a whole caption. When recognized words overlap, check the interval notice and playback before keeping the cut.

## Auto-cut

Choose **Auto-cut** near the editor controls, then **Create proposal**. SceneForge checks local audio against transcript timing for quiet gaps and identifies exact repeated-take candidates. These are suggestions; repeated material may be intentional. Read the reason and interval for each proposal, then choose which to apply.

The optional **Ask Claude for narrative cuts** checkbox is off by default. Enabling it sends timed transcript and scene context to your installed Claude Code account. Provider usage and costs apply. This analysis returns proposals; it does not apply edits on its own. Ordinary Auto-cut does not require Claude or cloud processing.

## Visualize

Choose **Visualize** to propose a consistent canvas treatment, chapter titles and labels tied to existing screen sources. It uses local project content. It does not browse for evidence, verify external claims, generate missing source footage or complete an external publishing/mastering workflow. Review any notes explaining missing evidence or unsupported treatments.

## Review and apply

Quick actions currently plan for the **entire project**. Timeline clip selection does not limit them. For a selection-scoped conversational edit, use [Ask Claude](CLAUDE-CHAT.md).

1. Read each proposed change and its reason. Clear any you do not want.
2. Choose a frame time and click **Compare frames** for actual before/after rendered images. Both frames use the same timeline time; cuts can move later content into that time.
3. Click **Apply selected**, then play the result and listen across cuts.
4. Use **Undo this action** if needed. It refuses to overwrite later edits; use Version history when the project has changed since application.

A newer project revision blocks stale proposals. Closing the panel lets a running job continue; use **Cancel action** to stop it. Before/after frames show the proposed visual result at those times, but do not establish audio continuity, factual accuracy or the quality of the whole export.

See [privacy](PRIVACY.md), [validation](VALIDATION.md) and [known limits](LIMITATIONS.md).


## Local face centering

In current source builds, face centering follows the largest detected face during both preview and export. It samples locally through Apple Vision at up to four times per second and interpolates crop motion between detections. Source-time tracking is preserved across clip splits, playback speed and render chunks.

This is not identity recognition. Multiple people, fast movement, occlusion or weak detections can cause a subject switch, lag or centered fallback. A cold preview may show a centered crop while its tracking tile prepares. Review framing before export; exact Borumi tracking behavior is not claimed. This source change still needs acceptance in an updated desktop package.


## Arrange layers and snap clips

Drag a clip up or down onto another compatible video/audio row. Drop on the line between rows to create a layer; the highlighted row or insertion line shows the destination. A mostly vertical drag keeps its exact time. Selected clips move together and retain their offsets. Escape cancels a drag; Undo restores the move.

The magnet button (N) snaps clip edges to nearby clips, scene boundaries and the playhead, with an alignment guide. Its distance follows the visible timeline width rather than rounding time to tenths. Turn the magnet off for free placement. Magnetic insertion that automatically reorders neighboring clips is not implemented.

## Camera frame and shadow

New screen-and-camera takes use a rounded Creator camera frame with a soft shadow. The Layout panel's **Creator** preset applies the companion screen/camera composition. Corner radius and shadow color, opacity, blur and offsets remain editable. Existing edited takes keep their saved styling. The same shadow settings are rendered in the preview and exported video.

## Moving dotted canvas

New projects use a dark dotted background with slow diagonal motion. In Canvas → Background, choose Moving dots or Solid color. Motion follows the playhead and remains continuous through cuts and export chunks. Existing projects and imported media backgrounds are not changed automatically.

Use the timeline layer controls to add video/audio rows, rename custom rows or remove them. Removing a row preserves its clips by returning them to compatible rows; Undo restores the operation.

## Scene groups and scene actions

Drag a scene header in the timeline or the grip on a recording scene card to reorder it. Scene media, captions and timed graphics travel with their scene; boundary-spanning content is split with its source timing retained. Use the scene card menu or Alt+Up/Down for keyboard reordering.

Each scene has Auto-cut and Visualize actions. Review proposals and rendered frames before applying them. Scene-only cuts preserve the other scene groups and move later scenes to close removed time; scene-only visualization changes only that scene’s content. The top toolbar actions still apply to the entire project.

## Timeline space and audio levels

Drag the divider above the timeline upward for more vertical room. Its height is saved on this Mac; double-click the divider to reset it. The zoom buttons, slider and modifier-wheel shortcuts change the timeline scale. Waveforms show the source audio envelope inside clips and follow trims and playback speed; press E or use the waveform button to show or hide them.
