import pytest


@pytest.fixture(autouse=True)
def _bind_workflow_file_runtime() -> None:
    # xdist coordinators load conftests but never run fixtures. Defer the
    # workflow dependency chain until a test actually needs the runtime.
    from core.app.workflow.file_runtime import bind_dify_workflow_file_runtime

    bind_dify_workflow_file_runtime()
