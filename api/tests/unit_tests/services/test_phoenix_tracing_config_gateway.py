"""Persist verified Phoenix configuration while preserving owner policy and masked keys."""

import json
from collections import deque
from dataclasses import dataclass
from uuid import uuid4

import httpx
import pytest
from dify_trace_arize_phoenix.configuration import PhoenixConfigurationError
from sqlalchemy.orm import Session, sessionmaker

from core.ops.ops_trace_manager import OpsTraceManager
from machinery.context import RequestContext
from repositories.app.console_repository import ConsoleAppRepository
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from services.app_tracing_config_gateway import OpsTraceManagerGateway
from services.app_tracing_config_service import (
    AppTracingConfigInvalidConfigurationError,
    AppTracingConfigRecord,
    AppTracingConfigService,
    AppTracingConfigVerificationFailedError,
)
from tests.unit_tests.model_factories import make_app
from tests.unit_tests.services.tracing.test_phoenix_configuration import (
    api_calls as api_calls,  # noqa: PLC0414 - Re-export pytest fixtures only in this module.
)
from tests.unit_tests.services.tracing.test_phoenix_configuration import (
    api_responses as api_responses,  # noqa: PLC0414 - Re-export pytest fixtures only in this module.
)
from tests.unit_tests.services.tracing.test_phoenix_configuration import (
    no_legacy_or_environment_auth as no_legacy_or_environment_auth,  # noqa: PLC0414 - Re-export pytest fixtures.
)
from tests.unit_tests.services.tracing.test_phoenix_configuration import response

pytest_plugins = ("tests.unit_tests.services.tracing.test_nullable_tracing_credentials",)


@dataclass
class PhoenixCase:
    gateway: OpsTraceManagerGateway
    service: AppTracingConfigService
    store: SQLAlchemyAppTracingConfigRepository
    reader: ConsoleAppRepository
    context: RequestContext
    app_id: str

    def read(self, provider: str = "phoenix") -> AppTracingConfigRecord | None:
        return self.store.get(
            workspace_id=self.context.active_workspace_id, app_id=self.app_id, tracing_provider=provider
        )


@pytest.fixture
def case(workspace: str, sqlite_session_factory: sessionmaker[Session]) -> PhoenixCase:
    app_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(
            make_app(
                app_id=app_id,
                tenant_id=workspace,
                tracing=json.dumps(
                    {
                        "enabled": True,
                        "tracing_provider": "langsmith",
                        "capture_content": True,
                        "capture_agent": False,
                    }
                ),
            )
        )
    gateway = OpsTraceManagerGateway()
    store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    old = OpsTraceManager.encrypt_tracing_config(
        workspace, "langsmith", {"api_key": "synthetic-other-key", "project": "other", "endpoint": "https://other.test"}
    )
    assert store.create(workspace_id=workspace, app_id=app_id, tracing_provider="langsmith", tracing_config=old)
    return PhoenixCase(
        gateway,
        AppTracingConfigService(configs=store, provider=gateway),
        store,
        ConsoleAppRepository(session_factory=sqlite_session_factory),
        RequestContext("request", None, "account", workspace),
        app_id,
    )


def test_post_masked_patch_get_keep_normalized_destination_and_ciphertext(
    case: PhoenixCase,
    api_calls: list[tuple[str, dict[str, object]]],
) -> None:
    other = case.read("langsmith")
    submitted = {
        "endpoint": " HTTP://FIRST.Example:6006/reverse/ ",
        "project": " first project ",
        "api_key": "synthetic-secret",
    }
    untouched = dict(submitted)
    case.service.create(case.context, case.app_id, "phoenix", submitted, activate=True)
    before = case.read()
    assert before is not None
    assert before.tracing_config is not None
    stored = before.tracing_config
    assert stored["endpoint"] == "http://first.example:6006/reverse"
    assert stored["project"] == "first project"
    assert stored["api_key"] != "synthetic-secret"
    assert submitted == untouched
    assert OpsTraceManager.decrypt_tracing_config(case.context.active_workspace_id, "phoenix", stored)["api_key"] == (
        "synthetic-secret"
    )
    shown = case.service.get(case.context, case.app_id, "phoenix")
    assert shown is not None
    assert shown.tracing_config is not None
    masked = shown.tracing_config["api_key"]
    assert isinstance(masked, str)
    assert "*" in masked
    assert masked != "synthetic-secret"
    assert shown.tracing_config["project_url"] == "http://first.example:6006/reverse/redirects/projects/first%20project"
    assert len(api_calls) == 1
    case.service.update(
        case.context,
        case.app_id,
        "phoenix",
        {
            "endpoint": " https://SECOND.test/s/space/ ",
            "project": " second & 项目 ",
            "api_key": masked,
        },
    )
    after = case.read()
    assert after is not None
    assert after.tracing_config is not None
    assert after.tracing_config["api_key"] == stored["api_key"]
    assert after.tracing_config["endpoint"] == "https://second.test/s/space"
    assert after.tracing_config["project"] == "second & 项目"
    assert after.tracing_config["project_url"] == (
        "https://second.test/s/space/redirects/projects/second%20%26%20%E9%A1%B9%E7%9B%AE"
    )
    assert api_calls[-1][0] == "https://second.test/s/space/v1/projects"
    headers = api_calls[-1][1]["headers"]
    assert isinstance(headers, dict)
    assert headers["Authorization"] == "Bearer synthetic-secret"
    case.gateway.validate_saved_config(
        workspace_id=case.context.active_workspace_id, tracing_provider="phoenix", tracing_config=after.tracing_config
    )
    assert case.service.get(case.context, case.app_id, "phoenix") is not None
    assert len(api_calls) == 2
    assert case.read("langsmith") == other
    policy = case.reader.get_trace(case.context, case.app_id)
    assert policy.enabled
    assert policy.tracing_provider == "phoenix"
    assert policy.capture_content is True
    assert policy.capture_agent is False


@pytest.mark.parametrize("empty", [None, ""])
def test_bearer_to_keyless_and_back_is_explicit(
    case: PhoenixCase,
    api_calls: list[tuple[str, dict[str, object]]],
    empty: str | None,
) -> None:
    destination = {"endpoint": "https://host.test", "project": "project"}
    case.service.create(case.context, case.app_id, "phoenix", {**destination, "api_key": "first-key"})
    case.service.update(case.context, case.app_id, "phoenix", {**destination, "api_key": empty})
    assert api_calls[-1][1]["headers"] == {"Accept": "application/json", "Accept-Encoding": "identity", "Cookie": ""}
    stored = case.read()
    assert stored is not None
    assert stored.tracing_config is not None
    assert (
        OpsTraceManager.decrypt_tracing_config(case.context.active_workspace_id, "phoenix", stored.tracing_config)[
            "api_key"
        ]
        == empty
    )
    case.service.update(case.context, case.app_id, "phoenix", {**destination, "api_key": "second-key"})
    assert api_calls[-1][1]["headers"] != api_calls[0][1]["headers"]
    assert len(api_calls) == 3


@pytest.mark.parametrize("failure", ["denied", "wrong-path-html"])
def test_failed_patch_preserves_policy_config_and_other_provider(
    case: PhoenixCase,
    api_calls: list[tuple[str, dict[str, object]]],
    api_responses: deque[httpx.Response | Exception],
    caplog: pytest.LogCaptureFixture,
    failure: str,
) -> None:
    original = {"endpoint": "https://host.test", "project": "project", "api_key": "private-secret"}
    case.service.create(case.context, case.app_id, "phoenix", original)
    before, other, policy = case.read(), case.read("langsmith"), case.reader.get_trace(case.context, case.app_id)
    if failure == "denied":
        api_responses.append(response({"secret": "private-vendor-response"}, 403))
    else:
        api_responses.append(
            httpx.Response(
                200,
                text="<html>private-vendor-response</html>",
                request=httpx.Request("GET", "https://host.test/not-a-collector/v1/projects"),
            )
        )
    with pytest.raises(AppTracingConfigVerificationFailedError) as caught:
        case.service.update(
            case.context,
            case.app_id,
            "phoenix",
            {
                **original,
                "endpoint": "https://host.test/not-a-collector",
                "api_key": "******",
            },
            activate=True,
        )
    assert isinstance(caught.value.__cause__, PhoenixConfigurationError)
    assert caught.value.__cause__.code == ("permission_denied" if failure == "denied" else "malformed_response")
    assert case.read() == before
    assert case.read("langsmith") == other
    assert case.reader.get_trace(case.context, case.app_id) == policy
    assert "private-vendor-response" not in caplog.text
    assert "private-secret" not in caplog.text
    assert len(api_calls) == 2


@pytest.mark.parametrize("saved_url", [None, "https://stale.test/wrong-project"])
def test_historical_get_calculates_url_without_verification_or_sdk(
    case: PhoenixCase,
    api_calls: list[tuple[str, dict[str, object]]],
    saved_url: str | None,
) -> None:
    stored = OpsTraceManager.encrypt_tracing_config(
        case.context.active_workspace_id,
        "phoenix",
        {
            "endpoint": "https://host.test/s/space/",
            "project": "historical project",
            "api_key": None,
        },
    )
    if saved_url:
        stored["project_url"] = saved_url
    shown = case.gateway.present_config(
        workspace_id=case.context.active_workspace_id, tracing_provider="phoenix", tracing_config=stored
    )
    assert shown["project_url"] == "https://host.test/s/space/redirects/projects/historical%20project"
    assert shown["api_key"] is None
    case.gateway.validate_saved_config(
        workspace_id=case.context.active_workspace_id, tracing_provider="phoenix", tracing_config=stored
    )
    assert api_calls == []


@pytest.mark.parametrize("endpoint", ["https://user:private@host.test?token=private", "https://host.test/v1/traces"])
def test_unsafe_historical_destination_is_readable_without_link_or_io(
    case: PhoenixCase,
    api_calls: list[tuple[str, dict[str, object]]],
    endpoint: str,
) -> None:
    stored = OpsTraceManager.encrypt_tracing_config(
        case.context.active_workspace_id,
        "phoenix",
        {
            "endpoint": endpoint,
            "project": "old-project",
            "api_key": None,
        },
    )
    shown = case.gateway.present_config(
        workspace_id=case.context.active_workspace_id, tracing_provider="phoenix", tracing_config=stored
    )
    assert shown["endpoint"] == endpoint
    assert shown["project_url"] is None
    assert api_calls == []


@pytest.mark.parametrize("values", [{"endpoint": "https://host.test/v1/traces"}, {"project": "bad\nproject"}])
def test_invalid_new_destination_has_no_io_or_storage_effect(
    case: PhoenixCase,
    api_calls: list[tuple[str, dict[str, object]]],
    values: dict[str, str],
) -> None:
    policy = case.reader.get_trace(case.context, case.app_id)
    with pytest.raises(AppTracingConfigInvalidConfigurationError):
        case.service.create(case.context, case.app_id, "phoenix", {"api_key": "synthetic-key", **values}, activate=True)
    assert case.read() is None
    assert case.reader.get_trace(case.context, case.app_id) == policy
    assert api_calls == []
