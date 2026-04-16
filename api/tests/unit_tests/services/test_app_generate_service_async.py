"""
Unit tests for AppGenerateService.generate_async and related async workflow helpers.

Covers:
  - generate_async          (happy path, Celery dispatch, idempotency dedup, dispatch failure)
  - _check_idempotency_key  (cache hit, cache miss, key too long)
  - _store_idempotency_key  (stores in Redis with TTL)
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
        mocker.patch.object(AppGenerateService, "_check_idempotency_key", return_value=cached)
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

    def test_idempotency_key_stored_after_dispatch(self, mocker):
        mocker.patch("services.app_generate_service.workflow_based_app_execution_task.delay")
        mocker.patch.object(AppGenerateService, "_check_idempotency_key", return_value=None)
        store_spy = mocker.patch.object(AppGenerateService, "_store_idempotency_key")

        AppGenerateService.generate_async(
            app_model=_make_app(),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            idempotency_key="new-key",
        )

        store_spy.assert_called_once()
        call_kwargs = store_spy.call_args
        assert call_kwargs[1]["idempotency_key"] == "new-key" or call_kwargs[0][1] == "new-key"

    def test_no_idempotency_key_skips_check_and_store(self, mocker):
        mocker.patch("services.app_generate_service.workflow_based_app_execution_task.delay")
        check_spy = mocker.patch.object(AppGenerateService, "_check_idempotency_key")
        store_spy = mocker.patch.object(AppGenerateService, "_store_idempotency_key")

        AppGenerateService.generate_async(
            app_model=_make_app(),
            user=_make_user(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API,
            idempotency_key=None,
        )

        check_spy.assert_not_called()
        store_spy.assert_not_called()

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
# _check_idempotency_key / _store_idempotency_key
# ---------------------------------------------------------------------------
class TestIdempotencyKey:
    def test_cache_miss_returns_none(self):
        with patch.object(ags_module.redis_client, "get", return_value=None):
            result = AppGenerateService._check_idempotency_key("tenant-1", "key-1")
        assert result is None

    def test_cache_hit_returns_parsed_response(self):
        cached = {"task_id": "abc", "workflow_run_id": "abc"}
        with patch.object(ags_module.redis_client, "get", return_value=json.dumps(cached).encode()):
            result = AppGenerateService._check_idempotency_key("tenant-1", "key-1")
        assert result == cached

    def test_key_too_long_raises(self):
        with pytest.raises(ValueError, match="64 characters"):
            AppGenerateService._check_idempotency_key("tenant-1", "x" * 65)

    def test_store_calls_setex_with_correct_key_and_ttl(self):
        response = {"task_id": "abc"}
        with patch.object(ags_module.redis_client, "setex") as setex_spy:
            AppGenerateService._store_idempotency_key("tenant-1", "key-1", response)

        setex_spy.assert_called_once()
        args = setex_spy.call_args[0]
        assert args[0] == "dify:async_workflow:idempotency:tenant-1:key-1"
        assert args[1] == 86400
        assert json.loads(args[2]) == response


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
