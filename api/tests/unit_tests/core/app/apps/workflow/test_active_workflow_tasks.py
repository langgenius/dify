import pytest

from core.app.apps.workflow.active_workflow_tasks import (
    active_workflow_task,
    get_active_workflow_task_count,
    reset_active_workflow_tasks,
)


@pytest.fixture(autouse=True)
def reset_active_tasks() -> None:
    reset_active_workflow_tasks()
    yield
    reset_active_workflow_tasks()


def test_active_workflow_task_tracks_count_during_context() -> None:
    assert get_active_workflow_task_count() == 0

    with active_workflow_task("task-a"):
        assert get_active_workflow_task_count() == 1

    assert get_active_workflow_task_count() == 0


def test_active_workflow_task_rejects_duplicate_task_id() -> None:
    with active_workflow_task("task-a"):
        with pytest.raises(ValueError, match="already active"):
            with active_workflow_task("task-a"):
                pass
