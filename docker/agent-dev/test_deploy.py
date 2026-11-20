#!/usr/bin/env python3
"""Hermetic regression checks; no real Docker daemon or application is used."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parent
SERVICES = ["api", "worker", "priority_worker", "worker_beat", "external_worker", "worker-plugin_autoupgrade", "agent_backend", "web"]
SENTINEL = "DO_NOT_PRINT_TEST_CREDENTIAL_7a3f"

FAKE_DOCKER = r'''#!/usr/bin/env python3
import json, os, pathlib, sys, time
a = sys.argv[1:]
root = pathlib.Path(os.environ["FAKE_ROOT"])
mode = os.environ.get("FAKE_MODE", "success")
services = ["api", "worker", "priority_worker", "worker_beat", "external_worker", "worker-plugin_autoupgrade", "agent_backend", "web"]
with (root / "calls.jsonl").open("a") as stream:
    stream.write(json.dumps({"args": a, "run": os.environ.get("FAKE_RUN_ID", "one"), "time": time.time()}) + "\n")
def image_id(service):
    return "sha256:" + ("2" if service == "agent_backend" else "3" if service == "web" else "1") * 64
if a[:2] == ["compose", "config"]:
    entries = {}
    for name in services:
        repo = "dify-agent-backend" if name == "agent_backend" else "dify-web" if name == "web" else "dify-api"
        entries[name] = {"image": "langgenius/" + repo + ":deploy-agent", "environment": {"MIGRATION_ENABLED": "false", "TEST_SECRET": "DO_NOT_PRINT_TEST_CREDENTIAL_7a3f"}}
    if mode == "migration_true":
        entries["worker"]["environment"]["MIGRATION_ENABLED"] = "true"
    if mode == "residual_build":
        entries["api"]["build"] = {"context": "."}
    print(json.dumps({"services": entries}))
elif a[:2] == ["compose", "ps"]:
    name = a[-1]
    count = 2 if name == "worker" else 1
    if mode == "countloss" and (root / "up").exists() and name == "worker": count = 1
    print("\n".join(name + "-" + str(i) for i in range(count)))
elif a[:2] == ["compose", "pull"]:
    print("pull stdout is logged")
    print("pull stderr is logged", file=sys.stderr)
    if mode == "pull_failure": sys.exit(17)
elif a[:2] == ["compose", "run"]:
    if mode == "missing_schema":
        print(json.dumps({"ok": False, "missing_schema": ["external_agent_trace_targets.capture_policy"]}))
        sys.exit(1)
    if mode == "missing_table":
        print(json.dumps({"ok": False, "missing_tables": ["public.future_model_table"], "missing_schema": []}))
        sys.exit(1)
    print(json.dumps({"ok": True}))
elif a[:2] == ["compose", "up"]:
    if mode == "up_failure": sys.exit(19)
    if mode == "slow": time.sleep(0.3)
    (root / "up").touch()
    print("application services started")
elif a[:2] == ["image", "inspect"]:
    name = "agent_backend" if "dify-agent-backend" in a[2] else "web" if "dify-web" in a[2] else "api"
    revision = "b" * 40 if mode == "mixed_revision" and name == "web" else "a" * 40
    if mode == "invalid_revision" and name == "agent_backend": revision = "short"
    print(json.dumps([{"Id": image_id(name), "Config": {"Labels": {"org.opencontainers.image.revision": revision}}}]))
elif a[:1] == ["inspect"]:
    result = []
    for cid in a[1:]:
        name = cid.rsplit("-", 1)[0]
        actual = image_id(name)
        if mode == "stale_container" and name == "external_worker": actual = "sha256:" + "9" * 64
        result.append({"Image": actual, "State": {"Status": "running"}})
    print(json.dumps(result))
elif a[:1] == ["exec"]:
    if mode == "health_failure":
        print(json.dumps({"ok": False, "error_type": "URLError"}))
        sys.exit(23)
    print(json.dumps({"ok": True, "checks": ["api", "session_field", "runtime", "runtime_redis", "web"]}))
else:
    print("Unexpected fake Docker operation", file=sys.stderr)
    sys.exit(98)
'''

# macOS has no flock binary; this implements the same inherited-fd lock contract
# for these local tests. Production uses Ubuntu's actual util-linux flock.
FAKE_FLOCK = r'''#!/usr/bin/env python3
import fcntl, sys, time
deadline = time.monotonic() + float(sys.argv[2])
fd = int(sys.argv[3])
while True:
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        break
    except BlockingIOError:
        if time.monotonic() >= deadline: sys.exit(1)
        time.sleep(0.01)
'''


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for name in ("deploy.sh", "verify_deploy.py"):
            shutil.copy2(ROOT / name, self.root / name)
        for name, source in (("docker", FAKE_DOCKER), ("flock", FAKE_FLOCK)):
            target = self.bin / name
            target.write_text(source)
            target.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"], FAKE_ROOT=str(self.root), DEPLOY_VERIFY_TIMEOUT="0", DEPLOY_VERIFY_INTERVAL="0.01", DEPLOY_LOCK_TIMEOUT="5")

    def tearDown(self):
        self.temp.cleanup()

    def run_deploy(self, mode="success", **extra):
        env = dict(self.env, FAKE_MODE=mode, **extra)
        return subprocess.run(["bash", str(self.root / "deploy.sh")], cwd="/", env=env, text=True, capture_output=True, timeout=15)

    def calls(self):
        return [json.loads(line) for line in (self.root / "calls.jsonl").read_text().splitlines()]

    def test_success_is_scoped_and_preserves_replicas_and_logs_both_streams(self):
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("DEPLOY SUCCESS", result.stdout)
        self.assertIn('"worker": 2', result.stdout)
        calls = [call["args"] for call in self.calls()]
        self.assertIn(["compose", "pull", *SERVICES], calls)
        self.assertIn(["compose", "up", "-d", "--no-deps", "--no-build", "--pull", "never", *SERVICES], calls)
        self.assertFalse(any(call[0] in {"rm", "restart"} for call in calls))
        self.assertFalse(any("--scale" in call for call in calls))
        log = (self.root / "deploy.log").read_text()
        self.assertIn("pull stdout is logged", log)
        self.assertIn("pull stderr is logged", log)
        self.assertNotIn(SENTINEL, log + result.stdout + result.stderr)
        self.assertFalse(list(self.root.glob(".agent-deploy-expected.*")))

    def test_pull_failure_is_not_success_and_does_not_start_services(self):
        result = self.run_deploy("pull_failure")
        self.assertEqual(result.returncode, 17)
        self.assertIn("DEPLOY FAILED exit=17", result.stdout)
        self.assertNotIn("DEPLOY SUCCESS", result.stdout)
        self.assertFalse(any(call["args"][:2] == ["compose", "up"] for call in self.calls()))

    def test_up_failure_is_not_success(self):
        result = self.run_deploy("up_failure")
        self.assertEqual(result.returncode, 19)
        self.assertNotIn("DEPLOY SUCCESS", result.stdout)

    def test_mixed_revisions_block_before_replacement(self):
        result = self.run_deploy("mixed_revision")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("different git revisions", result.stdout)
        self.assertFalse((self.root / "up").exists())

    def test_invalid_git_revision_blocks(self):
        result = self.run_deploy("invalid_revision")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("40-character", result.stdout)

    def test_expected_revision_mismatch_blocks(self):
        result = self.run_deploy(DEPLOY_EXPECTED_REVISION="b" * 40)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DEPLOY_EXPECTED_REVISION", result.stdout)

    def test_migrations_must_remain_disabled(self):
        result = self.run_deploy("migration_true")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("MIGRATION_ENABLED=false", result.stdout)
        self.assertFalse(any(call["args"][:2] == ["compose", "pull"] for call in self.calls()))

    def test_residual_local_build_blocks_before_pull(self):
        result = self.run_deploy("residual_build")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("api still requires a local build", result.stdout)
        self.assertFalse(any(call["args"][:2] == ["compose", "pull"] for call in self.calls()))

    def test_missing_schema_has_clear_error_before_replacement(self):
        result = self.run_deploy("missing_schema")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing required schema: external_agent_trace_targets.capture_policy", result.stdout)
        self.assertFalse((self.root / "up").exists())

    def test_missing_orm_table_blocks_before_replacement(self):
        result = self.run_deploy("missing_table")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing required schema: public.future_model_table", result.stdout)
        self.assertFalse((self.root / "up").exists())

    def test_stale_external_worker_cannot_pass(self):
        result = self.run_deploy("stale_container")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("external_worker is still running a different image", result.stdout)
        self.assertNotIn("DEPLOY SUCCESS", result.stdout)

    def test_worker_count_loss_cannot_pass(self):
        result = self.run_deploy("countloss")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("worker replica count differs", result.stdout)

    def test_health_failure_cannot_pass(self):
        result = self.run_deploy("health_failure")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("API/runtime/Redis/web readiness failed", result.stdout)
        self.assertNotIn("DEPLOY SUCCESS", result.stdout)

    def test_shared_lock_waits_and_preserves_inode(self):
        lock = self.root / ".agent-dev-config-mutation.lock"
        lock.touch()
        inode = lock.stat().st_ino
        first_env = dict(self.env, FAKE_MODE="slow", FAKE_RUN_ID="first")
        first = subprocess.Popen(["bash", str(self.root / "deploy.sh")], env=first_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 4
        while not (self.root / "calls.jsonl").exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        second = self.run_deploy(FAKE_RUN_ID="second")
        stdout, stderr = first.communicate(timeout=10)
        self.assertEqual(first.returncode, 0, stdout + stderr)
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        calls = self.calls()
        first_last = max(item["time"] for item in calls if item["run"] == "first")
        second_first = min(item["time"] for item in calls if item["run"] == "second")
        self.assertGreaterEqual(second_first, first_last)
        self.assertEqual(lock.stat().st_ino, inode)


class ProbeLogicTests(unittest.TestCase):
    def execute_probe(self, variant):
        spec = importlib.util.spec_from_file_location("verify_deploy", ROOT / "verify_deploy.py")
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        config = types.SimpleNamespace(AGENT_BACKEND_BASE_URL="http://agent_backend:5050", AGENT_BACKEND_USE_FAKE=False, AGENT_BACKEND_API_TOKEN=SENTINEL)
        modules = {"configs": types.SimpleNamespace(dify_config=config), "models.agent_config_entities": types.SimpleNamespace(WorkflowNodeJobConfig=types.SimpleNamespace(model_fields={"continue_agent_session": object()}))}
        class Response:
            status = 200
            def __init__(self, body): self.body = body
            def read(self, limit): return self.body
            def __enter__(self): return self
            def __exit__(self, *args): pass
        def open_request(request, timeout):
            url = request.full_url
            if url.endswith("/health"):
                return Response(b'{"status":"bad"}' if variant == "api_bad" else b'{"status":"ok"}')
            if url.endswith("/openapi.json"):
                return Response(json.dumps({"info": {"title": "Dify Agent Run Server"}, "paths": {} if variant == "runtime_bad" else {"/runs/{run_id}": {}}}).encode())
            if "/runs/deploy-readiness-" in url:
                self.assertEqual(request.get_header("Authorization"), "Bearer " + SENTINEL)
                status = 401 if variant == "runtime_unauthorized" else 404
                body = b'{"detail":"different"}' if variant == "redis_bad" else b'{"detail":"run not found"}'
                raise HTTPError(url, status, "probe", {}, io.BytesIO(body))
            return Response(b"unavailable" if variant == "web_bad" else b"<!doctype html><html></html>")
        output = io.StringIO()
        with patch.dict(sys.modules, modules), patch("urllib.request.build_opener", return_value=types.SimpleNamespace(open=open_request)), contextlib.redirect_stdout(output):
            try:
                exec(helper.HEALTH_PROBE, {})
            except SystemExit as exc:
                code = exc.code
            else:
                code = 0
        self.assertNotIn(SENTINEL, output.getvalue())
        return code, json.loads(output.getvalue())

    def test_real_probe_accepts_only_complete_readiness(self):
        code, result = self.execute_probe("success")
        self.assertEqual(code, 0)
        self.assertTrue(result["ok"])

    def test_real_probe_rejects_api_runtime_auth_redis_and_web_failures(self):
        for variant in ("api_bad", "runtime_bad", "runtime_unauthorized", "redis_bad", "web_bad"):
            with self.subTest(variant=variant):
                code, result = self.execute_probe(variant)
                self.assertNotEqual(code, 0)
                self.assertFalse(result["ok"])


class SchemaProbeLogicTests(unittest.TestCase):
    def execute_probe(self, variant="success"):
        spec = importlib.util.spec_from_file_location("verify_deploy", ROOT / "verify_deploy.py")
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        columns = {
            ("public", "external_agent_trace_targets"): {"id", "capture_policy"},
            ("public", "oauth_provider_apps"): {"id", "auto_authorize"},
            ("private", "future_model_table"): {"id", "future_new_field"},
        }
        tables = {
            schema + "." + table: types.SimpleNamespace(schema=None if schema == "public" else schema, name=table, columns={name: object() for name in names})
            for (schema, table), names in columns.items()
        }
        if variant == "empty_registry":
            tables = {}
        metadata = types.SimpleNamespace(tables=tables)
        rows = [(schema, table, column) for (schema, table), names in columns.items() for column in names]
        if variant == "missing_column":
            rows.remove(("private", "future_model_table", "future_new_field"))
        if variant == "missing_old_oauth_column":
            rows.remove(("public", "oauth_provider_apps", "auto_authorize"))
        if variant == "missing_table":
            rows = [row for row in rows if row[:2] != ("private", "future_model_table")]
        calls = []
        disposed = []
        class Result:
            def __init__(self, scalar=None, rows=None): self.scalar, self.rows = scalar, rows
            def scalar_one(self): return self.scalar
            def all(self): return self.rows
        class Connection:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def begin(self): return self
            def execute(self, statement):
                calls.append(statement)
                if statement == "SET TRANSACTION READ ONLY": return Result()
                if statement == "SHOW transaction_read_only": return Result("off" if variant == "not_read_only" else "on")
                if statement == "SELECT current_schema()": return Result("public")
                if "information_schema.columns" in statement: return Result(rows=rows)
                raise AssertionError("Unexpected SQL statement")
        engine = types.SimpleNamespace(dialect=types.SimpleNamespace(name="postgresql"), connect=lambda: Connection(), dispose=lambda: disposed.append(True))
        engine_args = []
        def create_engine(url, **kwargs):
            engine_args.append((url, kwargs))
            if variant == "database_error":
                raise ValueError(SENTINEL)
            return engine
        models = types.ModuleType("models")
        models.__path__ = []
        modules = {
            "models": models,
            "models.engine": types.SimpleNamespace(metadata=metadata),
            "models.agent_config_entities": types.SimpleNamespace(WorkflowNodeJobConfig=types.SimpleNamespace(model_fields={"continue_agent_session": object()})),
            "configs": types.SimpleNamespace(dify_config=types.SimpleNamespace(SQLALCHEMY_DATABASE_URI="postgresql://" + SENTINEL + "@db/langgenius")),
            "sqlalchemy": types.SimpleNamespace(create_engine=create_engine, text=lambda sql: sql),
        }
        output = io.StringIO()
        with patch.dict(sys.modules, modules), contextlib.redirect_stdout(output):
            try:
                exec(helper.SCHEMA_PROBE, {})
            except SystemExit as exc:
                code = exc.code
            else:
                code = 0
        self.assertNotIn(SENTINEL, output.getvalue())
        return code, json.loads(output.getvalue()), calls, disposed, engine_args

    def test_complete_registry_is_verified_with_one_catalog_read_and_read_only_transaction(self):
        code, result, calls, disposed, engine_args = self.execute_probe()
        self.assertEqual(code, 0)
        self.assertEqual(result, {"ok": True, "orm_tables": 3, "transaction_read_only": "on"})
        self.assertEqual(calls[:3], ["SET TRANSACTION READ ONLY", "SHOW transaction_read_only", "SELECT current_schema()"])
        self.assertEqual(sum("information_schema.columns" in sql for sql in calls), 1)
        self.assertTrue(all(sql.startswith(("SET TRANSACTION READ ONLY", "SHOW ", "SELECT ")) for sql in calls))
        options = engine_args[0][1]["connect_args"]["options"]
        self.assertIn("default_transaction_read_only=on", options)
        self.assertIn("statement_timeout=15000", options)
        self.assertEqual(disposed, [True])

    def test_future_new_field_and_original_oauth_field_are_both_checked(self):
        for variant, expected in (("missing_column", "private.future_model_table.future_new_field"), ("missing_old_oauth_column", "public.oauth_provider_apps.auto_authorize")):
            with self.subTest(variant=variant):
                code, result, _, disposed, _ = self.execute_probe(variant)
                self.assertNotEqual(code, 0)
                self.assertFalse(result["ok"])
                self.assertEqual(result["missing_schema"], [expected])
                self.assertEqual(disposed, [True])

    def test_missing_table_is_reported_without_faking_its_column_presence(self):
        code, result, _, _, _ = self.execute_probe("missing_table")
        self.assertNotEqual(code, 0)
        self.assertEqual(result["missing_tables"], ["private.future_model_table"])

    def test_not_read_only_and_empty_registry_fail_closed_before_catalog(self):
        for variant in ("not_read_only", "empty_registry"):
            with self.subTest(variant=variant):
                code, result, calls, _, _ = self.execute_probe(variant)
                self.assertNotEqual(code, 0)
                self.assertFalse(result["ok"])
                self.assertFalse(any("information_schema.columns" in sql for sql in calls))

    def test_database_error_does_not_disclose_url_or_exception_message(self):
        code, result, _, _, _ = self.execute_probe("database_error")
        self.assertNotEqual(code, 0)
        self.assertEqual(result["error_type"], "ValueError")


if __name__ == "__main__":
    unittest.main(verbosity=2)
