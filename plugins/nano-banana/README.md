## Nano Banana

**Author:** acedatacloud  
**Type:** tool provider plugin  
**API:** `https://api.acedata.cloud/nano-banana/images`

### What it does

This plugin integrates **Ace Data Cloud Nano Banana Images API** as Dify tools for:

- Generating images from a prompt
- Editing images with a prompt and `image_urls`

### Tools

- `nano_banana_generate_image`
  - Inputs: `prompt` (required), `model`, `aspect_ratio`, `resolution`
  - Outputs: `success`, `task_id`, `trace_id`, `data` (array of objects with `image_url`, optional `prompt`), `error`
- `nano_banana_edit_image`
  - Inputs: `prompt` (required), `image_urls` (required), `model`, `aspect_ratio`, `resolution`
  - Outputs: `success`, `task_id`, `trace_id`, `data`, `error`

### Credentials

Requires `acedata_bearer_token` (paste the token without the `Bearer ` prefix).

### Packaging

```bash
dify plugin package plugins/nano-banana -o nano-banana.difypkg
```
