## Kling

**Author:** acedatacloud  
**Type:** tool provider plugin  
**API:** `https://api.acedata.cloud/kling/videos`, `https://api.acedata.cloud/kling/tasks`

### What it does

This plugin integrates **Ace Data Cloud Kling Videos API** as Dify tools for:

- Generating videos from a prompt (`text2video`)
- Generating videos from an image (`image2video`)
- Extending an existing video by `video_id` (`extend`)
- Retrieving task status (`/kling/tasks`)

### Tools

- `kling_generate_video`
  - Inputs: `action` (required), `prompt`, `start_image_url`, `end_image_url`, `video_id`, `model`, `mode`, `duration`, `aspect_ratio`, `cfg_scale`, `camera_control`, `negative_prompt`, `mirror`, `callback_url`
  - Outputs: `success`, `task_id`, `trace_id`, `data`, `error`

### Credentials

Requires `acedata_bearer_token` (paste the token without the `Bearer ` prefix).

### Packaging

```bash
dify plugin package plugins/kling -o kling.difypkg
```
