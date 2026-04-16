"""
Unit tests for AppGenerateService.generate_async and related async workflow helpers.

Covers:
  - generate_async              (happy path, Celery dispatch, idempotency dedup, dispatch failure)
  - _try_acquire_idempotency_key (atomic acquire, duplicate detection, pending retry, stale cleanup)
  - _finalize_idempotency_key   (overwrites pending with real response)
  - _check_async_concurrency_limit (under limit, at limit, unlimited)
"""

import json
from unittest.mock import MagicMock, patch

import pytest

import services.app_generate_service as ags_module
from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import AppMode
from services.app_generate_service import AppGenerateService


# ---------------------------------------------------------------------------
# Helpers / Fakes
# ---------------------------------------------------------------------------
class _DummyRateLimit:
    """Minimal stand-in for RateLimit that never touches Redis."""

    def __init__(self, client_id: str, max_active_requests: int) -> None:
        self.client_id = client_id
        self.max_active_requests = max_active_requests

    @staticmethod
    def gen_request_key() -> str:
        return "dummy-request-id"

    def enter(self, request_id: str | None = None) -> str:
        return request_id or "dummy-request-id"

    def exit(self, request_id: str) -> None:
        pass

    def generate(self, generator, request_id: str):
        return generator


def _make_app(mode: AppMode | str = AppMode.WORKFLOW, *, max_active_requests: int = 0) -> MagicMock:
    app = MagicMock()
    app.mode = mode
    app.id = "app-id"
    app.tenant_id = "tenant-id"
    app.max_active_requests = max_active_requests
    app.is_agent = False
    return app


def _make_user() -> MagicMock:
    user = MagicMock()
    user.id = "user-id"
    return user


def _make_workflow(*, workflow_id: str = "workflow-id") -> MagicMock:
    workflow = MagicMock()
    workflow.id = workflow_id
    workflow.type = "workflow"
    workflow.version = "1.0"
    workflow.graph = '{"nodes":[],"edges":[]}'
    workflow.created_by = "owner-id"
    return workflow


# ---------------------------------------------------------------------------
# generate_async
# ---------------------------------------------------------------------------
class TestGenerateAsync:
    @pytest.fixture(autouse=True)
    def _common(self, mocker, monkeypatch):
        monkeypatch.setattr(ags_module.dify_config, "BILLING_ENABLED", False)
        monkeypatch.setattr(ags_module.dify_config, "ASYNC_WORKFLOW_MAX_CONCURRENT", 50)
        mocker.patch("services.app_generate_service.RateLimit", _DummyRateLimit)
        mocker.patch.object(AppGenerateService, "_get_workflow", return_value=_make_workflow())
        mocker.patch.object(AppGenerateService, "_check_async_concurrency_limit")
        # Mock the pre-create to avoid real DB access
        mock_run = MagicMock()
        mock_run.created_at.timestamp.return_value = 1700000000
        mocker.patch.object(AppGenerateService, "_pre_create_workflow_run", return_value=mock_run)
        # Mock AppExecutionParams.new
        mocker.patch(
            "services.app_generate_service.AppExecutionParams.new",
            return_value=MagicMock(workflow_run_id="wfr-async", model_dump_json=MagicMock(return_value="{}")),
        )

    def test_happy_path_dispatches_celery_task(self, mocker):
        delay_spy = mocker.patch("services.app_generate_service.workflow_based_app_execution_task.delay")

        response, is_duplicate = AppGenerateService.generate_async(
            app_model=_make_app(),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
        )

        delay_spy.assert_called_once()
        assert is_duplicate is False
        assert "workflow_run_id" in response
        assert response["data"]["status"] == "scheduled"

    def test_returns_task_id_and_workflow_run_id(self, mocker):
        mocker.patch("services.app_generate_service.workflow_based_app_execution_task.delay")

        response, _ = AppGenerateService.generate_async(
            app_model=_make_app(),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
        )

        assert response["task_id"] == response["workflow_run_id"]
        assert "id" in response["data"]
        assert "workflow_id" in response["data"]
        assert "created_at" in response["data"]

    def test_idempotency_returns_cached_response(self, mocker):
        cached = {"task_id": "old-id", "workflow_run_id": "old-id", "data": {"status": "scheduled"}}
        mocker.patch.object(AppGenerateService, "_try_acquire_idempotency_key", return_value=cached)
        delay_spy = mocker.patch("services.app_generate_service.workflow_based_app_execution_task.delay")

        response, is_duplicate = AppGenerateService.generate_async(
            app_model=_make_app(),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            idempotency_key="test-key",
        )

        assert is_duplicate is True
        assert response == cached
        delay_spy.assert_not_called()

    def test_idempotency_key_finalized_after_dispatch(self, mocker):
        mocker.patch("services.app_generate_service.workflow_based_app_execution_task.delay")
        mocker.patch.object(AppGenerateService, "_try_acquire_idempotency_key", return_value=None)
        finalize_spy = mocker.patch.object(AppGenerateService, "_finalize_idempotency_key")

        AppGenerateService.generate_async(
            app_model=_make_app(),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            idempotency_key="new-key",
        )

        finalize_spy.assert_called_once()
        assert finalize_spy.call_args.kwargs["idempotency_key"] == "new-key"

    def test_no_idempotency_key_skips_acquire_and_finalize(self, mocker):
        mocker.patch("services.app_generate_service.workflow_based_app_execution_task.delay")
        acquire_spy = mocker.patch.object(AppGenerateService, "_try_acquire_idempotency_key")
        finalize_spy = mocker.patch.object(AppGenerateService, "_finalize_idempotency_key")

        AppGenerateService.generate_async(
            app_model=_make_app(),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            idempotency_key=None,
        )

        acquire_spy.assert_not_called()
        finalize_spy.assert_not_called()

    def test_dispatch_failure_marks_run_failed(self, mocker):
        mocker.patch(
            "services.app_generate_service.workflow_based_app_execution_task.delay",
            side_effect=RuntimeError("Redis down"),
        )
        fail_spy = mocker.patch.object(AppGenerateService, "_mark_workflow_run_failed")

        with pytest.raises(RuntimeError, match="Redis down"):
            AppGenerateService.generate_async(
                app_model=_make_app(),
                user=_make_user(),
                args={"inputs": {}},
                invoke_from=InvokeFrom.SERVICE_API,
            )

        fail_spy.assert_called_once()
        assert "Failed to dispatch task" in fail_spy.call_args[0][1]

    def test_concurrency_limit_checked(self, mocker):
        mocker.patch("services.app_generate_service.workflow_based_app_execution_task.delay")
        concurrency_spy = mocker.patch.object(AppGenerateService, "_check_async_concurrency_limit")

        AppGenerateService.generate_async(
            app_model=_make_app(),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
        )

        concurrency_spy.assert_called_once_with(tenant_id="tenant-id")


# ---------------------------------------------------------------------------
# _try_acquire_idempotency_key / _finalize_idempotency_key
# ---------------------------------------------------------------------------
class TestIdempotencyKey:
    def test_acquire_succeeds_when_key_not_exists(self):
        with patch.object(ags_module.redis_client, "set", return_value=True):
            result = AppGenerateService._try_acquire_idempotency_key("tenant-1", "key-1")
        assert result is None  # None means "acquired, proceed"

    def test_acquire_returns_cached_response_when_key_exists(self):
        cached = {"task_id": "abc", "workflow_run_id": "abc"}
        with (
            patch.object(ags_module.redis_client, "set", return_value=False),
            patch.object(ags_module.redis_client, "get", return_value=json.dumps(cached).encode()),
        ):
            result = AppGenerateService._try_acquire_idempotency_key("tenant-1", "key-1")
        assert result == cached

    def test_acquire_retries_while_pending_then_returns_response(self, mocker):
        cached = {"task_id": "abc", "workflow_run_id": "abc"}
        mocker.patch("time.sleep")  # skip actual sleep
        with (
            patch.object(ags_module.redis_client, "set", return_value=False),
            patch.object(
                ags_module.redis_client,
                "get",
                side_effect=[b"pending", b"pending", json.dumps(cached).encode()],
            ),
        ):
            result = AppGenerateService._try_acquire_idempotency_key("tenant-1", "key-1")
        assert result == cached

    def test_acquire_cleans_stale_lock_when_winner_never_finalizes(self, mocker):
        mocker.patch("time.sleep")
        with (
            patch.object(ags_module.redis_client, "set", return_value=False),
            patch.object(ags_module.redis_client, "get", return_value=b"pending"),
            patch.object(ags_module.redis_client, "delete") as delete_spy,
        ):
            result = AppGenerateService._try_acquire_idempotency_key("tenant-1", "key-1")
        assert result is None  # Caller can retry
        delete_spy.assert_called_once()

    def test_key_too_long_raises(self):
        with pytest.raises(ValueError, match="64 characters"):
            AppGenerateService._try_acquire_idempotency_key("tenant-1", "x" * 65)

    def test_finalize_stores_response_with_ttl(self):
        response = {"task_id": "abc"}
        with patch.object(ags_module.redis_client, "set") as set_spy:
            AppGenerateService._finalize_idempotency_key("tenant-1", "key-1", response)

        set_spy.assert_called_once()
        args, kwargs = set_spy.call_args
        assert args[0] == "dify:async_workflow:idempotency:tenant-1:key-1"
        assert json.loads(args[1]) == response
        assert kwargs["ex"] == 86400


# ---------------------------------------------------------------------------
# _check_async_concurrency_limit
# ---------------------------------------------------------------------------
class TestConcurrencyLimit:
    def test_under_limit_passes(self, monkeypatch):
        monkeypatch.setattr(ags_module.dify_config, "ASYNC_WORKFLOW_MAX_CONCURRENT", 50)
        with patch.object(ags_module.db.session, "query") as query_mock:
            query_mock.return_value.filter.return_value.scalar.return_value = 5
            # Should not raise
            AppGenerateService._check_async_concurrency_limit("tenant-1")

    def test_at_limit_raises_429(self, monkeypatch):
        from werkzeug.exceptions import TooManyRequests

        monkeypatch.setattr(ags_module.dify_config, "ASYNC_WORKFLOW_MAX_CONCURRENT", 50)
        with patch.object(ags_module.db.session, "query") as query_mock:
            query_mock.return_value.filter.return_value.scalar.return_value = 50
            with pytest.raises(TooManyRequests):
                AppGenerateService._check_async_concurrency_limit("tenant-1")

    def test_unlimited_skips_check(self, monkeypatch):
        monkeypatch.setattr(ags_module.dify_config, "ASYNC_WORKFLOW_MAX_CONCURRENT", 0)
        with patch.object(ags_module.db.session, "query") as query_mock:
            # Should not even hit the DB
            AppGenerateService._check_async_concurrency_limit("tenant-1")
            query_mock.assert_not_called()
