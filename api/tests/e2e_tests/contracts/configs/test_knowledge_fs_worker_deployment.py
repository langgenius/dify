"""Check the shipped Compose consumer wiring against the real entrypoint queue selection."""

import subprocess
from pathlib import Path

import pytest
import yaml

_ROOT = Path(__file__).resolve().parents[5]


def _worker_configuration(environment: dict[str, str]) -> subprocess.CompletedProcess[str]:
    script = (_ROOT / "api/docker/entrypoint.sh").read_text()
    # Run the queue/pool selection and its admission guards, without starting a worker.
    start = script.index("  # Configure queues")
    end = script.index('  echo "Starting Celery worker with queues:')
    return subprocess.run(
        ["bash", "-c", script[start:end] + '\nprintf "%s\\n" "$DEFAULT_QUEUES"'],
        env={"PATH": "/usr/bin:/bin", **environment},
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.parametrize("edition", ["COMMUNITY", "ENTERPRISE", "CLOUD"])
@pytest.mark.parametrize("filename", ["docker-compose-template.yaml", "docker-compose.yaml"])
def test_compose_worker_consumes_provisioning_import_and_cleanup_queue(edition: str, filename: str) -> None:
    compose = yaml.safe_load((_ROOT / "docker" / filename).read_text())
    environment = compose["services"]["worker"]["environment"]
    selected = _worker_configuration({**environment, "DEPLOYMENT_EDITION": edition})
    assert selected.returncode == 0, selected.stderr
    assert "knowledge_fs_lifecycle" in selected.stdout.splitlines()[-1].split(",")


@pytest.mark.parametrize("filename", ["docker-compose-template.yaml", "docker-compose.yaml"])
def test_upgrade_worker_enforces_prefork_for_checkpoint_recovery(filename: str) -> None:
    compose = yaml.safe_load((_ROOT / "docker" / filename).read_text())
    worker = compose["services"]["worker_knowledge_fs_upgrade"]
    assert worker["profiles"] == ["knowledge-fs"]
    environment = worker["environment"]
    selected = _worker_configuration({key: str(value) for key, value in environment.items()})
    assert selected.returncode == 0, selected.stderr
    assert selected.stdout.splitlines()[-1] == "knowledge_fs_upgrade"
    rejected = _worker_configuration({"CELERY_WORKER_QUEUES": "knowledge_fs_upgrade", "CELERY_WORKER_POOL": "gevent"})
    assert rejected.returncode != 0
    assert "require CELERY_WORKER_POOL=prefork" in rejected.stderr


def test_explicit_operator_queues_remain_authoritative() -> None:
    selected = _worker_configuration({"CELERY_WORKER_QUEUES": "dataset,mail"})
    assert selected.returncode == 0, selected.stderr
    assert selected.stdout.splitlines()[-1] == "dataset,mail"
