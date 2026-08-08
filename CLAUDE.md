# Dify - AI Application Development Platform

## Quick Start

```bash
# Start Dify (from dify/docker/)
cd docker && docker compose up -d

# Stop Dify
cd docker && docker compose down

# View logs
cd docker && docker compose logs -f

# Restart
cd docker && docker compose restart

# Check status
cd docker && docker compose ps
```

## Access
- Web UI: http://localhost (default admin setup on first visit)
- API: http://localhost/api
- Plugin Daemon: http://localhost:5003

## Directory Structure
- `docker/` - Docker Compose files and deployment config
- `api/` - Backend API (Python/Flask)
- `web/` - Frontend (Next.js)
- `sdks/` - Official SDKs
- `docker/envs/` - Environment configuration templates

## Claude Code Integration
Use `/run` to start Dify (configured in `.claude/launch.json`).
Use `/loop` to periodically check Dify service health.

## Key URLs
- GitHub: https://github.com/langgenius/dify
- Docs: https://docs.dify.ai
