# Edit with Claude Code

SceneForge's **Ask Claude** panel turns an editing request into changes you can inspect on the timeline. It runs your installed Claude Code CLI with a limited set of SceneForge tools. This is separate from the [external MCP connection](MCP.md). Media relinking and trash recovery are excluded from this chat in every scope; use the recovery UI or the external recovery tools after explicit review.

## Connect your existing account

1. Install Claude Code using its [official setup guide](https://code.claude.com/docs/en/setup). SceneForge requires **version 2.1.248 or later**; Claude Code is not bundled with the app.
2. In Terminal, check `claude --version` and `claude auth status`. If you are not signed in, run `claude auth login`. Existing sign-in can be reused. See the official [CLI reference](https://code.claude.com/docs/en/cli-reference).
3. Open a SceneForge project, switch to **Edit**, and click **Ask Claude** beside **Back to recording**. Click **Refresh** in the Claude editor panel. The status should report **Claude Code · signed in** before Send becomes available.

SceneForge checks the installed command and its authentication status. It does not copy Claude credential files or ask for a Claude API key. Your Claude account, configuration, usage limits and provider costs still apply. If the command is not found, verify it works in Terminal and reopen SceneForge; advanced setups can set `SCENEFORGE_CLAUDE_PATH` to the CLI executable in the environment that launches the app.

## Choose what the request may change

- **Clips:** with the select tool active, drag a rectangle over empty timeline space across the clips you want. Shift-drag adds to the selection; Escape cancels an unfinished rectangle. The panel shows the selected count and expandable clip names, times and IDs.
- **Time range:** Shift-drag the timeline ruler, or use **Add a time range** in the panel. Check the **From** and **To** values, in seconds. A range can be combined with selected clips.
- **Entire project:** clear both the clip selection and time range. The context chip explicitly says **Entire project**. Project-wide canvas, settings, scene or cursor changes require this scope.

A missing clip or selection of non-clip items blocks Send until you correct or clear the selection. SceneForge does not silently widen it. Selected clips restrict which original clips can change; a time range preserves content outside its bounds. Some cuts across fades, speed changes or audio/Vision processing cannot preserve outside content exactly and are rejected. Select the complete affected clip or make the required split yourself before retrying.

## Send, review and undo

1. Check the displayed selection and range, then write a concrete request. For example: **“Set the gain of these two clips to 50%, keeping their timing unchanged.”**
2. Press **Send** or **⌘ Enter**. Pending local changes are saved first. The project, selection, range and playhead are fixed for that request; changing your selection while it runs does not retarget it.
3. Follow the activity and response in the panel. Tool changes appear after a successful commit. Play the affected section and inspect the result. A response alone is not proof that the intended edit succeeded.
4. Choose **Undo this edit** to restore the pre-edit project. It is guarded by the committed revision and refuses to overwrite later changes. If later edits exist, review the project's saved history instead of expecting this button to discard them.

Revision checks also reject an assistant commit when the project changed underneath it. Resolve the conflict and make a fresh request against the current project. **Cancel** stops the running request and rejects subsequent tool calls; changes committed before cancellation remain and can be reviewed or undone when the revision guard permits.

## Tools, data and limits

The panel provides scoped reads, composed-frame inspection and staged editing. It cannot use SceneForge tools to access another project, import arbitrary media, export a video or request cloud transcription. Use the app's normal controls, or configure the broader [MCP connection](MCP.md), for those operations.

Requests include your prompt, project identity, selected IDs/range, playhead, relevant timeline data and up to four completed conversation turns from the same project. Normal tool responses omit local source paths and importer metadata. Composed frames may include overlapping unselected layers. **Selection is an editing boundary, not strict layer-data privacy**, and earlier conversation turns may contain broader project context. See [Privacy and local data](PRIVACY.md).

Built-in shell/file/browser tools and unrelated MCP servers are disabled for this invocation. Those CLI restrictions are not an operating-system sandbox: managed policies, hooks and enforced plugins may still apply. SceneForge does not bypass your Claude Code configuration.

There is one active request per project and at most two across the app. A request is limited to 24 agent turns, ten minutes and 8 MB of response output. Chat and pre-edit snapshots are stored locally, with retention limited to 50 turns or 128 MiB per project. Interrupted requests are marked failed after a service restart. Completed history and guarded Undo persist; moving a project to trash does not erase its chat history.

See [validation status](VALIDATION.md) for tested behavior and remaining release checks.
