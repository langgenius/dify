"""Workflow conversion preserves post-commit WebApp access policy."""

from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import (
    AppAdditionalFeatures,
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from enums import DeploymentEdition
from machinery.context import RequestContext
from models.account import TenantAccountJoin, TenantAccountRole
from models.model import App, AppMode, AppModelConfig, InstalledApp, Site
from models.workflow import Workflow
from models.workflow_conversion import ConversionExtension, ConvertedWorkflow, WorkflowConversionSource
from repositories.app.console_repository import ConsoleAppRepository
from services.app.console_gateway import EnterpriseConsoleAppAccess
from services.app_service import AppService
from services.enterprise.enterprise_service import EnterpriseRequest
from services.errors.enterprise import EnterpriseServiceError
from services.workflow.conversion_service import WorkflowConversionService
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_account, make_app, make_tenant
from tests.helpers.unit.rbac_fakes import RBACDomain


@dataclass(frozen=True)
class ConversionSource:
    context: RequestContext
    app_id: str
    apps: ConsoleAppRepository


@dataclass(frozen=True)
class ConversionBuilder:
    failure: Exception | None = None

    def app_config(self, source: WorkflowConversionSource) -> EasyUIBasedAppConfig:
        return EasyUIBasedAppConfig(
            tenant_id=source.tenant_id,
            app_id=source.id,
            app_mode=source.mode,
            app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
            app_model_config_id=source.model_config_id,
            app_model_config_dict=source.model_config or {},
            model=ModelConfigEntity(provider="test-provider", model="test-model", mode="chat"),
            prompt_template=PromptTemplateEntity(
                prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
                simple_prompt_template="Hello",
            ),
            additional_features=AppAdditionalFeatures(),
            variables=[],
        )

    def convert(
        self, app_config: EasyUIBasedAppConfig, extensions: Mapping[str, ConversionExtension]
    ) -> ConvertedWorkflow:
        assert extensions == {}
        if self.failure is not None:
            raise self.failure
        target_mode = AppMode.ADVANCED_CHAT if app_config.app_mode == AppMode.CHAT else AppMode.WORKFLOW
        return ConvertedWorkflow(
            mode=target_mode,
            graph={"nodes": [], "edges": []},
            features={},
        )


@pytest.fixture
def checked_out_connections(sqlite_engine: Engine) -> Iterator[set[object]]:
    connections: set[object] = set()

    def checkout(connection: object, *_args: object) -> None:
        connections.add(connection)

    def checkin(connection: object, *_args: object) -> None:
        connections.remove(connection)

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        yield connections
        assert not connections
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)


def persist_conversion_source(sessions: sessionmaker[Session], source_mode: AppMode = AppMode.CHAT) -> ConversionSource:
    actor_id, workspace_id, app_id = str(uuid4()), str(uuid4()), str(uuid4())
    account = make_account(account_id=actor_id, name="Creator", email=f"{actor_id}@example.com")
    tenant = make_tenant(tenant_id=workspace_id, name="Workspace")
    app = make_app(
        app_id=app_id,
        tenant_id=workspace_id,
        name="Source",
        mode=source_mode,
        created_by=actor_id,
        maintainer=actor_id,
    )
    config = AppModelConfig(app_id=app_id, model="{}")
    with sessions.begin() as session:
        session.add_all(
            [
                account,
                tenant,
                TenantAccountJoin(
                    tenant_id=workspace_id,
                    account_id=actor_id,
                    role=TenantAccountRole.OWNER,
                ),
                app,
                config,
            ]
        )
        session.flush()
        app.app_model_config_id = config.id
    return ConversionSource(
        RequestContext("request", None, actor_id, workspace_id),
        app_id,
        ConsoleAppRepository(session_factory=sessions),
    )


def decrypt_token(_workspace_id: str, token: str) -> str:
    return token


def conversion_service(
    source: ConversionSource,
    access: EnterpriseConsoleAppAccess,
    *,
    builder: ConversionBuilder | None = None,
) -> WorkflowConversionService:
    return WorkflowConversionService(
        source.apps,
        converter=builder or ConversionBuilder(),
        decrypt_token=decrypt_token,
        notify_created=AppService.notify_created_app,
        inherit_access=access.inherit_access,
    )


@pytest.mark.parametrize("source_mode", [AppMode.CHAT, AppMode.COMPLETION])
@pytest.mark.parametrize("source_access", ["public", "private", "private_all", "sso_verified"])
def test_convert_inherits_webapp_access_after_default_initialization(
    sqlite_session_factory: sessionmaker[Session],
    checked_out_connections: set[object],
    rbac_domain: RBACDomain,
    monkeypatch: pytest.MonkeyPatch,
    source_mode: AppMode,
    source_access: str,
) -> None:
    source = persist_conversion_source(sqlite_session_factory, source_mode)
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE,
        RBAC_ENABLED=False,
    )
    calls: list[tuple[str, str, dict[str, object]]] = []

    def request(method: str, endpoint: str, **kwargs: object) -> dict[str, object]:
        assert not checked_out_connections, "Enterprise I/O must run after conversion commits"
        payload = kwargs.get("json") or kwargs.get("params")
        assert isinstance(payload, dict)
        calls.append((method, endpoint, payload))
        if method == "GET":
            assert payload == {"appId": source.app_id}
            return {"accessMode": source_access}
        return {"result": True}

    monkeypatch.setattr(EnterpriseRequest, "send_request", request)
    access = EnterpriseConsoleAppAccess(members=rbac_domain.rbac.members)

    target_id = conversion_service(source, access).convert(
        source.context,
        source.app_id,
        {"name": "Converted"},
    )

    assert calls == [
        ("POST", "/webapp/access-mode", {"appId": target_id, "accessMode": "private"}),
        ("GET", "/webapp/access-mode/id", {"appId": source.app_id}),
        ("POST", "/webapp/access-mode", {"appId": target_id, "accessMode": source_access}),
    ]
    expected_mode = AppMode.ADVANCED_CHAT if source_mode == AppMode.CHAT else AppMode.WORKFLOW
    with sqlite_session_factory() as session:
        target = session.get(App, target_id)
        assert target is not None
        assert target.mode == expected_mode
        assert session.scalar(select(func.count()).select_from(Workflow).where(Workflow.app_id == target_id)) == 1
        assert session.scalar(select(func.count()).select_from(Site).where(Site.app_id == target_id)) == 1
        assert (
            session.scalar(select(func.count()).select_from(InstalledApp).where(InstalledApp.app_id == target_id)) == 1
        )


def test_convert_skips_webapp_access_when_authentication_is_disabled(
    sqlite_session_factory: sessionmaker[Session],
    rbac_domain: RBACDomain,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = persist_conversion_source(sqlite_session_factory)
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        RBAC_ENABLED=False,
    )

    def unexpected_request(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise AssertionError("disabled WebApp authentication must not call Enterprise")

    monkeypatch.setattr(EnterpriseRequest, "send_request", unexpected_request)
    access = EnterpriseConsoleAppAccess(members=rbac_domain.rbac.members)

    target_id = conversion_service(source, access).convert(source.context, source.app_id, {"name": "Converted"})

    assert target_id != source.app_id


def test_conversion_failure_does_not_create_or_inherit_access(
    sqlite_session_factory: sessionmaker[Session],
    rbac_domain: RBACDomain,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = persist_conversion_source(sqlite_session_factory)
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE,
        RBAC_ENABLED=False,
    )

    def unexpected_request(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise AssertionError("failed conversion must not call Enterprise")

    monkeypatch.setattr(EnterpriseRequest, "send_request", unexpected_request)
    access = EnterpriseConsoleAppAccess(members=rbac_domain.rbac.members)
    failure = RuntimeError("conversion failed")

    with pytest.raises(RuntimeError) as raised:
        conversion_service(source, access, builder=ConversionBuilder(failure)).convert(
            source.context,
            source.app_id,
            {"name": "Converted"},
        )

    assert raised.value is failure
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(App)) == 1
        assert session.scalar(select(func.count()).select_from(Workflow)) == 0


def test_inherit_failure_propagates_after_converted_app_commits(
    sqlite_session_factory: sessionmaker[Session],
    rbac_domain: RBACDomain,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = persist_conversion_source(sqlite_session_factory)
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE,
        RBAC_ENABLED=False,
    )
    target_id: str | None = None
    failure = EnterpriseServiceError("write failed")

    def request(method: str, endpoint: str, **kwargs: object) -> dict[str, object]:
        nonlocal target_id
        payload = kwargs.get("json") or kwargs.get("params")
        assert isinstance(payload, dict)
        if method == "GET":
            assert endpoint == "/webapp/access-mode/id"
            return {"accessMode": "private_all"}
        assert endpoint == "/webapp/access-mode"
        if target_id is None:
            target_id = str(payload["appId"])
            return {"result": True}
        raise failure

    monkeypatch.setattr(EnterpriseRequest, "send_request", request)
    access = EnterpriseConsoleAppAccess(members=rbac_domain.rbac.members)

    with pytest.raises(EnterpriseServiceError) as raised:
        conversion_service(source, access).convert(source.context, source.app_id, {"name": "Converted"})

    assert raised.value is failure
    assert target_id is not None
    with sqlite_session_factory() as session:
        target = session.get(App, target_id)
        assert target is not None
        assert target.name == "Converted"
        assert session.scalar(select(func.count()).select_from(Workflow).where(Workflow.app_id == target_id)) == 1
