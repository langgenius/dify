import json
import sys
from contextlib import contextmanager
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest
from celery.exceptions import Retry

from core.ops.entities.config_entity import OPS_TRACE_FAILED_KEY
from core.ops.exceptions import RetryableTraceDispatchError
from tasks.ops_trace_task import process_trace_tasks


@contextmanager
def fake_app_context():
    yield


class FakeCurrentApp:
    def app_context(self):
        return fake_app_context()


def _install_trace_manager(
    trace_instance: MagicMock,
    *,
    enterprise_enabled: bool = False,
    enterprise_trace_cls: MagicMock | None = None,
) -> dict[str, ModuleType]:
    ops_trace_manager_module = ModuleType("core.ops.ops_trace_manager")

    class StubOpsTraceManager:
        @staticmethod
        def get_ops_trace_instance(app_id: str) -> MagicMock:
            return trace_instance

    telemetry_module = ModuleType("extensions.ext_enterprise_telemetry")
    telemetry_module.is_enabled = lambda: enterprise_enabled

    ops_trace_manager_module.OpsTraceManager = StubOpsTraceManager
    modules = {
        "core.ops.ops_trace_manager": ops_trace_manager_module,
        "extensions.ext_enterprise_telemetry": telemetry_module,
    }
    if enterprise_trace_cls is not None:
        enterprise_module = ModuleType("enterprise")
        enterprise_telemetry_module = ModuleType("enterprise.telemetry")
        enterprise_trace_module = ModuleType("enterprise.telemetry.enterprise_trace")
        enterprise_trace_module.EnterpriseOtelTrace = enterprise_trace_cls
        modules.update(
            {
                "enterprise": enterprise_module,
                "enterprise.telemetry": enterprise_telemetry_module,
                "enterprise.telemetry.enterprise_trace": enterprise_trace_module,
            }
        )
    return modules


def _make_payload() -> str:
    return json.dumps({"trace_info": {}, "trace_info_type": None})


def _decode_saved_payload(payload: bytes | str) -> dict[str, object]:
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8")
    return json.loads(payload)


def _retryable_dispatch_error() -> RetryableTraceDispatchError:
    return RetryableTraceDispatchError("transient trace dispatch failure")


def _run_task(file_info: dict[str, str], retries: int = 0) -> None:
    process_trace_tasks.push_request(retries=retries)
    try:
        process_trace_tasks.run(file_info)
    finally:
        process_trace_tasks.pop_request()


def test_process_trace_tasks_retries_retryable_dispatch_failure_and_preserves_payload():
    file_info = {"app_id": "app-id", "file_id": "file-id"}
    trace_instance = MagicMock()
    pending_error = _retryable_dispatch_error()
    trace_instance.trace.side_effect = pending_error
    retry_error = Retry()

    with (
        patch.dict(sys.modules, _install_trace_manager(trace_instance)),
        patch("tasks.ops_trace_task.current_app", FakeCurrentApp()),
        patch("tasks.ops_trace_task.storage.load", return_value=_make_payload()),
        patch("tasks.ops_trace_task.storage.delete") as mock_delete,
        patch("tasks.ops_trace_task.redis_client.incr") as mock_incr,
        patch.object(process_trace_tasks, "retry", side_effect=retry_error) as mock_retry,
        pytest.raises(Retry),
    ):
        _run_task(file_info)

    mock_retry.assert_called_once_with(
        exc=pending_error,
        countdown=process_trace_tasks.default_retry_delay,
    )
    mock_delete.assert_not_called()
    mock_incr.assert_not_called()


def test_process_trace_tasks_marks_enterprise_trace_dispatched_before_retryable_dispatch_retry():
    file_info = {"app_id": "app-id", "file_id": "file-id"}
    trace_instance = MagicMock()
    pending_error = _retryable_dispatch_error()
    trace_instance.trace.side_effect = pending_error
    retry_error = Retry()
    enterprise_tracer = MagicMock()
    enterprise_trace_cls = MagicMock(return_value=enterprise_tracer)

    with (
        patch.dict(
            sys.modules,
            _install_trace_manager(
                trace_instance,
                enterprise_enabled=True,
                enterprise_trace_cls=enterprise_trace_cls,
            ),
        ),
        patch("tasks.ops_trace_task.current_app", FakeCurrentApp()),
        patch("tasks.ops_trace_task.storage.load", return_value=_make_payload()),
        patch("tasks.ops_trace_task.storage.save") as mock_save,
        patch("tasks.ops_trace_task.storage.delete") as mock_delete,
        patch("tasks.ops_trace_task.redis_client.incr") as mock_incr,
        patch.object(process_trace_tasks, "retry", side_effect=retry_error) as mock_retry,
        pytest.raises(Retry),
    ):
        _run_task(file_info)

    enterprise_tracer.trace.assert_called_once_with({})
    saved_path, saved_payload = mock_save.call_args.args
    assert saved_path == "ops_trace/app-id/file-id.json"
    assert _decode_saved_payload(saved_payload)["_enterprise_trace_dispatched"] is True
    mock_retry.assert_called_once_with(
        exc=pending_error,
        countdown=process_trace_tasks.default_retry_delay,
    )
    mock_delete.assert_not_called()
    mock_incr.assert_not_called()


def test_process_trace_tasks_does_not_mark_failed_enterprise_trace_as_dispatched_before_retry():
    file_info = {"app_id": "app-id", "file_id": "file-id"}
    trace_instance = MagicMock()
    pending_error = _retryable_dispatch_error()
    trace_instance.trace.side_effect = pending_error
    retry_error = Retry()
    enterprise_tracer = MagicMock()
    enterprise_tracer.trace.side_effect = RuntimeError("enterprise trace failed")
    enterprise_trace_cls = MagicMock(return_value=enterprise_tracer)

    with (
        patch.dict(
            sys.modules,
            _install_trace_manager(
                trace_instance,
                enterprise_enabled=True,
                enterprise_trace_cls=enterprise_trace_cls,
            ),
        ),
        patch("tasks.ops_trace_task.current_app", FakeCurrentApp()),
        patch("tasks.ops_trace_task.storage.load", return_value=_make_payload()),
        patch("tasks.ops_trace_task.storage.save") as mock_save,
        patch("tasks.ops_trace_task.storage.delete") as mock_delete,
        patch("tasks.ops_trace_task.redis_client.incr") as mock_incr,
        patch.object(process_trace_tasks, "retry", side_effect=retry_error) as mock_retry,
        pytest.raises(Retry),
    ):
        _run_task(file_info)

    enterprise_tracer.trace.assert_called_once_with({})
    mock_save.assert_not_called()
    mock_retry.assert_called_once_with(
        exc=pending_error,
        countdown=process_trace_tasks.default_retry_delay,
    )
    mock_delete.assert_not_called()
    mock_incr.assert_not_called()


def test_process_trace_tasks_skips_enterprise_trace_when_retry_payload_was_already_dispatched():
    file_info = {"app_id": "app-id", "file_id": "file-id"}
    trace_instance = MagicMock()
    enterprise_trace_cls = MagicMock()
    payload = json.dumps({"trace_info": {}, "trace_info_type": None, "_enterprise_trace_dispatched": True})

    with (
        patch.dict(
            sys.modules,
            _install_trace_manager(
                trace_instance,
                enterprise_enabled=True,
                enterprise_trace_cls=enterprise_trace_cls,
            ),
        ),
        patch("tasks.ops_trace_task.current_app", FakeCurrentApp()),
        patch("tasks.ops_trace_task.storage.load", return_value=payload),
        patch("tasks.ops_trace_task.storage.save") as mock_save,
        patch("tasks.ops_trace_task.storage.delete") as mock_delete,
        patch("tasks.ops_trace_task.redis_client.incr") as mock_incr,
    ):
        _run_task(file_info)

    enterprise_trace_cls.assert_not_called()
    trace_instance.trace.assert_called_once_with({})
    mock_save.assert_not_called()
    mock_delete.assert_called_once_with("ops_trace/app-id/file-id.json")
    mock_incr.assert_not_called()


def test_process_trace_tasks_default_retry_window_covers_parent_span_context_ttl():
    assert process_trace_tasks.max_retries * process_trace_tasks.default_retry_delay >= 300


def test_process_trace_tasks_deletes_payload_on_success():
    file_info = {"app_id": "app-id", "file_id": "file-id"}
    trace_instance = MagicMock()

    with (
        patch.dict(sys.modules, _install_trace_manager(trace_instance)),
        patch("tasks.ops_trace_task.current_app", FakeCurrentApp()),
        patch("tasks.ops_trace_task.storage.load", return_value=_make_payload()),
        patch("tasks.ops_trace_task.storage.delete") as mock_delete,
        patch("tasks.ops_trace_task.redis_client.incr") as mock_incr,
    ):
        _run_task(file_info)

    trace_instance.trace.assert_called_once_with({})
    mock_delete.assert_called_once_with("ops_trace/app-id/file-id.json")
    mock_incr.assert_not_called()


def test_process_trace_tasks_deletes_payload_and_counts_terminal_failure():
    file_info = {"app_id": "app-id", "file_id": "file-id"}
    trace_instance = MagicMock()
    trace_instance.trace.side_effect = RuntimeError("trace failed")

    with (
        patch.dict(sys.modules, _install_trace_manager(trace_instance)),
        patch("tasks.ops_trace_task.current_app", FakeCurrentApp()),
        patch("tasks.ops_trace_task.storage.load", return_value=_make_payload()),
        patch("tasks.ops_trace_task.storage.delete") as mock_delete,
        patch("tasks.ops_trace_task.redis_client.incr") as mock_incr,
    ):
        _run_task(file_info)

    mock_delete.assert_called_once_with("ops_trace/app-id/file-id.json")
    mock_incr.assert_called_once_with(f"{OPS_TRACE_FAILED_KEY}_app-id")


def test_process_trace_tasks_treats_retry_enqueue_failure_as_terminal_failure():
    file_info = {"app_id": "app-id", "file_id": "file-id"}
    trace_instance = MagicMock()
    pending_error = _retryable_dispatch_error()
    retry_enqueue_error = RuntimeError("retry enqueue failed")
    trace_instance.trace.side_effect = pending_error

    with (
        patch.dict(sys.modules, _install_trace_manager(trace_instance)),
        patch("tasks.ops_trace_task.current_app", FakeCurrentApp()),
        patch("tasks.ops_trace_task.storage.load", return_value=_make_payload()),
        patch("tasks.ops_trace_task.storage.delete") as mock_delete,
        patch("tasks.ops_trace_task.redis_client.incr") as mock_incr,
        patch.object(process_trace_tasks, "retry", side_effect=retry_enqueue_error) as mock_retry,
    ):
        _run_task(file_info)

    mock_retry.assert_called_once_with(
        exc=pending_error,
        countdown=process_trace_tasks.default_retry_delay,
    )
    mock_delete.assert_called_once_with("ops_trace/app-id/file-id.json")
    mock_incr.assert_called_once_with(f"{OPS_TRACE_FAILED_KEY}_app-id")


def test_process_trace_tasks_deletes_payload_and_counts_exhausted_retryable_dispatch_failure():
    file_info = {"app_id": "app-id", "file_id": "file-id"}
    trace_instance = MagicMock()
    pending_error = _retryable_dispatch_error()
    trace_instance.trace.side_effect = pending_error

    with (
        patch.dict(sys.modules, _install_trace_manager(trace_instance)),
        patch("tasks.ops_trace_task.current_app", FakeCurrentApp()),
        patch("tasks.ops_trace_task.storage.load", return_value=_make_payload()),
        patch("tasks.ops_trace_task.storage.delete") as mock_delete,
        patch("tasks.ops_trace_task.redis_client.incr") as mock_incr,
        patch.object(process_trace_tasks, "retry") as mock_retry,
    ):
        _run_task(file_info, retries=process_trace_tasks.max_retries)

    mock_retry.assert_not_called()
    mock_delete.assert_called_once_with("ops_trace/app-id/file-id.json")
    mock_incr.assert_called_once_with(f"{OPS_TRACE_FAILED_KEY}_app-id")
