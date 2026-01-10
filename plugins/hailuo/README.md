## Hailuo

**Author:** acedatacloud  
**Type:** tool provider plugin  
**API:** `https://api.acedata.cloud/hailuo/videos`

### What it does

This plugin integrates **Ace Data Cloud Hailuo Videos API** as Dify tools for:

- Generating videos (`/hailuo/videos`)

### Tools

- `hailuo_generate_video`
  - Inputs: `action`, `prompt`, `model`, `first_image_url`, `mirror`, `callback_url`
  - Outputs: `success`, `task_id`, `trace_id`, `data`, `error`

### Credentials

Requires `acedata_bearer_token` (paste the token without the `Bearer ` prefix).

### Packaging

```bash
dify plugin package plugins/hailuo -o hailuo.difypkg
```
