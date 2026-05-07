import pytest

from core.app.workflow.file_runtime import bind_dify_workflow_file_runtime


@pytest.fixture(autouse=True)
def _bind_workflow_file_runtime() -> None:
    bind_dify_workflow_file_runtime()


@pytest.fixture(autouse=True)
def disable_wandb(monkeypatch):
    """Disable wandb globally for all tests to prevent CI errors."""
    monkeypatch.setenv("WANDB_MODE", "disabled")
    monkeypatch.setenv("WANDB_SILENT", "true")
