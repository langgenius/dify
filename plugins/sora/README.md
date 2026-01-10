## Sora

**Author:** acedatacloud  
**Type:** tool provider plugin  
**API:** `https://api.acedata.cloud/sora/videos`

### What it does

This plugin integrates **Ace Data Cloud Sora Videos API** as Dify tools for:

- Generating videos from a prompt
- Generating videos from images (optional `image_urls`)

### Tools

- `sora_generate_video`
  - Inputs: `prompt` (required), `model` (required), `duration`, `size`, `orientation`, `image_urls`, `character_url`, `character_start`, `character_end`, `callback_url`
  - Outputs: `success`, `task_id`, `trace_id`, `data`, `error`

### Credentials

Requires `acedata_bearer_token` (paste the token without the `Bearer ` prefix).

### Packaging

```bash
dify plugin package plugins/sora -o sora.difypkg
```
