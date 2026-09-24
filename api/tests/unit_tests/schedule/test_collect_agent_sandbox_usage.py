"""The scheduled collector reuses existing Celery workers and bounded HTTP."""

from collections.abc import Iterator
from datetime import timedelta
from unittest.mock import MagicMock

import httpx
import pytest
from celery.contrib.testing.app import setup_default_app

from configs.extra.agent_backend_config import AgentBackendConfig
from dify_app import DifyApp
from extensions import ext_celery
from schedule.collect_agent_sandbox_usage import collect_agent_sandbox_usage
from tests.unit_tests.config_override import config_overrides_context

PROJECT = "431de237-596f-4d59-8a85-20a9846bf243"


@pytest.fixture(autouse=True)
def restore_celery_app_state() -> Iterator[None]:
    # init_app changes Celery's process-wide current/default app; close() alone
    # leaves later shared tasks pointing at the now-unregistered test app.
    with setup_default_app(collect_agent_sandbox_usage.app):
        yield


@pytest.fixture(autouse=True)
def configured_collection() -> Iterator[None]:
    with config_overrides_context(
        AGENT_SANDBOX_METERING_ENABLED=True,
        AGENT_SANDBOX_METERING_PROJECT_ID=PROJECT,
        AGENT_BACKEND_BASE_URL="http://agent_backend:5001/",
        AGENT_BACKEND_API_TOKEN="backend-token",
    ):
        yield


def response(payload: object, status: int = 200) -> httpx.Response:
    return httpx.Response(
        status, json=payload, request=httpx.Request("POST", "http://agent_backend:5001/internal/e2b/usage/collect")
    )


def test_task_uses_existing_queue_deadlines_and_single_authenticated_call(monkeypatch: pytest.MonkeyPatch) -> None:
    post = MagicMock(return_value=response({"completed": True}))
    monkeypatch.setattr("schedule.collect_agent_sandbox_usage.ssrf_proxy.post", post)
    assert collect_agent_sandbox_usage() is True
    post.assert_called_once_with(
        "http://agent_backend:5001/internal/e2b/usage/collect",
        headers={"Authorization": "Bearer backend-token"},
        json={"project_id": PROJECT},
        max_retries=0,
        timeout=260,
    )
    dispatch = MagicMock()
    monkeypatch.setattr(collect_agent_sandbox_usage.app, "send_task", dispatch)
    collect_agent_sandbox_usage.apply_async()
    assert dispatch.call_args.kwargs["queue"] == "ops_trace"
    assert collect_agent_sandbox_usage.soft_time_limit == 270
    assert collect_agent_sandbox_usage.time_limit == 300


def test_disabled_job_makes_no_http_request(monkeypatch: pytest.MonkeyPatch) -> None:
    post = MagicMock()
    monkeypatch.setattr("schedule.collect_agent_sandbox_usage.ssrf_proxy.post", post)
    with config_overrides_context(AGENT_SANDBOX_METERING_ENABLED=False):
        assert collect_agent_sandbox_usage() is False
    post.assert_not_called()


@pytest.mark.parametrize(
    "missing", ["AGENT_BACKEND_BASE_URL", "AGENT_BACKEND_API_TOKEN", "AGENT_SANDBOX_METERING_PROJECT_ID"]
)
def test_incomplete_configuration_only_fails_collection_job(missing: str, monkeypatch: pytest.MonkeyPatch) -> None:
    post = MagicMock()
    monkeypatch.setattr("schedule.collect_agent_sandbox_usage.ssrf_proxy.post", post)
    with config_overrides_context(**{missing: ""}):
        with pytest.raises(ValueError, match="requires backend URL, token, and project"):
            collect_agent_sandbox_usage()
    post.assert_not_called()


@pytest.mark.parametrize("payload", [{"completed": False}, {"completed": "true"}, {"unexpected": True}])
def test_incomplete_or_invalid_scan_is_a_job_failure_without_retry(
    payload: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    post = MagicMock(return_value=response(payload))
    monkeypatch.setattr("schedule.collect_agent_sandbox_usage.ssrf_proxy.post", post)
    with pytest.raises((ValueError, RuntimeError)):
        collect_agent_sandbox_usage()
    assert post.call_count == 1


@pytest.mark.parametrize("status", [403, 503, 504])
def test_backend_failure_does_not_trigger_http_retry(status: int, monkeypatch: pytest.MonkeyPatch) -> None:
    post = MagicMock(return_value=response({"detail": "unavailable"}, status))
    monkeypatch.setattr("schedule.collect_agent_sandbox_usage.ssrf_proxy.post", post)
    with pytest.raises(httpx.HTTPStatusError):
        collect_agent_sandbox_usage()
    assert post.call_count == 1


def test_transport_failure_is_logged_without_credentials_or_raw_message(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    post = MagicMock(side_effect=httpx.ReadTimeout("do-not-log-secret"))
    monkeypatch.setattr("schedule.collect_agent_sandbox_usage.ssrf_proxy.post", post)
    with pytest.raises(httpx.ReadTimeout):
        collect_agent_sandbox_usage()
    assert post.call_count == 1
    assert "Background sandbox usage collection failed" in caplog.text
    assert "do-not-log-secret" not in caplog.text
    assert "backend-token" not in caplog.text


@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("interval", [90, "90"])
def test_beat_registers_only_enabled_collection_with_expiring_schedule(
    enabled: bool, interval: int | str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ext_celery, "setup_workflow_warm_shutdown_handler", lambda: None)
    with config_overrides_context(
        AGENT_SANDBOX_METERING_ENABLED=enabled,
        AGENT_SANDBOX_METERING_INTERVAL_SECONDS=interval,
        DISABLE_TELEMETRY=True,
    ):
        celery = ext_celery.init_app(DifyApp(__name__))
        try:
            assert "schedule.collect_agent_sandbox_usage" in celery.conf.imports
            schedule = celery.conf.beat_schedule.get("collect_agent_sandbox_usage")
            if enabled:
                assert schedule == {
                    "task": "schedule.collect_agent_sandbox_usage.collect_agent_sandbox_usage",
                    "schedule": timedelta(seconds=90),
                    "options": {"expires": 90},
                }
            else:
                assert schedule is None
        finally:
            celery.close()


@pytest.mark.parametrize("raw_interval", ["0", "-1", "not-a-number", "1.5", "9" * 30])
def test_invalid_interval_env_only_disables_optional_schedule(
    raw_interval: str, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("AGENT_SANDBOX_METERING_INTERVAL_SECONDS", raw_interval)
    config = AgentBackendConfig()
    assert raw_interval == config.AGENT_SANDBOX_METERING_INTERVAL_SECONDS
    monkeypatch.setattr(ext_celery, "setup_workflow_warm_shutdown_handler", lambda: None)
    with config_overrides_context(
        AGENT_SANDBOX_METERING_INTERVAL_SECONDS=config.AGENT_SANDBOX_METERING_INTERVAL_SECONDS,
        ENABLE_CONVERSATION_CLEANUP_TASK=True,
        CONVERSATION_CLEANUP_TASK_INTERVAL=2,
        DISABLE_TELEMETRY=True,
    ):
        app = DifyApp(__name__)
        celery = ext_celery.init_app(app)
        try:
            assert app.extensions["celery"] is celery
            assert "collect_agent_sandbox_usage" not in celery.conf.beat_schedule
            assert "schedule.collect_agent_sandbox_usage" in celery.conf.imports
            assert celery.conf.beat_schedule["conversation_cleanup_sweeper"] == {
                "task": "tasks.delete_conversation_task.sweep_deleted_conversations",
                "schedule": timedelta(minutes=2),
            }
        finally:
            celery.close()
    assert "Skipping sandbox usage schedule" in caplog.text
    assert all(raw_interval not in record.getMessage() for record in caplog.records)


def test_manual_collection_does_not_depend_on_beat_interval(monkeypatch: pytest.MonkeyPatch) -> None:
    post = MagicMock(return_value=response({"completed": True}))
    monkeypatch.setattr("schedule.collect_agent_sandbox_usage.ssrf_proxy.post", post)
    with config_overrides_context(AGENT_SANDBOX_METERING_INTERVAL_SECONDS="invalid"):
        assert collect_agent_sandbox_usage() is True
    post.assert_called_once()
