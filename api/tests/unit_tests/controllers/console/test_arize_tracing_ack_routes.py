"""Both real config Resources reach the same ACK gate before atomic SQL updates.

HTTP dispatch, payload validation, owner resolution, DI services, encryption and
SQLite persistence are real. Login admission supplies a local owner account and
the existing RSA fixture supplies private-key storage; no external account is used.
"""

import json
from copy import deepcopy
from uuid import uuid4

import pytest
from dify_trace_arize_phoenix.arize_phoenix_trace import ArizePhoenixDataTrace
from flask import Flask
from flask_restx import Api
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from controllers.console import flask_admission, wraps
from controllers.console.agent.tracing import AgentTraceConfigApi
from controllers.console.app.ops_trace import TraceAppConfigApi
from core.helper import ssrf_proxy
from core.ops.ops_trace_manager import OpsTraceManager
from enums import DeploymentEdition
from extensions.ext_application_services import ApplicationServices
from libs.login import AccountWithTenant
from models.account import Account, AccountStatus, TenantAccountRole
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.model import App, AppMode, TraceAppConfig
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_app
from tests.unit_tests.services.tracing.test_arize_configuration_ack import (
    collector as collector,  # noqa: PLC0414 - Re-export the real local gRPC collector fixture.
)

pytest_plugins = ("tests.unit_tests.services.tracing.test_nullable_tracing_credentials",)


@pytest.mark.parametrize("surface", ["app", "agent"])
@pytest.mark.parametrize("method", ["POST", "PATCH"])
def test_config_write_rejects_bad_ack_without_changing_old_rows_policy_or_cache(
    workspace: str,
    sqlite_session_factory: sessionmaker[Session],
    account_application_services: ApplicationServices,
    monkeypatch: pytest.MonkeyPatch,
    collector: tuple[str, list[tuple[bytes, dict[str, str]]], dict[str, object]],
    surface: str,
    method: str,
) -> None:
    endpoint, calls, _ = collector
    app_id, agent_id, account_id = (str(uuid4()) for _ in range(3))
    old_policy = json.dumps(
        {"enabled": True, "tracing_provider": "langsmith", "capture_content": False, "capture_agent": False}
    )
    with sqlite_session_factory.begin() as session:
        session.add(
            make_app(
                app_id=app_id,
                tenant_id=workspace,
                mode=AppMode.AGENT if surface == "agent" else AppMode.WORKFLOW,
                tracing=old_policy,
            )
        )
        if surface == "agent":
            session.add(
                Agent(
                    id=agent_id,
                    tenant_id=workspace,
                    name="ACK test",
                    scope=AgentScope.ROSTER,
                    source=AgentSource.AGENT_APP,
                    app_id=app_id,
                    status=AgentStatus.ACTIVE,
                    created_by=account_id,
                    updated_by=account_id,
                )
            )
    store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    original = OpsTraceManager.encrypt_tracing_config(
        workspace, "langsmith", {"api_key": "other-provider-key", "project": "other"}
    )
    assert store.create(workspace_id=workspace, app_id=app_id, tracing_provider="langsmith", tracing_config=original)
    if method == "PATCH":
        old = OpsTraceManager.encrypt_tracing_config(
            workspace,
            "arize",
            {
                "endpoint": endpoint,
                "project": "old-project",
                "api_key": "synthetic-good",
                "space_id": "synthetic-space",
            },
        )
        old.update(
            {
                "project_url": "https://app.arize.com/?redirect_project_name=old-project",
                "arize_project_destination": {"legacy": "unchanged"},
            }
        )
        assert store.create(workspace_id=workspace, app_id=app_id, tracing_provider="arize", tracing_config=old)
    with sqlite_session_factory() as session:
        before = deepcopy(
            list(
                session.execute(
                    select(TraceAppConfig.__table__).where(TraceAppConfig.app_id == app_id).order_by(TraceAppConfig.id)
                ).mappings()
            )
        )

    account = Account(name="Owner", email="owner@example.test", status=AccountStatus.ACTIVE)
    account.id, account.role = account_id, TenantAccountRole.OWNER
    identity = AccountWithTenant(account, workspace)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: identity)
    monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: identity)
    apply_config_overrides(
        monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, LOGIN_DISABLED=True, RBAC_ENABLED=False
    )

    def forbidden(*_args: object, **_kwargs: object) -> None:
        pytest.fail("Local custom collector verification must not perform optional Cloud HTTP reads")

    monkeypatch.setattr(ssrf_proxy, "get", forbidden)
    monkeypatch.setattr(ArizePhoenixDataTrace, "__init__", forbidden)
    app = Flask(__name__)
    app.extensions["application_services"] = account_application_services
    api = Api(app)
    api.add_resource(TraceAppConfigApi, "/console/api/apps/<uuid:app_id>/trace-config")
    api.add_resource(AgentTraceConfigApi, "/console/api/agent/<uuid:agent_id>/trace-config")
    url = (
        f"/console/api/apps/{app_id}/trace-config"
        if surface == "app"
        else f"/console/api/agent/{agent_id}/trace-config"
    )
    values = {
        "endpoint": endpoint,
        "project": "not-created-by-verification",
        "api_key": "synthetic-invalid",
        "space_id": "synthetic-space",
    }
    with app.test_client() as client:
        failed = client.open(
            url, method=method, json={"tracing_provider": "arize", "tracing_config": values, "activate": True}
        )
        assert failed.status_code == 400
        body = failed.json
        assert isinstance(body, dict)
        assert body["code"] == "tracing_config_verification_failed"
        assert "private-vendor-details" not in failed.get_data(as_text=True)
        assert "synthetic-invalid" not in failed.get_data(as_text=True)
        with sqlite_session_factory() as session:
            after = list(
                session.execute(
                    select(TraceAppConfig.__table__).where(TraceAppConfig.app_id == app_id).order_by(TraceAppConfig.id)
                ).mappings()
            )
            assert after == before
            assert session.scalar(select(App.tracing).where(App.id == app_id)) == old_policy
        values["api_key"] = "synthetic-good"
        accepted = client.open(
            url, method=method, json={"tracing_provider": "arize", "tracing_config": values, "activate": True}
        )
        assert accepted.status_code == (201 if method == "POST" else 200)
    saved = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="arize")
    assert saved is not None
    assert saved.tracing_config is not None
    assert (
        OpsTraceManager.decrypt_tracing_config(workspace, "arize", saved.tracing_config)["api_key"] == "synthetic-good"
    )
    assert "project_url" not in saved.tracing_config
    assert "arize_project_destination" not in saved.tracing_config
    assert len(calls) == 2
    with sqlite_session_factory() as session:
        policy = json.loads(session.scalar(select(App.tracing).where(App.id == app_id)) or "{}")
    assert policy == {"enabled": True, "tracing_provider": "arize", "capture_content": False, "capture_agent": False}
    if method == "PATCH":
        with app.test_client() as client:
            masked = client.patch(
                url,
                json={
                    "tracing_provider": "arize",
                    "tracing_config": {**values, "project": "next-project", "api_key": "******", "space_id": "******"},
                },
            )
            assert masked.status_code == 200
        updated = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="arize")
        assert updated is not None
        assert updated.tracing_config is not None
        assert updated.tracing_config["api_key"] == saved.tracing_config["api_key"]
        assert updated.tracing_config["space_id"] == saved.tracing_config["space_id"]
        assert calls[-1][1]["api_key"] == "synthetic-good"
        assert calls[-1][1]["space_id"] == "synthetic-space"
        assert len(calls) == 3
