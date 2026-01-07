## Veo

**Author:** acedatacloud  
**Type:** tool provider plugin  
**API:** `https://api.acedata.cloud/veo/videos`, `https://api.acedata.cloud/veo/tasks`

### What it does

This plugin integrates **Ace Data Cloud Veo Videos API** as Dify tools for:

- Generating videos from a prompt (`text2video`)
- Generating videos from images (`image2video`)
- Fetching 1080p version by `video_id` (`get1080p`)
- Retrieving task status (`/veo/tasks`)

### Tools

- `veo_generate_video`
  - Inputs: `action` (required), `prompt`, `image_urls`, `video_id`, `model`, `aspect_ratio`, `translation`, `callback_url`
  - Outputs: `success`, `task_id`, `trace_id`, `data`, `error`
- `veo_task_retrieve`
  - Inputs: `task_id` (required)
  - Outputs: `success`, `data`, `error`
- `veo_task_retrieve_batch`
  - Inputs: `task_ids` (required)
  - Outputs: `success`, `data`, `error`

### Credentials

Requires `acedata_bearer_token` (paste the token without the `Bearer ` prefix).

### Packaging

```bash
dify plugin package plugins/veo -o veo.difypkg
```
