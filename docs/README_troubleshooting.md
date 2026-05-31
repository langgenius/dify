# Troubleshooting Guide

Common issues and solutions when setting up and running Dify locally.

---

## Table of Contents

- [Docker Permissions](#docker-permissions)
- [Database Migration Issues](#database-migration-issues)
- [Environment Variables](#environment-variables)
- [macOS-Specific Issues](#macos-specific-issues)
- [Linux-Specific Issues](#linux-specific-issues)

---

## Docker Permissions

### Problem: `permission denied while trying to connect to the Docker daemon socket`

This occurs when your user is not in the `docker` group.

**Solution (Linux):**

```bash
sudo usermod -aG docker $USER
newgrp docker
```

Then log out and back in for the group change to take full effect.

### Problem: `docker compose` command not found

Dify uses Docker Compose V2 (`docker compose`), not the legacy `docker-compose`.

**Solution:**

- Ensure Docker Desktop is up to date (includes Compose V2).
- On Linux, install the Compose plugin:
  ```bash
  sudo apt-get update
  sudo apt-get install docker-compose-plugin
  ```

---

## Database Migration Issues

### Problem: `relation "xxx" does not exist` during startup

This usually means the database schema has not been migrated.

**Solution:**

```bash
docker compose exec api flask db upgrade
```

If you get errors about conflicting migrations, try resetting the database:

```bash
docker compose down -v   # WARNING: deletes all data
docker compose up -d
```

### Problem: `FATAL: password authentication failed for user "postgres"`

The credentials in `.env` don't match what was used when the database was first initialized.

**Solution:**

1. Check the values of `DB_USERNAME` and `DB_PASSWORD` in your `.env` file.
2. If you changed them after first run, either revert to the original values or reset the volume:
   ```bash
   docker compose down -v
   docker compose up -d
   ```

---

## Environment Variables

### Problem: Services fail with missing configuration errors

Dify requires a `.env` file in the `docker/` directory (or project root depending on your setup).

**Solution:**

```bash
cp .env.example .env
```

Then review and set at minimum:

| Variable | Description |
|---|---|
| `SECRET_KEY` | A random string for session encryption |
| `CONSOLE_WEB_URL` | URL for the web console (e.g. `http://localhost:3000`) |
| `CONSOLE_API_URL` | URL for the API server (e.g. `http://localhost:5001`) |
| `APP_WEB_URL` | URL for the app web interface |

Generate a secret key:

```bash
openssl rand -base64 42
```

### Problem: `OPENAI_API_KEY` not working

Make sure:

1. The key starts with `sk-` and is valid.
2. You have billing enabled on your OpenAI account.
3. The key is set in your `.env` file **without** quotes:
   ```
   OPENAI_API_KEY=sk-xxxxxxxxxxxxx
   ```

---

## macOS-Specific Issues

### Problem: `ERROR: could not find an available, non-overlapping IPv4 address pool`

Docker Desktop on macOS has limited subnet pools.

**Solution:**

1. Open Docker Desktop → Settings → Docker Engine.
2. Add or modify the `default-address-pools` config:
   ```json
   {
     "default-address-pools": [
       { "base": "172.17.0.0/12", "size": 20 }
     ]
   }
   ```
3. Click "Apply & Restart".

### Problem: Slow file syncing / poor performance on Apple Silicon

Dify's containers may run slowly under Rosetta emulation.

**Solution:**

Ensure Docker Desktop is running the native ARM64 build (not x86_64). Go to Docker Desktop → Settings → General → "Use Rosetta for x86/amd64 emulation" and **disable** it if your images support ARM natively.

---

## Linux-Specific Issues

### Problem: `vm.max_map_count` too low for Elasticsearch

If you use the Elasticsearch vector store, you may see bootstrap errors.

**Solution:**

```bash
sudo sysctl -w vm.max_map_count=262144
```

To make it persistent across reboots:

```bash
echo "vm.max_map_count=262144" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

### Problem: Port already in use

Another service is using port 3000, 5001, or 5432.

**Solution:**

Find and stop the conflicting process:

```bash
sudo lsof -i :3000
sudo lsof -i :5001
sudo lsof -i :5432
```

Or remap the port in `docker-compose.yaml`.

---

## Still Stuck?

- Search [GitHub Discussions](https://github.com/langgenius/dify/discussions) for similar issues.
- File a [bug report](https://github.com/langgenius/dify/issues) with reproduction steps and logs.
- Join the [Discord community](https://discord.gg/8tqtnS7U) for real-time help.
