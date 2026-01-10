## Luma

**Author:** acedatacloud  
**Type:** tool provider plugin  
**API:** `https://api.acedata.cloud/luma/videos`

### What it does

This plugin integrates **Ace Data Cloud Luma Videos API** as Dify tools for:

- Generating videos (`/luma/videos`)

### Tools

- `luma_generate_video`
  - Inputs: `action`, `prompt`, `aspect_ratio`, `start_image_url`, `end_image_url`, `video_url`, `video_id`, `enhancement`, `loop`, `timeout`, `callback_url`
  - Outputs: `success`, `task_id`, `trace_id`, `data`, `error`

### Credentials

Requires `acedata_bearer_token` (paste the token without the `Bearer ` prefix).

### Packaging

```bash
dify plugin package plugins/luma -o luma.difypkg
```
