#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
RUNTIME_CONFIG_PATH = ROOT / "volumes" / "bootstrap" / "dify.generated.json"
DOCKER_CONFIG_PATH = Path.home() / ".docker" / "config.json"

CRITICAL_SERVICES = ("db_postgres", "redis", "ollama", "plugin_daemon", "docproc", "nginx", "api", "worker", "worker_beat")
REQUIRED_IMAGES = (
    "codex-rag-api:1.13.0-local",
    "codex-rag-pgvector:pg16-bigm",
    "langgenius/dify-plugin-daemon:0.5.3-local",
)
REQUIRED_OLLAMA_EMBED_MODELS = ("nomic-embed-text",)
REQUIRED_TABLES = ("dify_setups", "accounts", "apps")
HEALTH_REQUIRED_SERVICES = ("db_postgres", "redis", "ollama", "docproc")
PLUGIN_DAEMON_ERROR_MARKERS = (
    "failed to request plugin daemon",
    "request to plugin daemon service failed",
    "plugin daemon",
)


def log(message: str) -> None:
    print(f"[preflight] {message}", flush=True)


def run(command: list[str], *, check: bool = True, capture: bool = False, timeout: int | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=ROOT,
        check=check,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
        timeout=timeout,
    )


def check_docker_cli_responsive() -> None:
    try:
        result = run(["docker", "ps", "--format", "{{.Names}}"], check=False, capture=True, timeout=12)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("docker CLI did not respond within 12s; WSL/Docker Desktop may be wedged") from exc
    if result.returncode != 0:
        raise RuntimeError(f"docker CLI check failed: {(result.stdout or '').strip()}")


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def load_runtime_payload(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def app_token() -> str:
    runtime = load_runtime_payload(RUNTIME_CONFIG_PATH)
    if runtime.get("app_api_key"):
        return str(runtime["app_api_key"]).strip()
    env_values = parse_env_file(ENV_PATH)
    return (env_values.get("DIFY_APP_API_KEY") or env_values.get("CHAT_UI_API_KEY") or "").strip()


def http_json(url: str, *, token: str | None = None, timeout: int = 10) -> tuple[int, str]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, response.read(300).decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(300).decode("utf-8", errors="replace")
    except Exception as exc:
        return 0, f"{type(exc).__name__}: {exc}"


def wait_http(url: str, *, timeout_seconds: int = 180) -> None:
    deadline = time.time() + timeout_seconds
    last = ""
    while time.time() < deadline:
        status, body = http_json(url, timeout=5)
        if status == 200:
            return
        last = f"status={status} body={body}"
        time.sleep(2)
    raise RuntimeError(f"timeout waiting for {url}: {last}")


def check_docker_credential_config() -> None:
    if not DOCKER_CONFIG_PATH.exists():
        return
    try:
        payload = json.loads(DOCKER_CONFIG_PATH.read_text(encoding="utf-8") or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid Docker config JSON: {DOCKER_CONFIG_PATH}: {exc}") from exc
    creds_store = str(payload.get("credsStore") or payload.get("credStore") or "")
    if creds_store.endswith(".exe"):
        raise RuntimeError(
            f"WSL Docker config references Windows credential helper {creds_store!r}; "
            f"edit {DOCKER_CONFIG_PATH} to remove credsStore"
        )


def check_env_symlink() -> None:
    if not ENV_PATH.is_symlink():
        raise RuntimeError(f"{ENV_PATH} must be a symlink to the external secret env file")
    target = ENV_PATH.resolve()
    expected_suffix = Path("/home/koishi/projects/.env_xx_Codex_RAG")
    if target != expected_suffix:
        raise RuntimeError(f"{ENV_PATH} points to {target}, expected {expected_suffix}")


def image_exists(image: str) -> bool:
    result = run(["docker", "image", "inspect", image], check=False, capture=True)
    return result.returncode == 0


def ensure_images(fix: bool) -> None:
    missing = [image for image in REQUIRED_IMAGES if not image_exists(image)]
    if not missing:
        log("required local images exist")
        return
    if not fix:
        raise RuntimeError(f"missing required images: {', '.join(missing)}")
    if "codex-rag-api:1.13.0-local" in missing:
        log("building missing api image")
        run(["docker", "compose", "build", "api"])
    if "codex-rag-pgvector:pg16-bigm" in missing:
        log("building missing pgvector image")
        run(["docker", "compose", "build", "db_postgres"])
    still_missing = [image for image in REQUIRED_IMAGES if not image_exists(image)]
    if still_missing:
        raise RuntimeError(f"missing required images after repair: {', '.join(still_missing)}")


def ensure_services(fix: bool) -> None:
    if fix:
        log("starting critical services")
        run(["docker", "compose", "up", "-d", *CRITICAL_SERVICES])
    ps = run(["docker", "compose", "ps", "--format", "json"], capture=True)
    services: dict[str, dict[str, Any]] = {}
    for line in (ps.stdout or "").splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        services[item.get("Service", "")] = item
    missing = [service for service in CRITICAL_SERVICES if service not in services]
    stopped = [
        service
        for service in CRITICAL_SERVICES
        if service in services and str(services[service].get("State", "")).lower() != "running"
    ]
    if missing or stopped:
        raise RuntimeError(f"services not running: missing={missing} stopped={stopped}")
    unhealthy = [
        service
        for service in HEALTH_REQUIRED_SERVICES
        if service in services and str(services[service].get("Health", "")).lower() not in ("", "healthy")
    ]
    if unhealthy:
        raise RuntimeError(f"services unhealthy: {unhealthy}")


def post_chat_probe(token: str, *, timeout: int = 90) -> tuple[int, str]:
    payload = {
        "inputs": {},
        "query": "勤務時間・勤怠管理規程で、メールやチャット以外に証跡として扱われる履歴は何ですか?",
        "response_mode": "blocking",
        "conversation_id": "",
        "auto_generate_name": False,
        "user": "preflight-probe",
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "http://localhost/v1/chat-messages",
        data=data,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")
    except Exception as exc:
        return 0, f"{type(exc).__name__}: {exc}"


def ollama_models() -> set[str]:
    result = run(["docker", "compose", "exec", "-T", "ollama", "ollama", "list"], capture=True)
    models: set[str] = set()
    for line in (result.stdout or "").splitlines()[1:]:
        parts = line.split()
        if parts:
            models.add(parts[0])
    return models


def ensure_ollama_models(fix: bool) -> None:
    existing = ollama_models()
    missing = [
        model
        for model in REQUIRED_OLLAMA_EMBED_MODELS
        if model not in existing and f"{model}:latest" not in existing
    ]
    if not missing:
        log("required Ollama embedding models exist")
        return
    if not fix:
        raise RuntimeError(f"missing Ollama embedding models: {', '.join(missing)}")
    for model in missing:
        log(f"pulling Ollama model {model}")
        run(["docker", "compose", "exec", "-T", "ollama", "ollama", "pull", model])


def check_db_tables() -> None:
    query = "select " + ", ".join(f"to_regclass('public.{table}')" for table in REQUIRED_TABLES)
    result = run(
        ["docker", "compose", "exec", "-T", "db_postgres", "psql", "-U", "postgres", "-d", "dify", "-Atc", query],
        capture=True,
    )
    output = (result.stdout or "").strip()
    if any(not part for part in output.split("|")):
        raise RuntimeError(f"missing Dify DB tables: {output}")


def check_token() -> None:
    token = app_token()
    if not token:
        raise RuntimeError("missing app API token in runtime config or env")
    deadline = time.time() + 120
    last = ""
    while time.time() < deadline:
        status, body = http_json("http://localhost/v1/parameters", token=token)
        if status == 200:
            return
        last = f"status={status} body={body}"
        time.sleep(2)
    raise RuntimeError(f"app token check failed: {last}")


def check_chat_plugin_path() -> None:
    token = app_token()
    if not token:
        raise RuntimeError("missing app API token in runtime config or env")
    status, body = post_chat_probe(token)
    normalized_body = body.lower()
    if status != 200:
        if any(marker in normalized_body for marker in PLUGIN_DAEMON_ERROR_MARKERS):
            raise RuntimeError(f"chat plugin path failed: status={status} body={body[:500]}")
        raise RuntimeError(f"chat probe failed: status={status} body={body[:500]}")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"chat probe returned non-JSON body: {body[:500]}") from exc
    if not str(payload.get("answer") or "").strip():
        raise RuntimeError(f"chat probe returned empty answer: {body[:500]}")


def check_docproc_summary_endpoint() -> None:
    script = r'''
import os
import sys
import requests

enabled = os.getenv("DOCPROC_ENABLE_LLM_SUMMARY", "true").lower() == "true"
provider = os.getenv("DOCPROC_SUMMARY_PROVIDER", "openai-compatible").strip().lower()
base_url = os.getenv("DOCPROC_SUMMARY_BASE_URL", "").rstrip("/")
model = os.getenv("DOCPROC_SUMMARY_MODEL", "").strip()

if not enabled:
    print("disabled")
    raise SystemExit(0)
if provider not in {"openai", "openai-compatible", "openai_api_compatible", "lmstudio", "lm-studio"}:
    print(f"skipped provider={provider}")
    raise SystemExit(0)
if not base_url or not model:
    raise SystemExit("missing DOCPROC_SUMMARY_BASE_URL or DOCPROC_SUMMARY_MODEL")
if not base_url.endswith("/v1"):
    base_url = f"{base_url}/v1"

response = requests.get(f"{base_url}/models", timeout=5)
response.raise_for_status()
models = {str(item.get("id") or "") for item in response.json().get("data", [])}
if model not in models:
    raise SystemExit(f"summary model {model!r} not found in {sorted(models)}")
print(model)
'''
    result = run(["docker", "compose", "exec", "-T", "docproc", "python", "-c", script], capture=True)
    output = (result.stdout or "").strip()
    if output:
        log(f"docproc summary endpoint ok: {output}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate and optionally repair the local RAG evaluation stack.")
    parser.add_argument("--fix", action="store_true", help="start services, build missing images, and pull missing models")
    args = parser.parse_args()

    if Path.cwd().resolve() != ROOT:
        log(f"running from {ROOT}")
    check_docker_cli_responsive()
    check_docker_credential_config()
    check_env_symlink()
    ensure_images(args.fix)
    ensure_services(args.fix)
    ensure_ollama_models(args.fix)
    log("waiting for docproc and chat health")
    wait_http("http://localhost/docproc/health")
    wait_http("http://localhost/chat/api/health")
    check_docproc_summary_endpoint()
    check_db_tables()
    check_token()
    check_chat_plugin_path()
    log("ok")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[preflight] ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
