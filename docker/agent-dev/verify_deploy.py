#!/usr/bin/env python3
"""Deployment checks. Never emit Compose config, environment, or credentials."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

SERVICES = ("api", "worker", "priority_worker", "worker_beat", "external_worker", "worker-plugin_autoupgrade", "agent_backend", "web")
API_SERVICES = SERVICES[:6]
EXPECTED_REPOS = {
    **{name: "langgenius/dify-api" for name in API_SERVICES},
    "agent_backend": "langgenius/dify-agent-backend",
    "web": "langgenius/dify-web",
}

# Executed in a one-off API container before replacing any running containers.
# Config credentials remain inside the container, including on error.
SCHEMA_PROBE = r'''
import json, sys
try:
    stage = "schema_registry"
    import models
    from configs import dify_config
    from sqlalchemy import create_engine, text
    from models.agent_config_entities import WorkflowNodeJobConfig
    from models.engine import metadata
    if "continue_agent_session" not in WorkflowNodeJobConfig.model_fields:
        print(json.dumps({"ok": False, "stage": "session_field", "error_type": "MissingSessionField"}))
        sys.exit(1)
    if not metadata.tables:
        raise ValueError("empty ORM schema registry")
    engine = create_engine(dify_config.SQLALCHEMY_DATABASE_URI, connect_args={"connect_timeout": 10, "options": "-c default_transaction_read_only=on -c statement_timeout=15000"})
    try:
        if engine.dialect.name != "postgresql":
            raise ValueError("agent dev schema verification requires PostgreSQL")
        with engine.connect() as connection, connection.begin():
            stage = "database_read_only"
            connection.execute(text("SET TRANSACTION READ ONLY"))
            if connection.execute(text("SHOW transaction_read_only")).scalar_one() != "on":
                raise ValueError("database transaction is not read only")
            default_schema = connection.execute(text("SELECT current_schema()")).scalar_one()
            if not default_schema:
                raise ValueError("no default database schema")
            stage = "schema_inspection"
            rows = connection.execute(text("SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema')")).all()
            actual = {}
            for schema_name, table_name, column_name in rows:
                actual.setdefault((schema_name, table_name), set()).add(column_name)
            missing_tables = []
            missing_columns = []
            for table in sorted(metadata.tables.values(), key=lambda item: ((item.schema or default_schema), item.name)):
                key = (table.schema or default_schema, table.name)
                table_label = ".".join(key)
                if key not in actual:
                    missing_tables.append(table_label)
                else:
                    missing_columns.extend(table_label + "." + name for name in sorted(set(table.columns.keys()) - actual[key]))
    finally:
        engine.dispose()
    if missing_tables or missing_columns:
        print(json.dumps({"ok": False, "missing_tables": missing_tables, "missing_schema": missing_columns}))
        sys.exit(1)
    print(json.dumps({"ok": True, "orm_tables": len(metadata.tables), "transaction_read_only": "on"}))
except Exception as exc:
    print(json.dumps({"ok": False, "stage": locals().get("stage", "schema_registry"), "error_type": type(exc).__name__}))
    sys.exit(1)
'''

# Runtime has no /health route. OpenAPI validates app startup; the authenticated
# nonexistent-run read validates API->runtime token/config and runtime->Redis.
HEALTH_PROBE = r'''
import json, sys, uuid
from urllib.request import build_opener, ProxyHandler, Request
from urllib.error import HTTPError
try:
    from configs import dify_config
    from models.agent_config_entities import WorkflowNodeJobConfig
    opener = build_opener(ProxyHandler({}))
    def get(url, headers=None):
        with opener.open(Request(url, headers=headers or {}), timeout=8) as response:
            return response.status, response.read(1024 * 1024)
    stage = "session_field"
    if "continue_agent_session" not in WorkflowNodeJobConfig.model_fields:
        raise ValueError("session field missing")
    stage = "api_health"
    status, body = get("http://127.0.0.1:5001/health")
    if status != 200 or json.loads(body).get("status") != "ok":
        raise ValueError("api health response invalid")
    stage = "runtime_configuration"
    runtime = (dify_config.AGENT_BACKEND_BASE_URL or "").rstrip("/")
    if not runtime or dify_config.AGENT_BACKEND_USE_FAKE:
        raise ValueError("real runtime configuration missing")
    stage = "runtime_openapi"
    status, body = get(runtime + "/openapi.json")
    spec = json.loads(body)
    if status != 200 or spec.get("info", {}).get("title") != "Dify Agent Run Server" or "/runs/{run_id}" not in spec.get("paths", {}):
        raise ValueError("runtime OpenAPI response invalid")
    stage = "runtime_authenticated_redis"
    token = dify_config.AGENT_BACKEND_API_TOKEN
    headers = {"Authorization": "Bearer " + token} if token else {}
    try:
        get(runtime + "/runs/deploy-readiness-" + uuid.uuid4().hex, headers)
    except HTTPError as exc:
        if exc.code != 404 or json.loads(exc.read(8192)).get("detail") != "run not found":
            raise ValueError("runtime authenticated Redis probe failed") from None
    else:
        raise ValueError("runtime probe unexpectedly found a run")
    stage = "web_http"
    status, body = get("http://web:3000/apps")
    if status != 200 or b"<html" not in body.lower():
        raise ValueError("web response invalid")
    print(json.dumps({"ok": True, "checks": ["api", "session_field", "runtime", "runtime_redis", "web"]}))
except Exception as exc:
    print(json.dumps({"ok": False, "stage": locals().get("stage", "import_configuration"), "error_type": type(exc).__name__}))
    sys.exit(1)
'''


class CheckFailure(Exception):
    pass


def command(args, timeout=90):
    try:
        result = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise CheckFailure("Docker command timed out; no environment values were logged") from None
    if result.returncode:
        raise CheckFailure("Docker command failed (exit %s); no environment values were logged" % result.returncode)
    return result.stdout


def compose_config():
    try:
        services = json.loads(command(["docker", "compose", "config", "--format", "json"]))["services"]
    except (ValueError, KeyError):
        raise CheckFailure("Cannot read resolved Compose service configuration") from None
    for name in SERVICES:
        if name not in services:
            raise CheckFailure("Required service missing: " + name)
        config = services[name]
        image = config.get("image", "")
        if not (image.startswith(EXPECTED_REPOS[name] + ":") or image.startswith(EXPECTED_REPOS[name] + "@sha256:")):
            raise CheckFailure("Service %s must use its published Dify image" % name)
        if config.get("build") or config.get("pull_policy") == "build":
            raise CheckFailure("Service %s still requires a local build" % name)
        if name in API_SERVICES and str(config.get("environment", {}).get("MIGRATION_ENABLED", "")).lower() != "false":
            raise CheckFailure("Service %s must explicitly retain MIGRATION_ENABLED=false; apply reviewed migrations separately" % name)
    return services


def service_ids(name):
    return command(["docker", "compose", "ps", "--all", "--quiet", name]).split()


def read_state(path):
    return json.loads(Path(path).read_text())


def write_state(path, state):
    Path(path).write_text(json.dumps(state, sort_keys=True) + "\n")


def preflight(path):
    compose_config()
    counts = {name: max(1, len(service_ids(name))) for name in SERVICES}
    write_state(path, {"counts": counts})
    print("Preflight passed; preserving existing service replica counts: " + json.dumps(counts, sort_keys=True), flush=True)


def prepare(path):
    state = read_state(path)
    services = compose_config()
    expected, revisions = {}, set()
    for name in SERVICES:
        info = json.loads(command(["docker", "image", "inspect", services[name]["image"]]))[0]
        revision = (info.get("Config", {}).get("Labels") or {}).get("org.opencontainers.image.revision", "")
        if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
            raise CheckFailure("Service %s image lacks a valid 40-character git revision label" % name)
        revisions.add(revision)
        expected[name] = info["Id"]
    if len(revisions) != 1:
        raise CheckFailure("Pulled application images have different git revisions; refusing mixed-version deployment")
    revision = next(iter(revisions))
    required_revision = os.environ.get("DEPLOY_EXPECTED_REVISION")
    if required_revision and required_revision != revision:
        raise CheckFailure("Pulled revision differs from DEPLOY_EXPECTED_REVISION")
    state.update(images=expected, revision=revision)
    write_state(path, state)
    print("All eight service images match git revision " + revision, flush=True)


def probe(args, description):
    try:
        result = subprocess.run(args, text=True, capture_output=True, timeout=60)
    except subprocess.TimeoutExpired:
        raise CheckFailure(description + " timed out") from None
    try:
        payload = json.loads(result.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise CheckFailure(description + " failed without a valid probe result; inspect service logs locally") from None
    if result.returncode or payload.get("ok") is not True:
        missing = payload.get("missing_schema", [])
        missing_tables = payload.get("missing_tables", [])
        identifiers = [*missing_tables, *missing] if isinstance(missing_tables, list) and isinstance(missing, list) else []
        if identifiers and all(isinstance(item, str) and re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*){1,2}", item) for item in identifiers):
            raise CheckFailure("Missing required schema: %s; apply reviewed migration before deploying" % ", ".join(identifiers))
        stage = payload.get("stage", "probe")
        if stage not in {"probe", "import_configuration", "session_field", "api_health", "runtime_configuration", "runtime_openapi", "runtime_authenticated_redis", "web_http", "schema_registry", "database_read_only", "schema_inspection"}:
            stage = "probe"
        error_type = payload.get("error_type", "probe_rejected")
        if not isinstance(error_type, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", error_type):
            error_type = "probe_rejected"
        raise CheckFailure(description + " failed (stage=" + stage + ", error=" + error_type + ")")
    return payload


def schema(path):
    read_state(path)
    probe(["docker", "compose", "run", "--rm", "--no-deps", "--pull", "never", "-T", "--entrypoint", "python", "api", "-c", SCHEMA_PROBE], "Schema compatibility check")
    print("Full ORM table/column compatibility and continue_agent_session checks passed", flush=True)


def verify_once(state):
    current_config = compose_config()
    for name in SERVICES:
        current_image = json.loads(command(["docker", "image", "inspect", current_config[name]["image"]]))[0]["Id"]
        if current_image != state["images"][name]:
            raise CheckFailure("Service %s image tag changed during deployment" % name)
        ids = service_ids(name)
        if len(ids) != state["counts"][name]:
            raise CheckFailure("Service %s replica count differs from pre-deployment count" % name)
        for info in json.loads(command(["docker", "inspect", *ids])):
            if info["Image"] != state["images"][name]:
                raise CheckFailure("Service %s is still running a different image" % name)
            if info.get("State", {}).get("Status") != "running":
                raise CheckFailure("Service %s is not running" % name)
            health = info.get("State", {}).get("Health", {}).get("Status")
            if health and health != "healthy":
                raise CheckFailure("Service %s container health is not healthy" % name)
    api_ids = service_ids("api")
    for container_id in api_ids:
        probe(["docker", "exec", container_id, "python", "-c", HEALTH_PROBE], "API/runtime/Redis/web readiness")


def verify(path):
    state = read_state(path)
    timeout = float(os.environ.get("DEPLOY_VERIFY_TIMEOUT", "180"))
    interval = float(os.environ.get("DEPLOY_VERIFY_INTERVAL", "5"))
    deadline = time.monotonic() + timeout
    while True:
        try:
            verify_once(state)
            print("Verified actual container images, preserved replica counts, API, session field, runtime, runtime Redis and web; revision=" + state["revision"], flush=True)
            return
        except CheckFailure as exc:
            if time.monotonic() >= deadline:
                raise CheckFailure("Deployment readiness deadline exceeded: " + str(exc)) from None
            print("Waiting for readiness: " + str(exc), flush=True)
            time.sleep(interval)


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in {"preflight", "prepare", "schema", "verify"}:
        raise CheckFailure("Usage: verify_deploy.py {preflight|prepare|schema|verify} STATE_FILE")
    globals()[sys.argv[1]](sys.argv[2])


if __name__ == "__main__":
    try:
        main()
    except CheckFailure as exc:
        print("DEPLOY CHECK FAILED: " + str(exc), file=sys.stderr, flush=True)
        sys.exit(1)
