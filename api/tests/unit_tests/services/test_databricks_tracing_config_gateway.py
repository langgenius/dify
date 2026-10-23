"""Databricks config persistence must not initialize a process-global MLflow client."""

from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from typing import Never
from uuid import uuid4

import mlflow
import pytest
from dify_trace_mlflow.configuration import DatabricksConfigurationError
from dify_trace_mlflow.mlflow_trace import MLflowDataTrace
from sqlalchemy.orm import Session, sessionmaker

from core.helper import ssrf_proxy
from core.ops import ops_trace_manager
from core.ops.ops_trace_manager import OpsTraceManager
from machinery.context import RequestContext
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from services.app_tracing_config_gateway import OpsTraceManagerGateway
from services.app_tracing_config_service import AppTracingConfigService, AppTracingConfigVerificationFailedError
from tests.unit_tests.model_factories import make_app
from tests.unit_tests.services.tracing.test_databricks_configuration import ExperimentAPI, response


@dataclass
class GatewayEnvironment:
    gateway: OpsTraceManagerGateway = field(default_factory=OpsTraceManagerGateway)
    api: ExperimentAPI = field(default_factory=ExperimentAPI)
    forbidden_calls: list[str] = field(default_factory=list)


@pytest.fixture
def environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[GatewayEnvironment]:
    environment = GatewayEnvironment()

    def encrypt(_tenant: str, value: str) -> str:
        return "test-cipher:" + value

    def decrypt(_tenant: str, values: Sequence[str]) -> list[str]:
        assert all(value.startswith("test-cipher:") for value in values)
        return [value.removeprefix("test-cipher:") for value in values]

    def forbidden(name: str) -> Callable[..., Never]:
        def block(*_args: object, **_kwargs: object) -> Never:
            environment.forbidden_calls.append(name)
            raise AssertionError("Configuration must not initialize a stateful exporter")

        return block

    monkeypatch.setattr(ops_trace_manager, "encrypt_token", encrypt)
    monkeypatch.setattr(ops_trace_manager, "batch_decrypt_token", decrypt)
    monkeypatch.setattr(ops_trace_manager, "obfuscated_token", lambda value: "******" if value else value)
    monkeypatch.setattr(ssrf_proxy, "get", environment.api.get)
    monkeypatch.setattr(ssrf_proxy, "post", environment.api.post)
    monkeypatch.setattr(MLflowDataTrace, "__init__", forbidden("legacy_constructor"))
    monkeypatch.setattr(mlflow, "set_tracking_uri", forbidden("tracking_uri"))
    monkeypatch.setattr(mlflow, "set_experiment", forbidden("experiment"))
    monkeypatch.setattr(mlflow, "search_experiments", forbidden("search"))
    monkeypatch.setattr(mlflow.config, "enable_async_logging", forbidden("async_logging"))
    yield environment
    assert environment.forbidden_calls == []


@pytest.mark.parametrize("oauth", [False, True])
def test_create_and_patch_persist_verified_target_without_replacing_masked_credentials(
    environment: GatewayEnvironment, sqlite_session_factory: sessionmaker[Session], oauth: bool
) -> None:
    workspace, app_id = str(uuid4()), str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(make_app(app_id=app_id, tenant_id=workspace))
    store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    service = AppTracingConfigService(configs=store, provider=environment.gateway)
    context = RequestContext("request", None, "account", workspace)
    credentials = (
        {"client_id": "synthetic-client", "client_secret": "synthetic-secret"}
        if oauth
        else {"personal_access_token": "synthetic-pat"}
    )
    secret_field = "client_secret" if oauth else "personal_access_token"
    service.create(
        context, app_id, "databricks", {"host": " https://first.test/ ", "experiment_id": "00012", **credentials}
    )
    before = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="databricks")
    assert before is not None
    assert before.tracing_config is not None
    assert before.tracing_config["host"] == "https://first.test"
    assert before.tracing_config["experiment_id"] == "12"
    service.update(
        context,
        app_id,
        "databricks",
        {
            "host": " https://second.test/ ",
            "experiment_id": "00034",
            **credentials,
            secret_field: "******",
        },
    )
    after = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="databricks")
    assert after is not None
    assert after.tracing_config is not None
    assert after.tracing_config["host"] == "https://second.test"
    assert after.tracing_config["experiment_id"] == "34"
    assert after.tracing_config[secret_field] == before.tracing_config[secret_field]
    assert after.tracing_config["project_url"] == "https://second.test/ml/experiments/34/traces"
    assert before.tracing_config["project_url"] == "https://first.test/ml/experiments/12/traces"
    before_get = len(environment.api.calls)
    presented = service.get(context, app_id, "databricks")
    assert presented is not None
    assert presented.tracing_config is not None
    assert presented.tracing_config[secret_field] == "******"
    assert presented.tracing_config["project_url"] == after.tracing_config["project_url"]
    environment.gateway.validate_saved_config(
        workspace_id=workspace, tracing_provider="databricks", tracing_config=after.tracing_config
    )
    assert len(environment.api.calls) == before_get


@pytest.mark.parametrize("saved_url", [None, "https://stale.test/old-project"])
def test_get_is_pure_for_historical_and_current_configs(environment: GatewayEnvironment, saved_url: str | None) -> None:
    workspace = str(uuid4())
    encrypted = OpsTraceManager.encrypt_tracing_config(
        workspace,
        "databricks",
        {"host": "https://workspace.test/", "experiment_id": "12", "personal_access_token": "synthetic-pat"},
    )
    if saved_url is not None:
        encrypted["project_url"] = saved_url
    result = environment.gateway.present_config(
        workspace_id=workspace, tracing_provider="databricks", tracing_config=encrypted
    )
    assert result["project_url"] == "https://workspace.test/ml/experiments/12/traces"
    assert result["personal_access_token"] == "******"
    assert environment.api.calls == []


def test_invalid_historical_host_uses_safe_pure_fallback(environment: GatewayEnvironment) -> None:
    workspace = str(uuid4())
    encrypted = OpsTraceManager.encrypt_tracing_config(
        workspace,
        "databricks",
        {
            "host": "https://user:password@workspace.test",
            "experiment_id": "12",
            "personal_access_token": "synthetic-pat",
        },
    )
    result = environment.gateway.present_config(
        workspace_id=workspace, tracing_provider="databricks", tracing_config=encrypted
    )
    assert result["project_url"] == "https://www.databricks.com/"
    assert environment.api.calls == []


def test_failed_patch_keeps_original_destination_and_logs_only_safe_code(
    environment: GatewayEnvironment, sqlite_session_factory: sessionmaker[Session], caplog: pytest.LogCaptureFixture
) -> None:
    workspace, app_id = str(uuid4()), str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(make_app(app_id=app_id, tenant_id=workspace))
    store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    service = AppTracingConfigService(configs=store, provider=environment.gateway)
    context = RequestContext("request", None, "account", workspace)
    original = {
        "host": "https://workspace.test",
        "experiment_id": "12",
        "personal_access_token": "synthetic-private-pat",
    }
    service.create(context, app_id, "databricks", original)
    before = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="databricks")
    assert before is not None
    environment.api.override = lambda _method, url, _options: response(url, {"message": "private-vendor-detail"}, 403)
    with pytest.raises(AppTracingConfigVerificationFailedError) as caught:
        service.update(
            context, app_id, "databricks", {**original, "experiment_id": "34", "personal_access_token": "******"}
        )
    assert isinstance(caught.value.__cause__, DatabricksConfigurationError)
    assert caught.value.__cause__.code == "permission_denied"
    after = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="databricks")
    assert after is not None
    assert after.tracing_config == before.tracing_config
    assert "permission_denied" in caplog.text
    assert "private-vendor-detail" not in caplog.text
    assert "synthetic-private-pat" not in caplog.text


@pytest.mark.parametrize("start_with_oauth", [False, True])
def test_switching_auth_clears_unselected_credentials_in_persistence_and_requests(
    environment: GatewayEnvironment, sqlite_session_factory: sessionmaker[Session], start_with_oauth: bool
) -> None:
    workspace, app_id = str(uuid4()), str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(make_app(app_id=app_id, tenant_id=workspace))
    store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    service = AppTracingConfigService(configs=store, provider=environment.gateway)
    context = RequestContext("request", None, "account", workspace)
    pat = {"personal_access_token": "synthetic-pat", "client_id": None, "client_secret": None}
    oauth = {"personal_access_token": None, "client_id": "synthetic-client", "client_secret": "synthetic-secret"}
    target = {"host": "https://workspace.test", "experiment_id": "12"}
    service.create(context, app_id, "databricks", {**target, **(oauth if start_with_oauth else pat)})
    environment.api.calls.clear()
    service.update(context, app_id, "databricks", {**target, **(pat if start_with_oauth else oauth)})
    stored = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="databricks")
    assert stored is not None
    assert stored.tracing_config is not None
    assert stored.tracing_config["client_secret" if start_with_oauth else "personal_access_token"] is None
    assert [method for method, _url, _options in environment.api.calls] == (
        ["GET"] if start_with_oauth else ["POST", "GET"]
    )
    expected_token = "synthetic-pat" if start_with_oauth else "synthetic-oauth-token"
    assert environment.api.calls[-1][2]["headers"] == {
        "Authorization": f"Bearer {expected_token}",
        "Accept": "application/json",
    }
    presented = service.get(context, app_id, "databricks")
    assert presented is not None
    assert presented.tracing_config is not None
    assert presented.tracing_config["client_secret" if start_with_oauth else "personal_access_token"] is None
