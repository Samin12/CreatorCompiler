# A small video, made in SceneForge

[Watch or download SceneForge-demo.mp4](https://github.com/Samin12/SceneForge/releases/download/v0.1.0-preview.2/SceneForge-demo.mp4).

The 12-second sample contains three independently authored pastel scenes: **Write your story.**, **Make the cut.**, and **Export with confidence.** Its source visuals are generated color video, with local macOS speech narration. It contains no private footage or proprietary editor assets.

The installed SceneForge MCP server imported the sources, split the timeline at four and eight seconds, assigned the pastel backdrops, and added timed text, shapes, narration and captions. The editing transaction was committed and read back before SceneForge rendered the MP4. The final video was not composed by a separate external video editor.

The sample is 960 × 540 at 24 fps: 288 H.264 video frames plus AAC audio, exactly 12 seconds. Exported frames and captions were reviewed; each scene has audible narration, both scene boundaries are gap-free, and the complete file decodes successfully. This is a small synthetic demonstration, not a benchmark or proof of complete feature parity.

## Transcript

- “SceneForge. Write your story.”
- “Shape the rhythm. Make the cut.”
- “Ready to share. Export with confidence.”

The [MCP guide](MCP.md) describes the same inspect → stage → commit → inspect → export workflow for your own projects.
