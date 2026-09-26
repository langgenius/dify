from collections.abc import Iterator

import pytest

from core.app.workflow.file_runtime import create_dify_workflow_file_runtime
from graphon.file.runtime import use_workflow_file_runtime


@pytest.fixture(autouse=True)
def _bind_workflow_file_runtime() -> Iterator[None]:
    with use_workflow_file_runtime(create_dify_workflow_file_runtime()):
        yield
