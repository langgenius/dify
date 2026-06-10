---
name: dify-manager
description: >
  Manages the local Dify deployment (start, stop, restart, status, logs).
  Invoke when the user asks to manage Dify services or check Dify health.
---

# Instructions

This skill manages the Dify deployment using Docker Compose from the `docker/` directory.

## Commands

### Status — show all running services

```bash
cd {{cwd}}/docker && docker compose ps
```

### Start Dify

```bash
cd {{cwd}}/docker && docker compose up -d
```

### Stop Dify

```bash
cd {{cwd}}/docker && docker compose down
```

### Restart Dify

```bash
cd {{cwd}}/docker && docker compose restart
```

### View logs (follow)

```bash
cd {{cwd}}/docker && docker compose logs -f
```

### View logs for a specific service

```bash
cd {{cwd}}/docker && docker compose logs -f <service-name>
```

Services: api, web, worker, worker_beat, sandbox, plugin_daemon, redis, db_postgres, weaviate, nginx, ssrf_proxy

### Health check

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost
```

### Rebuild and restart

```bash
cd {{cwd}}/docker && docker compose up -d --build
```

## Quick reference

| Action | Command |
|--------|---------|
| Check status | `docker compose ps` |
| Start | `docker compose up -d` |
| Stop | `docker compose down` |
| Restart | `docker compose restart` |
| Logs | `docker compose logs -f` |
| Health | `curl http://localhost` |
