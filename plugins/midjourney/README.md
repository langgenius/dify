## Midjourney

**Author:** acedatacloud  
**Type:** tool provider plugin  
**API:** `https://api.acedata.cloud/midjourney/*`

### Tools

- `midjourney_imagine`
- `midjourney_edits`
- `midjourney_describe`
- `midjourney_translate`
- `midjourney_videos`

### Credentials

Requires `acedata_bearer_token` (paste the token without the `Bearer ` prefix).

### Packaging

```bash
dify plugin package plugins/midjourney -o midjourney.difypkg
```
