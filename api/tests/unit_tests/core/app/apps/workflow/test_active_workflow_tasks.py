from core.app.apps.workflow.active_workflow_tasks import (
    active_workflow_task,
    get_active_workflow_task_ids,
    register_active_workflow_task,
    unregister_active_workflow_task,
)


def test_active_workflow_task_registry_returns_stable_snapshot() -> None:
    register_active_workflow_task("task-b")
    register_active_workflow_task("task-a")

    try:
        assert get_active_workflow_task_ids() == ("task-a", "task-b")
    finally:
        unregister_active_workflow_task("task-a")
        unregister_active_workflow_task("task-b")


def test_active_workflow_task_context_manager_unregisters_on_exit() -> None:
    with active_workflow_task("task-a"):
        assert "task-a" in get_active_workflow_task_ids()

    assert "task-a" not in get_active_workflow_task_ids()
