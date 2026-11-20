"""Prepare a dedicated checkout. Never overwrite an existing deployment .env."""

import argparse
import base64
import json
import secrets
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--api-port", type=int, default=15011)
parser.add_argument("--fixture-port", type=int, default=16091)
parser.add_argument("--novnc-port", type=int, default=16090)
parser.add_argument("--host-cdp-port", type=int, default=19223)
parser.add_argument("--project", default="dify-browser-mvp")
args = parser.parse_args()
public_api = f"http://localhost:{args.api_port}"
root = Path(__file__).resolve().parents[3]
docker = root / "docker"
state = docker / "browser-mvp/state"
state.mkdir(mode=0o700, exist_ok=True)
if (docker / ".env").exists():
    raise SystemExit(
        "docker/.env exists. Keep it; inspect/edit that deployment explicitly."
    )
sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
token = lambda: secrets.token_hex(32)
values = {
    "COMPOSE_PROJECT_NAME": args.project,
    "MVP_API_PORT": str(args.api_port),
    "MVP_FIXTURE_PORT": str(args.fixture_port),
    "MVP_NOVNC_PORT": str(args.novnc_port),
    "MVP_HOST_CDP_PORT": str(args.host_cdp_port),
    "COMPOSE_PROFILES": "postgresql",
    "MVP_SOURCE_TAG": sha[:12],
    "DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN": token(),
    "SECRET_KEY": token(),
    "DB_PASSWORD": token(),
    "REDIS_PASSWORD": token(),
    "PLUGIN_DAEMON_KEY": token(),
    "PLUGIN_DIFY_INNER_API_KEY": token(),
    "DIFY_AGENT_API_TOKEN": token(),
    "DIFY_AGENT_SERVER_SECRET_KEY": base64.urlsafe_b64encode(secrets.token_bytes(32))
    .decode()
    .rstrip("="),
    "CONSOLE_API_URL": public_api,
    "CONSOLE_WEB_URL": "http://localhost:13000",
    "SERVICE_API_URL": public_api,
    "FILES_URL": public_api,
    "INTERNAL_FILES_URL": "http://api:5001",
    "SERVER_WORKER_AMOUNT": "1",
    "LOG_FORMAT": "%(asctime)s %(levelname)s %(message)s",
    "DEMO_VERIFICATION_CODE": str(secrets.randbelow(900000) + 100000),
}
path = docker / ".env"
path.write_text("".join(f"{k}={v}\n" for k, v in values.items()))
path.chmod(0o600)
(state / "browser.json").write_text(json.dumps({"endpoint": "http://browser:9223"}))
(state / "browser.json").chmod(0o644)
(state / "admin.json").write_text(
    json.dumps(
        {
            "email": "browser-mvp@example.com",
            "name": "Browser MVP",
            "password": "Mvp-" + token(),
            "language": "zh-Hans",
        }
    )
)
(state / "admin.json").chmod(0o600)
(state / "source.json").write_text(
    json.dumps({"sha": sha, "single_user": True}, indent=2)
)
print(
    "Prepared dedicated checkout. Credentials are in docker/browser-mvp/state and docker/.env."
)
