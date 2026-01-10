## Producer

**Author:** acedatacloud  
**Type:** tool provider plugin  
**API:** `https://api.acedata.cloud/producer/*`

### What it does

This plugin integrates **Ace Data Cloud Producer APIs** as Dify tools for:

- Generating audios
- Generating lyrics
- Uploading reference audio
- Downloading video / WAV

### Tools

- `producer_generate_audios`
- `producer_generate_lyrics`
- `producer_upload_reference_audio`
- `producer_get_video`
- `producer_get_wav`

### Credentials

Requires `acedata_bearer_token` (paste the token without the `Bearer ` prefix).

### Packaging

```bash
dify plugin package plugins/producer -o producer.difypkg
```
