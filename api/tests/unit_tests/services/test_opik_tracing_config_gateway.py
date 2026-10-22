"""Opik configuration transactions use real RSA and never initialize an SDK streamer."""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Never
from uuid import uuid4

import httpx
import opik
import pytest
from dify_trace_opik.configuration import OpikConfigurationError
from dify_trace_opik.opik_trace import OpikDataTrace
from opik.config import OpikConfig as SDKOpikConfig
from sqlalchemy.orm import Session, sessionmaker

from core.helper import ssrf_proxy
from core.ops.ops_trace_manager import OpsTraceManager
from machinery.context import RequestContext
from models.model import App
from repositories.app.console_repository import ConsoleAppRepository
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from services.app_tracing_config_gateway import OpsTraceManagerGateway
from services.app_tracing_config_service import AppTracingConfigService, AppTracingConfigVerificationFailedError
from tests.unit_tests.model_factories import make_app
from tests.unit_tests.services.tracing.test_opik_configuration import AccessAPI

pytest_plugins = ("tests.unit_tests.services.tracing.test_nullable_tracing_credentials",)


@dataclass
class ConfigurationCase:
    api: AccessAPI
    gateway: OpsTraceManagerGateway
    service: AppTracingConfigService
    store: SQLAlchemyAppTracingConfigRepository
    reader: ConsoleAppRepository
    context: RequestContext
    app_id: str
    sessions: sessionmaker[Session]


@pytest.fixture
def case(
    workspace: str, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> Iterator[ConfigurationCase]:
    app_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(make_app(app_id=app_id, tenant_id=workspace))
    api = AccessAPI()
    gateway = OpsTraceManagerGateway()
    store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    forbidden_calls: list[str] = []

    def forbidden(*_args: object, **_kwargs: object) -> Never:
        forbidden_calls.append("sdk_constructor")
        raise AssertionError("Configuration must not initialize an SDK client or ambient configuration")

    monkeypatch.setattr(ssrf_proxy, "make_request", api.request)
    monkeypatch.setattr(OpikDataTrace, "__init__", forbidden)
    monkeypatch.setattr(opik.Opik, "__init__", forbidden)
    monkeypatch.setattr(SDKOpikConfig, "__init__", forbidden)
    yield ConfigurationCase(
        api,
        gateway,
        AppTracingConfigService(configs=store, provider=gateway),
        store,
        ConsoleAppRepository(session_factory=sqlite_session_factory),
        RequestContext("request", None, "account", workspace),
        app_id,
        sqlite_session_factory,
    )
    assert forbidden_calls == []


def test_post_get_patch_preserve_real_ciphertext_and_verified_destination(case: ConfigurationCase) -> None:
    secret = "synthetic-private-opik-key"
    case.service.create(
        case.context,
        case.app_id,
        "opik",
        {"api_key": secret, "workspace": "", "project": " first ", "url": "https://first.test/prefix/api/"},
        activate=True,
    )
    before = case.store.get(workspace_id=case.context.active_workspace_id, app_id=case.app_id, tracing_provider="opik")
    assert before is not None
    assert before.tracing_config is not None
    config = before.tracing_config
    assert config["api_key"] != secret
    assert config["workspace"] == "resolved-team"
    assert config["project"] == "first"
    assert config["project_url"] == "https://first.test/prefix/resolved-team/redirect/projects?name=first"
    assert OpsTraceManager.decrypt_tracing_config(case.context.active_workspace_id, "opik", config)["api_key"] == secret
    assert case.reader.get_trace(case.context, case.app_id).tracing_provider == "opik"

    before_get = len(case.api.calls)
    presented = case.service.get(case.context, case.app_id, "opik")
    assert presented is not None
    assert presented.tracing_config is not None
    masked = presented.tracing_config["api_key"]
    assert masked != secret
    assert "*" in masked
    assert len(case.api.calls) == before_get
    case.api.default_workspace = "new-team"
    case.service.update(
        case.context,
        case.app_id,
        "opik",
        {"api_key": masked, "workspace": "default", "project": "A & B", "url": "https://second.test/api/"},
    )
    after = case.store.get(workspace_id=case.context.active_workspace_id, app_id=case.app_id, tracing_provider="opik")
    assert after is not None
    assert after.tracing_config is not None
    assert after.tracing_config["api_key"] == config["api_key"]
    assert after.tracing_config["workspace"] == "new-team"
    assert after.tracing_config["project"] == "A & B"
    assert after.tracing_config["url"] == "https://second.test/api/"
    assert after.tracing_config["project_url"] == "https://second.test/new-team/redirect/projects?name=A+%26+B"
    assert case.api.calls[-1][2]["headers"] == {
        "Authorization": secret,
        "Comet-Workspace": "default",
        "Accept": "application/json",
    }
    before_get = len(case.api.calls)
    presented = case.service.get(case.context, case.app_id, "opik")
    assert presented is not None
    assert presented.tracing_config is not None
    assert presented.tracing_config["project_url"] == after.tracing_config["project_url"]
    case.gateway.validate_saved_config(
        workspace_id=case.context.active_workspace_id, tracing_provider="opik", tracing_config=after.tracing_config
    )
    assert len(case.api.calls) == before_get


@pytest.mark.parametrize("saved_url", [None, "https://wrong-global.test/old-project"])
@pytest.mark.parametrize("workspace_name", ["team", "default", None])
def test_historical_get_uses_only_configuration_host_without_network(
    case: ConfigurationCase, saved_url: str | None, workspace_name: str | None
) -> None:
    stored = OpsTraceManager.encrypt_tracing_config(
        case.context.active_workspace_id,
        "opik",
        {
            "api_key": "synthetic-key",
            "workspace": workspace_name,
            "project": "A & B",
            "url": "https://private.test/opik/api/",
        },
    )
    if saved_url:
        stored["project_url"] = saved_url
    result = case.gateway.present_config(
        workspace_id=case.context.active_workspace_id, tracing_provider="opik", tracing_config=stored
    )
    expected = (
        "https://private.test/opik/team/redirect/projects?name=A+%26+B"
        if workspace_name == "team"
        else "https://private.test/opik/"
    )
    assert result["project_url"] == expected
    assert result["api_key"] != "synthetic-key"
    assert case.api.calls == []


@pytest.mark.parametrize("status", [401, 403])
@pytest.mark.parametrize("existing", [False, True])
def test_bad_key_or_workspace_does_not_save_or_change_active_provider(
    case: ConfigurationCase, status: int, existing: bool, caplog: pytest.LogCaptureFixture
) -> None:
    original = {"api_key": "synthetic-private-key", "workspace": "team", "project": "original"}
    if existing:
        case.service.create(case.context, case.app_id, "opik", original)
    with case.sessions.begin() as session:
        app = session.get(App, case.app_id)
        assert app is not None
        app.tracing = json.dumps({"enabled": True, "tracing_provider": "langsmith", "capture_content": False})
    before_policy = case.reader.get_trace(case.context, case.app_id)
    before = case.store.get(workspace_id=case.context.active_workspace_id, app_id=case.app_id, tracing_provider="opik")
    case.api.override = lambda method, url, _options: httpx.Response(
        status, text="private-vendor-details", request=httpx.Request(method, url)
    )
    operation = case.service.update if existing else case.service.create
    with pytest.raises(AppTracingConfigVerificationFailedError) as error:
        operation(case.context, case.app_id, "opik", {**original, "workspace": "inaccessible"}, activate=True)
    assert isinstance(error.value.__cause__, OpikConfigurationError)
    assert error.value.__cause__.code == ("authentication_failed" if status == 401 else "permission_denied")
    after = case.store.get(workspace_id=case.context.active_workspace_id, app_id=case.app_id, tracing_provider="opik")
    assert after == before
    assert case.reader.get_trace(case.context, case.app_id) == before_policy
    assert "private-vendor-details" not in caplog.text
    assert "synthetic-private-key" not in caplog.text


def test_clear_optional_api_key_keeps_keyless_self_host_valid(
    case: ConfigurationCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = {"url": "http://local.test:5173/api/", "workspace": "team", "project": "sample"}
    case.service.create(case.context, case.app_id, "opik", {**target, "api_key": "synthetic-key"})
    monkeypatch.setenv("OPIK_API_KEY", "unrelated-key")
    case.api.calls.clear()
    case.service.update(case.context, case.app_id, "opik", {**target, "api_key": None})
    stored = case.store.get(workspace_id=case.context.active_workspace_id, app_id=case.app_id, tracing_provider="opik")
    assert stored is not None
    assert stored.tracing_config is not None
    assert stored.tracing_config["api_key"] is None
    presented = case.service.get(case.context, case.app_id, "opik")
    assert presented is not None
    assert presented.tracing_config is not None
    assert presented.tracing_config["api_key"] is None
    assert case.api.calls[0][2]["headers"] == {"Comet-Workspace": "team", "Accept": "application/json"}
    assert len(case.api.calls) == 1
