## Suno

**Author:** acedatacloud  
**Type:** tool provider plugin  
**API:** `https://api.acedata.cloud/suno/*`

### What it does

This plugin integrates **Ace Data Cloud Suno APIs** as Dify tools for:

- Generating songs (`/suno/audios`)
- Generating lyrics (`/suno/lyrics`)
- Uploading reference audio (`/suno/upload`)
- Fetching MP4/WAV/MIDI/Timing (`/suno/mp4`, `/suno/wav`, `/suno/midi`, `/suno/timing`)
- Enhancing style prompts (`/suno/style`)
- Creating persona / vox audio ids (`/suno/persona`, `/suno/vox`)

### Credentials

Requires `acedata_bearer_token` (paste the token without the `Bearer ` prefix).

### Packaging

```bash
dify plugin package plugins/suno -o suno.difypkg
```
