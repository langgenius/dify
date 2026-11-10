import gc
import os
from collections.abc import Iterator

import pytest

from core.app.workflow.file_runtime import create_dify_workflow_file_runtime
from graphon.file.runtime import use_workflow_file_runtime

# Tests select an explicit deployment event transport.
os.environ.setdefault("HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE", "WEBHOOK")


def pytest_collection_finish(session: pytest.Session) -> None:
    """Move everything loaded during collection out of the garbage collector's reach.

    Collection imports the whole application, so every automatic full collection afterwards
    rescanned those long-lived objects and stalled whichever test triggered it. Objects created
    by tests themselves are still collected normally.
    """
    gc.collect()
    gc.freeze()


@pytest.fixture(autouse=True)
def _bind_workflow_file_runtime() -> Iterator[None]:
    with use_workflow_file_runtime(create_dify_workflow_file_runtime()):
        yield
