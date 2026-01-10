## SeeDance

**Author:** acedatacloud  
**Type:** tool provider plugin  
**API:** `https://api.acedata.cloud/seedance/videos`

### What it does

This plugin integrates **Ace Data Cloud SeeDance Videos API** as Dify tools for:

- Generating videos from a prompt (optionally with reference images)

### Tools

- `seedance_generate_video`
  - Inputs: `prompt` (required), `model`, `first_frame_url`, `last_frame_url`, `reference_image_urls`, `return_last_frame`, `service_tier`, `execution_expires_after`, `callback_url`
  - Outputs: `success`, `task_id`, `trace_id`, `data`, `error`

### Credentials

Requires `acedata_bearer_token` (paste the token without the `Bearer ` prefix).

### Packaging

```bash
dify plugin package plugins/seedance -o seedance.difypkg
```
