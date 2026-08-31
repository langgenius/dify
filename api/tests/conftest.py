import os

import pytest

# Tests run with one explicit deployment transport. Configuration tests remove
# this value when exercising the required-setting failure path.
os.environ.setdefault("HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE", "WEBHOOK")

from core.app.workflow.file_runtime import bind_dify_workflow_file_runtime


@pytest.fixture(autouse=True)
def _bind_workflow_file_runtime() -> None:
    bind_dify_workflow_file_runtime()
