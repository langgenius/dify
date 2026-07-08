from __future__ import annotations

import importlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import ClassVar, TypeVar, cast

import click
import httpx2 as httpx
import pytest
import typer.main
from typer.testing import CliRunner

from shellctl.client import ShellctlClientError
from shellctl.shared.constants import DEFAULT_BASE_URL
from shellctl.shared.schemas import (
    DeleteJobResponse,
    HealthResponse,
    JobInfo,
    JobResult,
    JobStatusName,
    JobStatusView,
    TerminalSize,
)

cli_module = importlib.import_module("shellctl.cli")
cli = cli_module.cli
runner = CliRunner()
ResultT = TypeVar("ResultT")


def _click_command(command_name: str) -> click.Command:
    return cast(click.Group, typer.main.get_command(cli)).commands[command_name]


def _command_option_names(command_name: str) -> set[str]:
    command = _click_command(command_name)
    return {
        option
        for parameter in command.params
        for option in getattr(parameter, "opts", [])
    }


def _command_option(command_name: str, option_name: str) -> click.Option:
    command = _click_command(command_name)
    for parameter in command.params:
        if isinstance(parameter, click.Option) and option_name in parameter.opts:
            return parameter
    raise AssertionError(f"{option_name} not found on {command_name}")


class RecordingShellctlClient:
    init_calls: ClassVar[list[dict[str, object]]] = []
    calls: ClassVar[list[tuple[str, tuple[object, ...], dict[str, object]]]] = []
    results: ClassVar[dict[str, object]] = {}
    error: ClassVar[BaseException | None] = None

    def __init__(
        self,
        base_url: str,
        *,
        output_limit: int,
        idle_flush_seconds: float,
        token: str | None = None,
        client: object | None = None,
        transport: object | None = None,
    ) -> None:
        del client, transport
        type(self).init_calls.append(
            {
                "base_url": base_url,
                "output_limit": output_limit,
                "idle_flush_seconds": idle_flush_seconds,
                "token": token,
            }
        )

    @classmethod
    def reset(cls) -> None:
        cls.init_calls = []
        cls.calls = []
        cls.results = {}
        cls.error = None

    async def __aenter__(self) -> RecordingShellctlClient:
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None

    def _result(self, method: str, result_type: type[ResultT]) -> ResultT:
        del result_type
        error = type(self).error
        if error is not None:
            raise error
        return cast(ResultT, type(self).results[method])

    async def health(self) -> HealthResponse:
        type(self).calls.append(("health", (), {}))
        return self._result("health", HealthResponse)

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float,
        terminal: TerminalSize | None = None,
    ) -> JobResult:
        type(self).calls.append(
            (
                "run",
                (script,),
                {
                    "cwd": cwd,
                    "env": env,
                    "timeout": timeout,
                    "terminal": terminal,
                },
            )
        )
        return self._result("run", JobResult)

    async def wait(self, job_id: str, *, offset: int, timeout: float) -> JobResult:
        type(self).calls.append(
            ("wait", (job_id,), {"offset": offset, "timeout": timeout})
        )
        return self._result("wait", JobResult)

    async def status(self, job_id: str) -> JobStatusView:
        type(self).calls.append(("status", (job_id,), {}))
        return self._result("status", JobStatusView)

    async def list_jobs(
        self,
        *,
        status: JobStatusName | None = None,
        limit: int,
    ) -> list[JobInfo]:
        type(self).calls.append(("list_jobs", (), {"status": status, "limit": limit}))
        return cast(list[JobInfo], self._result("list_jobs", list))

    async def input(
        self,
        job_id: str,
        text: str,
        *,
        offset: int,
        timeout: float,
    ) -> JobResult:
        type(self).calls.append(
            (
                "input",
                (job_id, text),
                {"offset": offset, "timeout": timeout},
            )
        )
        return self._result("input", JobResult)

    async def tail(self, job_id: str) -> JobResult:
        type(self).calls.append(("tail", (job_id,), {}))
        return self._result("tail", JobResult)

    async def terminate(self, job_id: str, grace_seconds: float) -> JobStatusView:
        type(self).calls.append(
            ("terminate", (job_id,), {"grace_seconds": grace_seconds})
        )
        return self._result("terminate", JobStatusView)

    async def delete(
        self,
        job_id: str,
        *,
        force: bool = False,
        grace_seconds: float | None = None,
    ) -> DeleteJobResponse:
        type(self).calls.append(
            (
                "delete",
                (job_id,),
                {"force": force, "grace_seconds": grace_seconds},
            )
        )
        return self._result("delete", DeleteJobResponse)


@pytest.fixture
def patched_client(
    monkeypatch: pytest.MonkeyPatch,
) -> type[RecordingShellctlClient]:
    RecordingShellctlClient.reset()
    monkeypatch.setattr(cli_module, "ShellctlClient", RecordingShellctlClient)
    return RecordingShellctlClient


def _package_env() -> dict[str, str]:
    package_root = Path(__file__).resolve().parents[3]
    src_path = package_root / "src"
    env = dict(os.environ)
    current_pythonpath = env.get("PYTHONPATH")
    env["PYTHONPATH"] = (
        f"{src_path}{os.pathsep}{current_pythonpath}"
        if current_pythonpath
        else str(src_path)
    )
    return env


def test_shellctl_help_lists_network_commands() -> None:
    result = runner.invoke(cli, ["--help"])

    assert result.exit_code == 0, result.stderr
    assert "health" in result.stdout
    assert "run" in result.stdout
    assert "wait" in result.stdout
    assert "status" in result.stdout
    assert "list" in result.stdout
    assert "input" in result.stdout
    assert "tail" in result.stdout
    assert "terminate" in result.stdout
    assert "delete" in result.stdout
    assert "serve" in result.stdout


def test_shellctl_run_and_serve_help_show_the_new_option_boundaries() -> None:
    run_result = runner.invoke(cli, ["run", "--help"])
    serve_result = runner.invoke(cli, ["serve", "--help"])

    assert run_result.exit_code == 0, run_result.stderr
    assert "--base-url" in run_result.stdout
    assert "--auth-token" in run_result.stdout
    assert "--state-dir" not in run_result.stdout
    assert "--runtime-dir" not in run_result.stdout

    assert serve_result.exit_code == 0, serve_result.stderr
    assert "--state-dir" in serve_result.stdout
    assert "--runtime-dir" in serve_result.stdout
    assert "--auth-token" in serve_result.stdout


def test_shellctl_health_uses_sdk_health_and_ignores_auth_token_input(
    monkeypatch: pytest.MonkeyPatch,
    patched_client: type[RecordingShellctlClient],
) -> None:
    patched_client.results["health"] = HealthResponse(status="ok")
    monkeypatch.setenv("SHELLCTL_AUTH_TOKEN", "from-env")

    result = runner.invoke(cli, ["health", "--auth-token", "flag-token"])

    assert result.exit_code == 0, result.stderr
    assert json.loads(result.stdout) == {"status": "ok"}
    assert patched_client.calls == [("health", (), {})]
    assert patched_client.init_calls == [
        {
            "base_url": DEFAULT_BASE_URL,
            "output_limit": 8192,
            "idle_flush_seconds": 0.5,
            "token": None,
        }
    ]


def test_shellctl_run_builds_sdk_request_and_emits_json(
    patched_client: type[RecordingShellctlClient],
    tmp_path: Path,
) -> None:
    patched_client.results["run"] = JobResult(
        job_id="job-run",
        done=False,
        status=JobStatusName.RUNNING,
        output_path="/tmp/output.log",
        output="hello\n",
        offset=6,
        truncated=False,
    )

    result = runner.invoke(
        cli,
        [
            "run",
            "printf hello\\n",
            "--cwd",
            str(tmp_path / "workspace"),
            "--env",
            "A=1",
            "--env",
            "EMPTY=",
            "--timeout",
            "12",
            "--output-limit",
            "4096",
            "--idle-flush-seconds",
            "0.25",
            "--cols",
            "90",
        ],
    )

    assert result.exit_code == 0, result.stderr
    assert json.loads(result.stdout) == {
        "job_id": "job-run",
        "done": False,
        "status": "running",
        "output_path": "/tmp/output.log",
        "output": "hello\n",
        "offset": 6,
        "truncated": False,
    }
    assert patched_client.init_calls == [
        {
            "base_url": DEFAULT_BASE_URL,
            "output_limit": 4096,
            "idle_flush_seconds": 0.25,
            "token": None,
        }
    ]
    assert patched_client.calls[0][0] == "run"
    assert patched_client.calls[0][1] == ("printf hello\\n",)
    assert patched_client.calls[0][2]["cwd"] == str(tmp_path / "workspace")
    assert patched_client.calls[0][2]["env"] == {"A": "1", "EMPTY": ""}
    assert patched_client.calls[0][2]["timeout"] == 12.0
    terminal = patched_client.calls[0][2]["terminal"]
    assert isinstance(terminal, TerminalSize)
    assert terminal.cols == 90
    assert terminal.rows == 80


def test_shellctl_wait_and_input_require_offset() -> None:
    assert _command_option("wait", "--offset").required is True
    assert _command_option("input", "--offset").required is True


def test_shellctl_wait_and_input_map_requests(
    patched_client: type[RecordingShellctlClient],
) -> None:
    patched_client.results["wait"] = JobResult(
        job_id="job-1",
        done=False,
        status=JobStatusName.RUNNING,
        output_path="/tmp/wait.log",
        output="chunk",
        offset=5,
        truncated=False,
    )

    wait_result = runner.invoke(
        cli,
        [
            "wait",
            "job-1",
            "--offset",
            "3",
            "--timeout",
            "9",
            "--output-limit",
            "2048",
            "--idle-flush-seconds",
            "0.1",
        ],
    )

    assert wait_result.exit_code == 0, wait_result.stderr
    assert patched_client.calls[0] == (
        "wait",
        ("job-1",),
        {"offset": 3, "timeout": 9.0},
    )
    assert patched_client.init_calls[0]["output_limit"] == 2048
    assert patched_client.init_calls[0]["idle_flush_seconds"] == 0.1

    RecordingShellctlClient.reset()
    patched_client.results["input"] = JobResult(
        job_id="job-1",
        done=False,
        status=JobStatusName.RUNNING,
        output_path="/tmp/input.log",
        output="reply",
        offset=8,
        truncated=False,
    )

    input_result = runner.invoke(
        cli,
        [
            "input",
            "job-1",
            "hello\n",
            "--offset",
            "5",
            "--timeout",
            "4",
            "--output-limit",
            "512",
            "--idle-flush-seconds",
            "0",
        ],
    )

    assert input_result.exit_code == 0, input_result.stderr
    assert patched_client.calls[0] == (
        "input",
        ("job-1", "hello\n"),
        {"offset": 5, "timeout": 4.0},
    )
    assert patched_client.init_calls[0]["output_limit"] == 512
    assert patched_client.init_calls[0]["idle_flush_seconds"] == 0.0


def test_shellctl_list_tail_status_terminate_and_delete_map_arguments(
    patched_client: type[RecordingShellctlClient],
) -> None:
    patched_client.results["list_jobs"] = [
        JobInfo(
            job_id="job-2",
            status=JobStatusName.RUNNING,
            created_at="2026-05-21T15:30:12Z",
        )
    ]

    list_result = runner.invoke(cli, ["list", "--status", "running", "--limit", "5"])

    assert list_result.exit_code == 0, list_result.stderr
    assert json.loads(list_result.stdout) == [
        {
            "job_id": "job-2",
            "status": "running",
            "created_at": "2026-05-21T15:30:12Z",
        }
    ]
    assert patched_client.calls[0] == (
        "list_jobs",
        (),
        {"status": JobStatusName.RUNNING, "limit": 5},
    )

    RecordingShellctlClient.reset()
    patched_client.results["tail"] = JobResult(
        job_id="job-2",
        done=False,
        status=JobStatusName.RUNNING,
        output_path="/tmp/tail.log",
        output="tail",
        offset=4,
        truncated=False,
    )
    tail_result = runner.invoke(cli, ["tail", "job-2", "--output-limit", "16"])
    assert tail_result.exit_code == 0, tail_result.stderr
    assert patched_client.calls[0] == ("tail", ("job-2",), {})
    assert patched_client.init_calls[0]["output_limit"] == 16

    RecordingShellctlClient.reset()
    patched_client.results["status"] = JobStatusView(
        job_id="job-2",
        status=JobStatusName.RUNNING,
        done=False,
        created_at="2026-05-21T15:30:12Z",
        started_at="2026-05-21T15:30:13Z",
        offset=4,
    )
    status_result = runner.invoke(cli, ["status", "job-2"])
    assert status_result.exit_code == 0, status_result.stderr
    assert patched_client.calls[0] == ("status", ("job-2",), {})

    RecordingShellctlClient.reset()
    patched_client.results["terminate"] = JobStatusView(
        job_id="job-2",
        status=JobStatusName.TERMINATED,
        done=True,
        created_at="2026-05-21T15:30:12Z",
        started_at="2026-05-21T15:30:13Z",
        ended_at="2026-05-21T15:30:18Z",
        offset=4,
    )
    terminate_result = runner.invoke(
        cli,
        ["terminate", "job-2", "--grace-seconds", "0.25"],
    )
    assert terminate_result.exit_code == 0, terminate_result.stderr
    assert patched_client.calls[0] == (
        "terminate",
        ("job-2",),
        {"grace_seconds": 0.25},
    )

    RecordingShellctlClient.reset()
    patched_client.results["delete"] = DeleteJobResponse(job_id="job-2")
    delete_result = runner.invoke(
        cli,
        ["delete", "job-2", "--force", "--grace-seconds", "0.5"],
    )
    assert delete_result.exit_code == 0, delete_result.stderr
    assert patched_client.calls[0] == (
        "delete",
        ("job-2",),
        {"force": True, "grace_seconds": 0.5},
    )


def test_shellctl_run_rejects_invalid_env_entry() -> None:
    result = runner.invoke(cli, ["run", "printf bad", "--env", "MISSING_EQUALS"])

    assert result.exit_code == 2
    assert "env entries must use NAME=VALUE format" in result.stderr


def test_shellctl_commands_render_sdk_errors_as_json_stderr(
    patched_client: type[RecordingShellctlClient],
) -> None:
    patched_client.error = ShellctlClientError(
        404,
        "job_not_found",
        "Job missing is not found",
    )

    result = runner.invoke(cli, ["status", "missing"])

    assert result.exit_code == 1
    assert result.stdout == ""
    assert json.loads(result.stderr) == {
        "error": {
            "code": "job_not_found",
            "message": "Job missing is not found",
        }
    }


def test_shellctl_commands_render_transport_errors_as_json_stderr(
    patched_client: type[RecordingShellctlClient],
) -> None:
    patched_client.error = httpx.TransportError("connection refused")

    result = runner.invoke(cli, ["status", "missing"])

    assert result.exit_code == 1
    assert result.stdout == ""
    assert json.loads(result.stderr) == {
        "error": {
            "code": "connection_error",
            "message": "connection refused",
        }
    }


def test_shellctl_commands_render_timeouts_as_json_stderr(
    patched_client: type[RecordingShellctlClient],
) -> None:
    patched_client.error = httpx.TimeoutException("slow server")

    result = runner.invoke(cli, ["status", "missing"])

    assert result.exit_code == 1
    assert result.stdout == ""
    assert json.loads(result.stderr) == {
        "error": {
            "code": "request_timeout",
            "message": "request timed out",
        }
    }


def test_shellctl_base_url_and_auth_token_flags_override_environment(
    monkeypatch: pytest.MonkeyPatch,
    patched_client: type[RecordingShellctlClient],
) -> None:
    patched_client.results["status"] = JobStatusView(
        job_id="job-2",
        status=JobStatusName.RUNNING,
        done=False,
        created_at="2026-05-21T15:30:12Z",
        started_at="2026-05-21T15:30:13Z",
        offset=4,
    )
    monkeypatch.setenv("SHELLCTL_BASE_URL", "http://from-env:9999")
    monkeypatch.setenv("SHELLCTL_AUTH_TOKEN", "from-env-token")

    result = runner.invoke(
        cli,
        [
            "status",
            "job-2",
            "--base-url",
            "http://override:8765",
            "--auth-token",
            "flag-token",
        ],
    )

    assert result.exit_code == 0, result.stderr
    assert patched_client.init_calls == [
        {
            "base_url": "http://override:8765",
            "output_limit": 8192,
            "idle_flush_seconds": 0.5,
            "token": "flag-token",
        }
    ]


def test_shellctl_cli_controller_module_is_removed() -> None:
    assert (
        importlib.util.find_spec("shellctl.server.cli_controller")
        is None
    )


def test_importing_shellctl_cli_for_run_help_skips_server_stack() -> None:
    package_root = Path(__file__).resolve().parents[3]
    command = """
import json
import sys
from typer.testing import CliRunner
from shellctl.cli import cli

result = CliRunner().invoke(cli, ["run", "--help"])
print(json.dumps({
    "exit_code": result.exit_code,
    "stdout": result.stdout,
    "modules": {
        "fastapi": "fastapi" in sys.modules,
        "uvicorn": "uvicorn" in sys.modules,
        "sqlalchemy": "sqlalchemy" in sys.modules,
        "sqlmodel": "sqlmodel" in sys.modules,
        "service": "shellctl.server.service" in sys.modules,
        "api": "shellctl.server.api" in sys.modules,
        "tmux": "shellctl.server.tmux" in sys.modules,
        "shared_runtime": "shellctl.shared.runtime" in sys.modules,
        "shared_output": "shellctl.shared.output" in sys.modules,
        "shared_sanitize": "shellctl.shared.sanitize" in sys.modules,
    },
}))
"""

    result = subprocess.run(
        [sys.executable, "-c", command],
        capture_output=True,
        text=True,
        check=False,
        cwd=package_root,
        env=_package_env(),
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["exit_code"] == 0
    assert "--base-url" in payload["stdout"]
    assert payload["modules"] == {
        "fastapi": False,
        "uvicorn": False,
        "sqlalchemy": False,
        "sqlmodel": False,
        "service": False,
        "api": False,
        "tmux": False,
        "shared_runtime": False,
        "shared_output": False,
        "shared_sanitize": False,
    }


def test_importing_server_serve_command_skips_cli_and_sdk_modules() -> None:
    package_root = Path(__file__).resolve().parents[3]
    command = """
import json
import sys
from shellctl.server import serve_command

print(json.dumps({
    "callable": callable(serve_command),
    "modules": {
        "cli": "shellctl.cli" in sys.modules,
        "sdk": "shellctl.client.sdk" in sys.modules,
        "client": "shellctl.client" in sys.modules,
    },
}))
"""

    result = subprocess.run(
        [sys.executable, "-c", command],
        capture_output=True,
        text=True,
        check=False,
        cwd=package_root,
        env=_package_env(),
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["callable"] is True
    assert payload["modules"] == {
        "cli": False,
        "sdk": False,
        "client": False,
    }
