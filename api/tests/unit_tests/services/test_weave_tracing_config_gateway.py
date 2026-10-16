"""Config reads and writes must not construct Weave's stateful legacy exporter."""

from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from typing import Never
from uuid import uuid4

import pytest
import wandb
import weave
from dify_trace_weave.configuration import WeaveConfigurationError
from dify_trace_weave.weave_trace import WeaveDataTrace
from sqlalchemy.orm import Session, sessionmaker

from core.helper import ssrf_proxy
from core.ops import ops_trace_manager
from core.ops.ops_trace_manager import OpsTraceManager
from machinery.context import RequestContext
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from services.app_tracing_config_gateway import OpsTraceManagerGateway
from services.app_tracing_config_service import AppTracingConfigService, AppTracingConfigVerificationFailedError
from tests.unit_tests.model_factories import make_app
from tests.unit_tests.services.tracing.test_weave_configuration import ReadAPI


@dataclass
class GatewayEnvironment:
    gateway: OpsTraceManagerGateway = field(default_factory=OpsTraceManagerGateway)
    api: ReadAPI = field(default_factory=ReadAPI)
    forbidden_calls: list[str] = field(default_factory=list)


@pytest.fixture
def environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[GatewayEnvironment]:
    environment = GatewayEnvironment()

    def encrypt(_tenant: str, value: str) -> str:
        return "test-cipher:" + value

    def decrypt(_tenant: str, values: Sequence[str]) -> list[str]:
        assert all(value.startswith("test-cipher:") for value in values)
        return [value.removeprefix("test-cipher:") for value in values]

    def mask(_value: str) -> str:
        return "******"

    def forbidden(name: str) -> Callable[..., Never]:
        def block(*_args: object, **_kwargs: object) -> Never:
            environment.forbidden_calls.append(name)
            raise AssertionError("Configuration must not initialize a stateful exporter")

        return block

    monkeypatch.setattr(ops_trace_manager, "encrypt_token", encrypt)
    monkeypatch.setattr(ops_trace_manager, "batch_decrypt_token", decrypt)
    monkeypatch.setattr(ops_trace_manager, "obfuscated_token", mask)
    monkeypatch.setattr(ssrf_proxy, "post", environment.api.post)
    monkeypatch.setattr(WeaveDataTrace, "__init__", forbidden("legacy_constructor"))
    monkeypatch.setattr(wandb, "login", forbidden("wandb_login"))
    monkeypatch.setattr(weave, "init", forbidden("weave_init"))
    yield environment
    assert environment.forbidden_calls == []


def test_create_persists_resolved_default_entity_and_canonical_project(environment: GatewayEnvironment) -> None:
    submitted = {"api_key": "synthetic-key", "project": " demo "}
    stored = environment.gateway.prepare_new_config(
        workspace_id=str(uuid4()), tracing_provider="weave", tracing_config=submitted
    )
    assert stored["entity"] == "default-team"
    assert stored["project"] == "demo"
    assert stored["project_url"] == "https://wandb.ai/default-team/demo"
    assert stored["api_key"] == "test-cipher:synthetic-key"
    assert submitted == {"api_key": "synthetic-key", "project": " demo "}
    assert len(environment.api.calls) == 3


def test_patch_persists_verified_destination_with_the_existing_ciphertext(
    environment: GatewayEnvironment, sqlite_session_factory: sessionmaker[Session]
) -> None:
    workspace, app_id = str(uuid4()), str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(make_app(app_id=app_id, tenant_id=workspace))
    store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    service = AppTracingConfigService(configs=store, provider=environment.gateway)
    context = RequestContext("request", None, "account", workspace)
    service.create(context, app_id, "weave", {"api_key": "synthetic-key", "entity": "old", "project": "original"})
    before = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="weave")
    assert before is not None
    assert before.tracing_config is not None

    submitted = {"api_key": "******", "project": "new-team/changed"}
    service.update(context, app_id, "weave", submitted)
    after = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="weave")
    assert after is not None
    assert after.tracing_config is not None
    assert after.tracing_config["entity"] == "new-team"
    assert after.tracing_config["project"] == "changed"
    assert after.tracing_config["project_url"] == "https://wandb.ai/new-team/changed"
    assert after.tracing_config["api_key"] == before.tracing_config["api_key"] == "test-cipher:synthetic-key"
    assert before.tracing_config["project_url"] == "https://wandb.ai/old/original"
    assert submitted == {"api_key": "******", "project": "new-team/changed"}
    assert len(environment.api.calls) == 4

    presented = service.get(context, app_id, "weave")
    assert presented is not None
    assert presented.tracing_config is not None
    assert presented.tracing_config["api_key"] == "******"
    assert presented.tracing_config["project_url"] == after.tracing_config["project_url"]
    environment.gateway.validate_saved_config(
        workspace_id=workspace, tracing_provider="weave", tracing_config=after.tracing_config
    )
    assert len(environment.api.calls) == 4


@pytest.mark.parametrize(
    ("entity", "project", "host", "expected"),
    [
        ("team", "demo", None, "https://wandb.ai/team/demo"),
        (None, "team/demo", None, "https://wandb.ai/team/demo"),
        (None, "demo", None, "https://wandb.ai"),
        (None, "demo", "http://private.test/wandb", "http://private.test/wandb"),
        ("team", "a & b", "https://private.test/wandb", "https://private.test/wandb/team/a%20%26%20b"),
    ],
)
def test_get_computes_project_or_console_link_without_vendor_requests(
    environment: GatewayEnvironment, entity: str | None, project: str, host: str | None, expected: str
) -> None:
    workspace = str(uuid4())
    encrypted = OpsTraceManager.encrypt_tracing_config(
        workspace, "weave", {"api_key": "synthetic-key", "entity": entity, "project": project, "host": host}
    )
    encrypted["project_url"] = "https://stale.test/previous-project"
    result = environment.gateway.present_config(
        workspace_id=workspace, tracing_provider="weave", tracing_config=encrypted
    )
    assert result["project_url"] == expected
    assert result["api_key"] == "******"
    assert environment.api.calls == []


def test_inaccessible_project_is_a_sanitized_domain_error_and_is_not_saved(
    environment: GatewayEnvironment, sqlite_session_factory: sessionmaker[Session], caplog: pytest.LogCaptureFixture
) -> None:
    workspace, app_id = str(uuid4()), str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(make_app(app_id=app_id, tenant_id=workspace))
    environment.api.project_exists = False
    store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    service = AppTracingConfigService(configs=store, provider=environment.gateway)
    with pytest.raises(AppTracingConfigVerificationFailedError) as caught:
        service.create(
            RequestContext("request", None, "account", workspace),
            app_id,
            "weave",
            {
                "api_key": "synthetic-private-key",
                "entity": "team",
                "project": "missing",
            },
        )
    assert isinstance(caught.value.__cause__, WeaveConfigurationError)
    assert caught.value.__cause__.code == "project_not_found_or_inaccessible"
    assert store.get(workspace_id=workspace, app_id=app_id, tracing_provider="weave") is None
    assert "synthetic-private-key" not in caplog.text
    assert "project_not_found_or_inaccessible" in caplog.text
    assert len(environment.api.calls) == 1
