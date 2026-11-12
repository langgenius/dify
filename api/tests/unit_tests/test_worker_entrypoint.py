import os
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.helpers.unit.worker_entrypoint import worker_configuration


@pytest.mark.parametrize("enabled", ["false", "true"])
@pytest.mark.parametrize("queue", [None, "workspace-a.external-agents"])
def test_external_worker_uses_container_queue_and_preserves_shared_admission_flag(
    enabled: str,
    queue: str | None,
) -> None:
    environment = {
        "MODE": "external_agent_worker",
        "EXTERNAL_AGENTS_ENABLED": enabled,
        "CELERY_QUEUES": "generic-default",
        "CELERY_WORKER_QUEUES": "generic-override",
        "CELERY_WORKER_POOL": "gevent",
        "CELERY_PREFETCH_MULTIPLIER": "8",
    }
    if queue is not None:
        environment["EXTERNAL_AGENTS_QUEUE"] = queue
    selected = worker_configuration(environment, include_worker_environment=True)
    assert selected.returncode == 0, selected.stderr
    assert selected.stdout.splitlines()[-5:] == ["worker", enabled, "prefork", "1", queue or "external_agents"]
    assert selected.stdout.splitlines()[-6] == "external_agent_celery_entrypoint.celery"


def test_ordinary_worker_keeps_existing_celery_application_bootstrap() -> None:
    """The dedicated isolation profile cannot change ordinary worker startup."""
    selected = worker_configuration(
        {"MODE": "worker", "EXTERNAL_AGENTS_ENABLED": "false"}, include_worker_environment=True
    )
    assert selected.returncode == 0, selected.stderr
    assert selected.stdout.splitlines()[-6] == "celery_entrypoint.celery"


@pytest.mark.parametrize("configured_path", [None, "/configured/package:/another/package"])
def test_external_worker_exec_exports_api_import_root_for_spawn(tmp_path: Path, configured_path: str | None) -> None:
    """The real shipped shell exports a persistent import root to its CLI process."""
    shell = shutil.which("bash")
    assert shell is not None
    major = subprocess.check_output([shell, "-c", 'printf "%s" "${BASH_VERSINFO[0]}"'], text=True)
    if int(major) < 4:
        pytest.skip("The shipped Linux entrypoint requires Bash 4+; this host provides Bash 3.")
    binary = tmp_path / "celery"
    binary.write_text('#!/bin/bash\nprintf "BYOA-PYTHONPATH:%s\\n" "$PYTHONPATH"\nprintf "BYOA-ARG:%s\\n" "$@"\n')
    binary.chmod(0o700)
    api_root = Path(__file__).parents[2]
    environment = {
        "PATH": str(tmp_path) + os.pathsep + "/usr/bin:/bin",
        "MODE": "external_agent_worker",
        "EXTERNAL_AGENTS_ENABLED": "false",
        "EXTERNAL_AGENTS_QUEUE": "isolated-probe-queue",
        "CELERY_WORKER_CONCURRENCY": "2",
    }
    if configured_path is not None:
        environment["PYTHONPATH"] = configured_path
    result = subprocess.run(
        [shell, str(api_root / "docker/entrypoint.sh")],
        cwd=api_root,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    import_root = str(api_root) + (os.pathsep + configured_path if configured_path else "")
    assert "BYOA-PYTHONPATH:" + import_root in result.stdout.splitlines()
    arguments = [line.removeprefix("BYOA-ARG:") for line in result.stdout.splitlines() if line.startswith("BYOA-ARG:")]
    assert arguments[:5] == ["-A", "external_agent_celery_entrypoint.celery", "worker", "-P", "prefork"]
    assert arguments[arguments.index("-Q") + 1] == "isolated-probe-queue"
    assert arguments[arguments.index("-c") + 1] == "2"


def test_ordinary_worker_preserves_its_existing_import_path() -> None:
    """Cold-spawn import setup is restricted to the dedicated External role."""
    result = worker_configuration(
        {"MODE": "worker", "EXTERNAL_AGENTS_ENABLED": "false", "PYTHONPATH": "/configured/ordinary"},
        include_worker_environment=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines()[-7] == "/configured/ordinary"


@pytest.mark.parametrize("configured_path", [None, "/configured/package:/another/package"])
def test_external_worker_path_selection_preserves_existing_imports(configured_path: str | None) -> None:
    """Portable profile selection keeps the API root and each configured path."""
    environment = {"MODE": "external_agent_worker", "EXTERNAL_AGENTS_ENABLED": "false"}
    if configured_path is not None:
        environment["PYTHONPATH"] = configured_path
    result = worker_configuration(environment, include_worker_environment=True)
    assert result.returncode == 0, result.stderr
    expected = str(Path.cwd()) + (os.pathsep + configured_path if configured_path else "")
    assert result.stdout.splitlines()[-7] == expected
