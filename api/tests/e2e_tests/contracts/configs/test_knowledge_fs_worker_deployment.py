"""Check the shipped Compose consumer wiring against the real entrypoint queue selection."""

from pathlib import Path

import pytest
import yaml

from tests.helpers.unit.worker_entrypoint import worker_configuration

_ROOT = Path(__file__).resolve().parents[5]


@pytest.mark.parametrize("edition", ["COMMUNITY", "ENTERPRISE", "CLOUD"])
@pytest.mark.parametrize("filename", ["docker-compose-template.yaml", "docker-compose.yaml"])
def test_compose_worker_consumes_provisioning_import_and_cleanup_queue(edition: str, filename: str) -> None:
    compose = yaml.safe_load((_ROOT / "docker" / filename).read_text())
    environment = compose["services"]["worker"]["environment"]
    selected = worker_configuration({**environment, "DEPLOYMENT_EDITION": edition})
    assert selected.returncode == 0, selected.stderr
    assert "knowledge_fs_lifecycle" in selected.stdout.splitlines()[-1].split(",")


@pytest.mark.parametrize("filename", ["docker-compose-template.yaml", "docker-compose.yaml"])
def test_upgrade_worker_enforces_prefork_for_checkpoint_recovery(filename: str) -> None:
    compose = yaml.safe_load((_ROOT / "docker" / filename).read_text())
    worker = compose["services"]["worker_knowledge_fs_upgrade"]
    assert worker["profiles"] == ["knowledge-fs"]
    environment = worker["environment"]
    selected = worker_configuration({key: str(value) for key, value in environment.items()})
    assert selected.returncode == 0, selected.stderr
    assert selected.stdout.splitlines()[-1] == "knowledge_fs_upgrade"
    rejected = worker_configuration({"CELERY_WORKER_QUEUES": "knowledge_fs_upgrade", "CELERY_WORKER_POOL": "gevent"})
    assert rejected.returncode != 0
    assert "require CELERY_WORKER_POOL=prefork" in rejected.stderr


def test_explicit_operator_queues_remain_authoritative() -> None:
    selected = worker_configuration({"CELERY_WORKER_QUEUES": "dataset,mail"})
    assert selected.returncode == 0, selected.stderr
    assert selected.stdout.splitlines()[-1] == "dataset,mail"
