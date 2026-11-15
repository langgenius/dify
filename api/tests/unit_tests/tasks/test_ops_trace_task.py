"""Old task name keeps consuming owned legacy payloads after the upgrade."""

import pytest

from tasks import ops_trace_task
from tests.unit_tests.tasks.test_ops_trace_legacy_compatibility import KEY, LegacyTaskDomain, _run

pytest_plugins = ("tests.unit_tests.tasks.test_ops_trace_legacy_compatibility",)


def test_legacy_trace_tasks_export_then_clean_owned_payload(legacy_domain: LegacyTaskDomain) -> None:
    _run(legacy_domain)
    assert len(legacy_domain.requests) == 1
    assert legacy_domain.requests[0].content
    assert not legacy_domain.storage.storage_runner.exists(KEY)


def test_legacy_trace_tasks_never_read_or_delete_outside_their_folder(legacy_domain: LegacyTaskDomain) -> None:
    with legacy_domain.app.app_context(), pytest.raises(ValueError, match="Invalid legacy trace payload reference"):
        ops_trace_task.process_trace_tasks.run({"app_id": "..", "file_id": "../secrets"})
    assert legacy_domain.requests == []
    assert legacy_domain.storage.storage_runner.exists(KEY)
