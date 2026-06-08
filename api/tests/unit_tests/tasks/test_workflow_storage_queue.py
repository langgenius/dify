"""Regression tests for asynchronous workflow persistence queue wiring.

Workflow persistence tasks are routed to the dedicated workflow_storage queue. The
default Docker and local worker start paths must keep consuming that queue so
non-debug workflow runs do not enqueue writes that no worker receives.
"""

import re
from pathlib import Path
from typing import Protocol, cast

import pytest

from tasks.workflow_execution_tasks import save_workflow_execution_task
from tasks.workflow_node_execution_tasks import (
    save_workflow_node_execution_data_task,
    save_workflow_node_execution_task,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
WORKFLOW_STORAGE_QUEUE = "workflow_storage"


class CeleryTaskWithQueue(Protocol):
    queue: str


def _task_queue(task: object) -> str:
    return cast(CeleryTaskWithQueue, task).queue


def _static_queue_assignments(script_path: Path, variable_name: str) -> list[list[str]]:
    assignments: list[list[str]] = []
    script = script_path.read_text()
    for match in re.finditer(rf"^\s*{variable_name}=\"([^\"]*)\"", script, flags=re.MULTILINE):
        value = match.group(1)
        if "$" in value or "," not in value:
            continue
        assignments.append(value.split(","))
    return assignments


@pytest.mark.parametrize(
    ("task", "task_name"),
    [
        (save_workflow_execution_task, "save_workflow_execution_task"),
        (save_workflow_node_execution_task, "save_workflow_node_execution_task"),
        (save_workflow_node_execution_data_task, "save_workflow_node_execution_data_task"),
    ],
)
def test_workflow_persistence_tasks_use_workflow_storage_queue(task: object, task_name: str) -> None:
    assert _task_queue(task) == WORKFLOW_STORAGE_QUEUE, (
        f"{task_name} must run on the {WORKFLOW_STORAGE_QUEUE} queue so asynchronous workflow persistence "
        "does not contend with workflow execution queues."
    )


@pytest.mark.parametrize(
    ("script_path", "variable_name"),
    [
        (REPO_ROOT / "api" / "docker" / "entrypoint.sh", "DEFAULT_QUEUES"),
        (REPO_ROOT / "dev" / "start-worker", "QUEUES"),
    ],
)
def test_default_worker_start_paths_consume_workflow_storage_queue(script_path: Path, variable_name: str) -> None:
    queue_assignments = _static_queue_assignments(script_path, variable_name)

    assert queue_assignments, f"{script_path} must define default Celery queue assignments"
    missing_assignments = [queues for queues in queue_assignments if WORKFLOW_STORAGE_QUEUE not in queues]
    assert not missing_assignments, (
        f"{script_path} default worker queues must include {WORKFLOW_STORAGE_QUEUE}: {missing_assignments}"
    )


def test_docker_worker_env_example_documents_workflow_storage_queue_override() -> None:
    env_example = (REPO_ROOT / "docker" / "envs" / "core-services" / "worker.env.example").read_text()

    assert "CELERY_WORKER_QUEUES=" in env_example
    assert WORKFLOW_STORAGE_QUEUE in env_example
