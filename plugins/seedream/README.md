## Seedream

**Author:** acedatacloud  
**Type:** tool provider plugin  
**API:** `https://api.acedata.cloud/seedream/images`

### What it does

This plugin integrates **Ace Data Cloud Seedream Images API** as Dify tools for:

- Generating images from a prompt
- Editing images with a prompt and `image_urls`

### Tools

- `seedream_generate_image`
  - Inputs: `prompt` (required), `model`, `size`, `seed`, `sequential_image_generation`, `stream`, `guidance_scale`, `response_format`, `watermark`, `callback_url`
  - Outputs: `success`, `task_id`, `trace_id`, `data` (array of objects with `image_url`, optional `prompt`), `error`
- `seedream_edit_image`
  - Inputs: `prompt` (required), `image_urls` (required), other optional params same as generate
  - Outputs: same as generate

### Credentials

Requires `acedata_bearer_token` (paste the token without the `Bearer ` prefix).

### Packaging

```bash
dify plugin package plugins/seedream -o seedream.difypkg
```

