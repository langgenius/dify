"""MLflow config persistence uses real RSA/SQLite without constructing an exporter."""

import json
from dataclasses import dataclass
from uuid import uuid4

import pytest
from dify_trace_mlflow.oss_configuration import MLflowConfigurationError
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
from tests.unit_tests.services.tracing.test_databricks_configuration import ExperimentAPI, response
from tests.unit_tests.services.tracing.test_mlflow_configuration import (
    experiment_api as experiment_api,  # noqa: PLC0414 - Re-export pytest fixtures only in this module.
)
from tests.unit_tests.services.tracing.test_mlflow_configuration import (
    isolated_sdk_state as isolated_sdk_state,  # noqa: PLC0414 - Re-export pytest fixtures only in this module.
)

pytest_plugins = ("tests.unit_tests.services.tracing.test_nullable_tracing_credentials",)


@dataclass
class ConfigurationCase:
    api: ExperimentAPI
    gateway: OpsTraceManagerGateway
    service: AppTracingConfigService
    store: SQLAlchemyAppTracingConfigRepository
    reader: ConsoleAppRepository
    context: RequestContext
    app_id: str

    def read(self, provider: str = "mlflow") -> AppTracingConfigRecord | None:
        return self.store.get(
            workspace_id=self.context.active_workspace_id, app_id=self.app_id, tracing_provider=provider
        )


@pytest.fixture
def case(
    workspace: str, sqlite_session_factory: sessionmaker[Session], experiment_api: ExperimentAPI
) -> ConfigurationCase:
    app_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(
            make_app(
                app_id=app_id,
                tenant_id=workspace,
                tracing=json.dumps(
                    {"enabled": True, "tracing_provider": "langsmith", "capture_content": True, "capture_agent": False}
                ),
            )
        )
    gateway = OpsTraceManagerGateway()
    store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    previous = OpsTraceManager.encrypt_tracing_config(
        workspace, "langsmith", {"api_key": "synthetic-other-key", "project": "other", "endpoint": "https://other.test"}
    )
    assert store.create(workspace_id=workspace, app_id=app_id, tracing_provider="langsmith", tracing_config=previous)
    return ConfigurationCase(
        experiment_api,
        gateway,
        AppTracingConfigService(configs=store, provider=gateway),
        store,
        ConsoleAppRepository(session_factory=sqlite_session_factory),
        RequestContext("request", None, "account", workspace),
        app_id,
    )


def test_post_masked_patch_and_get_preserve_ciphertext_and_exact_destination(case: ConfigurationCase) -> None:
    original = case.read("langsmith")
    submitted = {
        "tracking_uri": " HTTP://FIRST.Example:5000/team/ ",
        "experiment_id": "00012",
        "username": "test-user",
        "password": "synthetic-password",
    }
    untouched = dict(submitted)
    case.service.create(case.context, case.app_id, "mlflow", submitted, activate=True)
    before = case.read()
    assert before is not None
    assert before.tracing_config is not None
    config = before.tracing_config
    assert config["tracking_uri"] == "http://first.example:5000/team"
    assert config["experiment_id"] == "12"
    assert config["password"] != "synthetic-password"
    assert OpsTraceManager.decrypt_tracing_config(case.context.active_workspace_id, "mlflow", config)["password"] == (
        "synthetic-password"
    )
    assert submitted == untouched
    shown = case.service.get(case.context, case.app_id, "mlflow")
    assert shown is not None
    assert shown.tracing_config is not None
    masked = shown.tracing_config["password"]
    assert isinstance(masked, str)
    assert "*" in masked
    assert masked != "synthetic-password"
    assert len(case.api.calls) == 1
    case.service.update(
        case.context,
        case.app_id,
        "mlflow",
        {
            "tracking_uri": "https://SECOND.test/new-prefix/",
            "experiment_id": "00034",
            "username": "test-user",
            "password": masked,
        },
    )
    after = case.read()
    assert after is not None
    assert after.tracing_config is not None
    assert after.tracing_config["password"] == config["password"]
    assert after.tracing_config["tracking_uri"] == "https://second.test/new-prefix"
    assert after.tracing_config["experiment_id"] == "34"
    assert after.tracing_config["project_url"] == "https://second.test/new-prefix/#/experiments/34/traces"
    assert len(case.api.calls) == 2
    assert case.api.calls[-1][1] == "https://second.test/new-prefix/api/2.0/mlflow/experiments/get"
    case.gateway.validate_saved_config(
        workspace_id=case.context.active_workspace_id, tracing_provider="mlflow", tracing_config=after.tracing_config
    )
    assert case.service.get(case.context, case.app_id, "mlflow") is not None
    assert len(case.api.calls) == 2
    assert case.read("langsmith") == original
    policy = case.reader.get_trace(case.context, case.app_id)
    assert policy.enabled
    assert policy.tracing_provider == "mlflow"
    assert policy.capture_content is True
    assert policy.capture_agent is False


@pytest.mark.parametrize("clear_with_null", [False, True])
def test_basic_to_anonymous_and_back_does_not_reuse_credentials(case: ConfigurationCase, clear_with_null: bool) -> None:
    destination = {"tracking_uri": "https://same.test/prefix", "experiment_id": "12"}
    case.service.create(
        case.context, case.app_id, "mlflow", {**destination, "username": "first", "password": "first-secret"}
    )
    empty = None if clear_with_null else ""
    case.service.update(case.context, case.app_id, "mlflow", {**destination, "username": empty, "password": empty})
    assert case.api.calls[-1][2]["headers"] == {
        "Accept": "application/json",
        "Accept-Encoding": "identity",
        "Cookie": "",
    }
    stored = case.read()
    assert stored is not None
    assert stored.tracing_config is not None
    assert (
        OpsTraceManager.decrypt_tracing_config(case.context.active_workspace_id, "mlflow", stored.tracing_config)[
            "password"
        ]
        == empty
    )
    case.service.update(
        case.context, case.app_id, "mlflow", {**destination, "username": "second", "password": "second-secret"}
    )
    assert case.api.calls[-1][2]["headers"] != case.api.calls[0][2]["headers"]


def test_failed_patch_keeps_config_policy_and_other_provider(
    case: ConfigurationCase, caplog: pytest.LogCaptureFixture
) -> None:
    original = {
        "tracking_uri": "https://first.test",
        "experiment_id": "12",
        "username": "user",
        "password": "private-password",
    }
    case.service.create(case.context, case.app_id, "mlflow", original)
    before, other, policy = case.read(), case.read("langsmith"), case.reader.get_trace(case.context, case.app_id)
    case.api.override = lambda _method, url, _options: response(url, {"message": "private-vendor-response"}, 403)
    with pytest.raises(AppTracingConfigVerificationFailedError) as caught:
        case.service.update(
            case.context,
            case.app_id,
            "mlflow",
            {**original, "tracking_uri": "https://second.test", "password": "******"},
            activate=True,
        )
    assert isinstance(caught.value.__cause__, MLflowConfigurationError)
    assert caught.value.__cause__.code == "permission_denied"
    assert case.read() == before
    assert case.read("langsmith") == other
    assert case.reader.get_trace(case.context, case.app_id) == policy
    assert "permission_denied" in caplog.text
    assert "private-vendor-response" not in caplog.text
    assert "private-password" not in caplog.text


def test_failed_auth_pair_patch_does_not_erase_a_password(case: ConfigurationCase) -> None:
    original = {"tracking_uri": "https://first.test", "experiment_id": "12", "username": "user", "password": "password"}
    case.service.create(case.context, case.app_id, "mlflow", original)
    before = case.read()
    with pytest.raises(AppTracingConfigVerificationFailedError) as caught:
        case.service.update(case.context, case.app_id, "mlflow", {**original, "password": None})
    assert isinstance(caught.value.__cause__, MLflowConfigurationError)
    assert caught.value.__cause__.code == "incomplete_basic_auth"
    assert len(case.api.calls) == 1
    assert case.read() == before


@pytest.mark.parametrize("saved_url", [None, "https://stale.test/wrong-experiment"])
def test_historical_get_is_pure_even_with_partial_auth(case: ConfigurationCase, saved_url: str | None) -> None:
    stored = OpsTraceManager.encrypt_tracing_config(
        case.context.active_workspace_id,
        "mlflow",
        {
            "tracking_uri": "https://server.test/prefix/",
            "experiment_id": "00012",
            "username": "historical-user",
            "password": None,
        },
    )
    if saved_url is not None:
        stored["project_url"] = saved_url
    shown = case.gateway.present_config(
        workspace_id=case.context.active_workspace_id, tracing_provider="mlflow", tracing_config=stored
    )
    assert shown["project_url"] == "https://server.test/prefix/#/experiments/12/traces"
    assert shown["password"] is None
    case.gateway.validate_saved_config(
        workspace_id=case.context.active_workspace_id, tracing_provider="mlflow", tracing_config=stored
    )
    assert case.api.calls == []


def test_invalid_historical_url_has_no_fabricated_link_or_network(case: ConfigurationCase) -> None:
    stored = OpsTraceManager.encrypt_tracing_config(
        case.context.active_workspace_id,
        "mlflow",
        {
            "tracking_uri": "https://user:secret@server.test?token=private",
            "experiment_id": "12",
            "username": None,
            "password": None,
        },
    )
    shown = case.gateway.present_config(
        workspace_id=case.context.active_workspace_id, tracing_provider="mlflow", tracing_config=stored
    )
    assert shown["project_url"] is None
    assert case.api.calls == []


def test_invalid_new_destination_never_reaches_storage_or_network(case: ConfigurationCase) -> None:
    with pytest.raises(AppTracingConfigInvalidConfigurationError):
        case.service.create(
            case.context,
            case.app_id,
            "mlflow",
            {
                "tracking_uri": "https://server.test/prefix/../other",
                "experiment_id": "12",
                "username": "user",
                "password": "secret",
            },
            activate=True,
        )
    assert case.read() is None
    assert case.api.calls == []
    assert case.reader.get_trace(case.context, case.app_id).tracing_provider == "langsmith"
