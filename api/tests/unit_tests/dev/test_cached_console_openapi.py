"""Exercise the actual cache client/server, with small isolated backend modules."""

import concurrent.futures
import json
import os
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(not hasattr(os, "fork"), reason="The memory export server uses POSIX isolation")


@dataclass
class CacheClient:
    api: Path
    env: dict[str, str]
    used_envs: list[dict[str, str]] = field(default_factory=list)

    def request(self, *, setting: str | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
        request_env = self.env if setting is None else {**self.env, "OPENAPI_TEST_SETTING": setting}
        self.used_envs.append(request_env)
        return subprocess.run(
            [sys.executable, str(self.api / "dev/cached_console_openapi.py")],
            cwd=self.api.parent,
            env=request_env,
            capture_output=True,
            text=True,
            timeout=30,
            check=check,
        )

    def export(self, *, setting: str | None = None) -> dict[str, str | int | None]:
        return json.loads(self.request(setting=setting).stdout)["console"]


@pytest.fixture
def backend(tmp_path: Path) -> Iterator[CacheClient]:
    api = tmp_path / "api"
    (api / "dev").mkdir(parents=True)
    script = api / "dev/cached_console_openapi.py"
    original = Path(__file__).resolve().parents[3] / "dev/cached_console_openapi.py"
    shutil.copyfile(original, script)
    modules = {
        "dev/__init__.py": "",
        "dev/generate_swagger_specs.py": "def apply_runtime_defaults(): pass\n",
        "models.py": "import secrets\nVALUE = 'v1'\nSNAPSHOT = secrets.token_hex(8)\n",
        "controllers/fixture.py": "FIELD = 'integer'\n",
        "core/mcp/types.py": "",
        "dify_agent/protocol/schemas.py": "",
        "graphon/nodes/parameter_extractor/entities.py": "",
        "services/knowledge_fs/product_dto.py": "",
        "dev/export_console_openapi.py": """
import json, os
def main():
    from controllers.fixture import FIELD
    from models import VALUE, SNAPSHOT
    print(json.dumps({'console': {'field': FIELD, 'model': VALUE, 'pid': os.getpid(),
                                 'snapshot': SNAPSHOT, 'setting': os.getenv('OPENAPI_TEST_SETTING')}, 'fast': {}}))
if __name__ == '__main__': main()
""",
    }
    for filename, content in modules.items():
        path = api / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        for parent in path.parents:
            if parent == api:
                break
            (parent / "__init__.py").touch()
        path.write_text(content)
    client = CacheClient(api, {**os.environ, "PYTHONPATH": str(api)})
    yield client
    for request_env in client.used_envs:
        subprocess.run(
            [sys.executable, str(script), "--stop"],
            cwd=tmp_path,
            env=request_env,
            capture_output=True,
            timeout=10,
            check=True,
        )


def test_memory_cache_is_shared_and_ignores_test_files(backend: CacheClient) -> None:
    api, call = backend.api, backend.export
    first = call()
    assert call() == first
    (api / "tests").mkdir()
    (api / "tests/test_unrelated.py").write_text("# unrelated test\n")
    assert call() == first
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        assert all(result == first for result in pool.map(lambda _: call(), range(4)))
    assert not list(api.rglob("*.json"))
    assert not list(api.rglob("*.pyc"))


def test_changed_controller_is_fresh_and_preloaded_dependency_restarts_snapshot(backend: CacheClient) -> None:
    api, call = backend.api, backend.export
    first = call()
    controller = api / "controllers/fixture.py"
    controller.write_text("FIELD = 'number'\n")
    second = call()
    assert second["field"] == "number"
    assert second["pid"] != first["pid"]
    assert second["snapshot"] == first["snapshot"]
    # Same-size edit with unchanged mtime must not revive a stale .pyc or snapshot.
    model = api / "models.py"
    stat = model.stat()
    model.write_text(model.read_text().replace("'v1'", "'v2'"))
    os.utime(model, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    third = call()
    assert third["model"] == "v2"
    assert third["snapshot"] != second["snapshot"]
    assert third["field"] == "number"


def test_export_errors_never_return_old_contracts_and_recover_after_fix(backend: CacheClient) -> None:
    api, call = backend.api, backend.export
    first = call()
    controller = api / "controllers/fixture.py"
    controller.write_text("FIELD = syntax error\n")
    failure = backend.request(check=False)
    assert failure.returncode != 0
    assert not failure.stdout
    assert "SyntaxError" in failure.stderr
    controller.write_text("FIELD = 'string'\n")
    fixed = call()
    assert fixed["field"] == "string"
    assert fixed["pid"] != first["pid"]


def test_environment_and_file_additions_invalidate_memory_cache(backend: CacheClient) -> None:
    api, call = backend.api, backend.export
    first = call()
    variant = call(setting="variant")
    assert variant["setting"] == "variant"
    assert variant["snapshot"] != first["snapshot"]
    (api / "new_dependency.py").write_text("VALUE = 1\n")
    added = call()
    assert added["snapshot"] != first["snapshot"]
    (api / "new_dependency.py").unlink()
    assert call()["snapshot"] != added["snapshot"]


def test_native_threads_use_fresh_exports_and_propagate_failures(backend: CacheClient) -> None:
    model = backend.api / "models.py"
    model.write_text(
        model.read_text()
        + "import threading, time\n"
        + "threading.Thread(target=time.sleep, args=(60,), daemon=True).start()\n"
    )
    first = backend.export()
    controller = backend.api / "controllers/fixture.py"
    controller.write_text("FIELD = 'string'\n")
    changed = backend.export()
    assert changed["field"] == "string"
    assert changed["snapshot"] != first["snapshot"]
    controller.write_text("FIELD = syntax error\n")
    failure = backend.request(check=False)
    assert failure.returncode != 0
    assert not failure.stdout
    assert "SyntaxError" in failure.stderr


def test_invalid_export_payload_does_not_replace_a_valid_contract(backend: CacheClient) -> None:
    first = backend.export()
    exporter = backend.api / "dev/export_console_openapi.py"
    original = exporter.read_text()
    exporter.write_text("def main(): print('{\"unexpected\": {}}')\n")
    failure = backend.request(check=False)
    assert failure.returncode != 0
    assert not failure.stdout
    assert "Invalid Console export response" in failure.stderr
    exporter.write_text(original)
    assert backend.export()["field"] == first["field"]


def test_failed_preload_falls_back_to_fresh_exports(backend: CacheClient) -> None:
    (backend.api / "core/mcp/types.py").write_text("raise RuntimeError('Cannot preload this dependency')\n")
    first = backend.export()
    (backend.api / "controllers/fixture.py").write_text("FIELD = 'string'\n")
    changed = backend.export()
    assert changed["field"] == "string"
    assert changed["snapshot"] != first["snapshot"]


def test_socket_directory_must_be_private(monkeypatch: pytest.MonkeyPatch) -> None:
    from dev.cached_console_openapi import socket_path

    # Keep this short enough for the Unix socket path limit on macOS.
    with tempfile.TemporaryDirectory(prefix="dify-ipc-", dir="/tmp") as directory:
        monkeypatch.setattr(tempfile, "tempdir", directory)
        path = socket_path()
        assert path.parent.stat().st_mode & 0o077 == 0
        path.parent.chmod(0o755)
        with pytest.raises(PermissionError, match="private to the current user"):
            socket_path()
