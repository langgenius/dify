import inspect
from pathlib import Path

from tasks.human_input_v2_delivery_tasks import (
    dispatch_human_input_v2_delivery_attempt_task,
    publish_due_human_input_v2_delivery_attempts_task,
)


def test_v2_delivery_tasks_are_routed_to_the_dedicated_queue() -> None:
    assert dispatch_human_input_v2_delivery_attempt_task.queue == "human_input_delivery"
    assert publish_due_human_input_v2_delivery_attempts_task.queue == "human_input_delivery"
    assert tuple(inspect.signature(dispatch_human_input_v2_delivery_attempt_task.run).parameters) == ("attempt_id",)


def test_default_worker_and_deployment_docs_include_the_dedicated_queue() -> None:
    repository_root = Path(__file__).parents[4]
    entrypoint = (repository_root / "api" / "docker" / "entrypoint.sh").read_text()
    env_example = (repository_root / "docker" / ".env.example").read_text()
    legacy_tasks = (repository_root / "api" / "tasks" / "mail_human_input_delivery_task.py").read_text()

    assert "mail,human_input_delivery" in entrypoint
    assert "CELERY_QUEUES=mail,human_input_delivery" in env_example
    assert legacy_tasks.count('@shared_task(queue="mail")') == 2
    assert "human_input_delivery" not in legacy_tasks
