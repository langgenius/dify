"""Inspection deadlines cover progress-free polling and cleanup, with private errors."""

import asyncio
import json
import shlex
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import override

import pytest

from dify_agent.protocol import InspectExecutionBindingRequest
from dify_agent.runtime_backend.local import LocalExecutionBindingBackend, _LOCAL_INSPECTION_PROBE


@pytest.mark.anyio
@pytest.mark.parametrize("mode", ["run", "poll", "poll_delete", "delete", "delete_error"])
async def test_local_inspection_has_total_deadline_and_private_cleanup(
    tmp_path: Path, mode: str, caplog: pytest.LogCaptureFixture
) -> None:
    home_root, workspace_root = tmp_path / "homes", tmp_path / "workspaces"
    home_root.mkdir()
    workspace_root.mkdir()
    (home_root / "b").mkdir()
    probe_args = json.dumps(
        dict(
            binding_ref="b:w",
            workspace_ref="w",
            home_root=str(home_root),
            workspace_root=str(workspace_root),
            home_path=str(home_root / "b"),
            workspace_path=str(workspace_root / "w"),
        )
    )
    expected_script = shlex.join(["python3", "-c", _LOCAL_INSPECTION_PROBE, probe_args])
    # A real missing Workspace would authorize gone only after bounded cleanup.
    release = threading.Event()
    polling = mode in {"poll", "poll_delete"}
    requests: list[str] = []
    probes_match: list[bool] = []
    marker = "PRIVATE_CREDENTIAL_/private/home/b_PROVIDER_BODY"

    class Handler(BaseHTTPRequestHandler):
        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

        def reply(self, body: object, status: int = 200) -> None:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            try:
                self.wfile.write(json.dumps(body).encode())
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_POST(self) -> None:
            requests.append(self.path)
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if self.path == "/v1/jobs/run":
                matches = body.get("script") == expected_script
                probes_match.append(matches)
                if not matches:
                    self.reply({"error": "unexpected inspection command"}, status=400)
                    return
            if mode == "run":
                release.wait(10)
            if self.path.endswith("/wait"):
                release.wait(0.05)
                output = ""
            else:
                output = subprocess.run(
                    [sys.executable, "-c", _LOCAL_INSPECTION_PROBE, probe_args],
                    check=True,
                    capture_output=True,
                    text=True,
                    cwd=tmp_path,
                ).stdout
            self.reply(
                dict(
                    job_id="probe",
                    done=not polling,
                    status="running" if polling else "exited",
                    exit_code=None if polling else 0,
                    output_path="/private/output",
                    output=output,
                    offset=0,
                    truncated=False,
                )
            )

        def do_DELETE(self) -> None:
            requests.append(self.path)
            if mode in {"delete", "poll_delete"}:
                release.wait(10)
            if mode == "delete_error":
                self.reply({"error": {"code": "upstream", "message": marker}}, status=500)
            else:
                self.reply({"job_id": "probe", "deleted": True})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    backend = LocalExecutionBindingBackend(
        endpoint=f"http://127.0.0.1:{server.server_port}",
        auth_token="private",
        materialized_home_root=str(home_root),
        workspace_root=str(workspace_root),
        snapshot_root=str(home_root / ".snapshots"),
    )
    started = asyncio.get_running_loop().time()
    task = asyncio.create_task(
        backend.inspect_binding(InspectExecutionBindingRequest(binding_ref="b:w", workspace_ref="w"))
    )
    try:
        done, pending = await asyncio.wait({task}, timeout=7.0)
        assert not pending, "Local inspection exceeded its fixed total deadline, including cleanup"
        elapsed = asyncio.get_running_loop().time() - started
        assert elapsed < 5.75, "Inspection renewed its fixed five-second total budget"
        if mode in {"run", "poll", "poll_delete"}:
            assert elapsed >= 3.0, "The real production probe budget was unexpectedly shortened"
        result = next(iter(done)).result()
        assert (result.state, result.evidence_code) == ("uncertain", "probe_unavailable")
        assert marker not in result.model_dump_json() + caplog.text
        assert all(record.exc_info is None for record in caplog.records)
        assert requests.count("/v1/jobs/run") == 1
        assert probes_match == [True]
        assert all(path == "/v1/jobs/run" or path.startswith("/v1/jobs/probe") for path in requests)
        assert sum(path.startswith("/v1/jobs/probe?force=") for path in requests) <= 1
    finally:
        release.set()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.mark.anyio
@pytest.mark.parametrize("mode", ["error", "stall"])
async def test_inspection_helper_bounds_and_sanitizes_owned_resource_close(
    tmp_path: Path, mode: str, caplog: pytest.LogCaptureFixture
) -> None:
    from collections.abc import AsyncGenerator

    from dify_agent.runtime_backend.protocols import RuntimeLayout
    from dify_agent.runtime_backend.shellctl import create_shellctl_lease, run_shellctl_inspection_command

    marker = "PRIVATE_CLOSE_/private/workspace_AUTH_TOKEN"
    released = asyncio.Event()
    closed = asyncio.Event()

    async def resource() -> AsyncGenerator[None, None]:
        # Real local resource lifecycle: its close either stalls or raises.
        with (tmp_path / "owned-resource").open("w"):
            try:
                yield
            finally:
                closed.set()
                if mode == "stall":
                    await released.wait()
                raise RuntimeError(marker)

    owned = resource()
    await anext(owned)

    class Handler(BaseHTTPRequestHandler):
        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

        def do_POST(self) -> None:
            self.rfile.read(int(self.headers["Content-Length"]))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                b'{"job_id":"probe","done":true,"status":"exited","exit_code":0,"output_path":"/tmp/probe","output":"{}","offset":0,"truncated":false}'
            )

        def do_DELETE(self) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"job_id":"probe","deleted":true}')

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    lease = create_shellctl_lease(
        handle="private-binding",
        layout=RuntimeLayout(home_dir=str(tmp_path), workspace_dir=str(tmp_path)),
        entrypoint=f"http://127.0.0.1:{server.server_port}",
        token="private",
        owned_transport=owned,
    )
    task = asyncio.create_task(
        run_shellctl_inspection_command(
            lease, "true", deadline=asyncio.get_running_loop().time() + 1.0, cleanup_budget=0.6
        )
    )
    try:
        done, pending = await asyncio.wait({task}, timeout=2.0)
        assert not pending, "Owned resource close exceeded the helper's absolute deadline"
        with pytest.raises(RuntimeError, match="^inspection cleanup unavailable$"):
            next(iter(done)).result()
        assert closed.is_set()
        assert marker not in caplog.text
        assert all(record.exc_info is None for record in caplog.records)
        cleanup = [record for record in caplog.records if record.message == "binding inspection cleanup unavailable"]
        assert len(cleanup) == 1
        assert cleanup[0].__dict__["inspection_phase"] == "close_transport"
        assert cleanup[0].__dict__["inspection_category"] == ("timeout" if mode == "stall" else "error")
        assert cleanup[0].__dict__["inspection_status"] == "uncertain"
    finally:
        released.set()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await owned.aclose()
        server.shutdown()
        server.server_close()
        thread.join()
