import os
import subprocess
from collections.abc import Callable
from pathlib import Path

import pytest

from tests.helpers.unit.worker_entrypoint import worker_configuration


@pytest.fixture
def development_worker_configuration(tmp_path: Path) -> Callable[[dict[str, str]], subprocess.CompletedProcess[str]]:
    """Record the development launcher's Celery arguments without starting a worker."""
    executable = tmp_path / "uv"
    executable.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
    executable.chmod(0o755)
    launcher = Path(__file__).resolve().parents[3] / "dev" / "start-worker"

    def configure(environment: dict[str, str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(launcher)],
            env={"PATH": f"{tmp_path}{os.pathsep}{os.defpath}", **environment},
            capture_output=True,
            text=True,
            check=False,
        )

    return configure


@pytest.mark.parametrize("edition", ["COMMUNITY", "ENTERPRISE", "CLOUD"])
@pytest.mark.parametrize("launcher", ["docker", "development"])
def test_default_worker_queue_sets_consume_human_input_tasks(
    edition: str,
    launcher: str,
    development_worker_configuration: Callable[[dict[str, str]], subprocess.CompletedProcess[str]],
) -> None:
    configure = worker_configuration if launcher == "docker" else development_worker_configuration
    selected = configure({"DEPLOYMENT_EDITION": edition})
    assert selected.returncode == 0, selected.stderr
    assert {"human_input_delivery", "human_input_contact_sync"} <= set(selected.stdout.splitlines()[-1].split(","))


@pytest.mark.parametrize("edition", ["COMMUNITY", "ENTERPRISE", "CLOUD"])
@pytest.mark.parametrize("queue", [None, "ops_trace", "tracing-upgrade"])
def test_default_worker_consumes_configured_trace_queue_without_legacy_queue(edition: str, queue: str | None) -> None:
    environment = {"DEPLOYMENT_EDITION": edition}
    if queue is not None:
        environment["OPS_TRACE_QUEUE"] = queue
    selected = worker_configuration(environment)
    assert selected.returncode == 0, selected.stderr
    queues = selected.stdout.splitlines()[-1].split(",")
    expected = queue or "ops_trace_v2"
    assert expected in queues
    if expected != "ops_trace":
        assert "ops_trace" not in queues
