"""Conversion persists an App aggregate and its draft atomically on PostgreSQL."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import App, AppMode, AppModelConfig, InstalledApp, Site
from models.workflow import Workflow
from repositories.app.console_repository import ConsoleAppRepository
from services.entities.app_entities import AppEvent
from services.workflow.conversion_service import WorkflowConversionService
from services.workflow.workflow_converter import WorkflowConverter

type ConversionSource = tuple[sessionmaker[Session], RequestContext, str]


@pytest.fixture
def conversion_source(db_session_with_containers: Session) -> ConversionSource:
    class ConversionSession(Session):
        pass

    sessions: sessionmaker[Session] = sessionmaker[Session](
        db_session_with_containers.get_bind(), class_=ConversionSession, expire_on_commit=False
    )
    account_id, tenant_id, app_id, config_id = (str(uuid4()) for _ in range(4))
    with sessions.begin() as session:
        session.add_all(
            [
                (account := Account(name="Converter", email=f"{account_id}@example.com", interface_language="en-US")),
                (tenant := Tenant(name="Conversion workspace")),
            ]
        )
        account.id = account_id
        tenant.id = tenant_id
        session.flush()
        session.add_all(
            [
                TenantAccountJoin(
                    tenant_id=tenant_id, account_id=account_id, role=TenantAccountRole.OWNER, current=True
                ),
                App(
                    id=app_id,
                    tenant_id=tenant_id,
                    name="Source",
                    mode=AppMode.CHAT,
                    app_model_config_id=config_id,
                    enable_api=True,
                    enable_site=True,
                    created_by=account_id,
                    updated_by=account_id,
                ),
                (
                    config := AppModelConfig(
                        app_id=app_id,
                        model=json.dumps(
                            {"provider": "openai", "name": "gpt-4", "mode": "chat", "completion_params": {}}
                        ),
                        pre_prompt="Hello {{name}}",
                        user_input_form=json.dumps([{"text-input": {"variable": "name", "label": "Name"}}]),
                    )
                ),
            ]
        )
        config.id = config_id
    return sessions, RequestContext("conversion", None, account_id, tenant_id), app_id


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.COMPLETION])
def test_conversion_creates_complete_target_before_notification(
    conversion_source: ConversionSource, mode: AppMode
) -> None:
    sessions, context, app_id = conversion_source
    with sessions.begin() as session:
        app = session.get(App, app_id)
        assert app is not None
        app.mode = mode
    observed: list[str] = []

    def created(*, event: AppEvent, account_id: str, backing_agent_id: str | None) -> None:
        assert (account_id, backing_agent_id) == (context.account_id, None)
        with sessions() as session:
            assert session.scalar(select(Workflow).where(Workflow.app_id == event.id)) is not None
            assert session.scalar(select(Site).where(Site.app_id == event.id)) is not None
            assert session.scalar(select(InstalledApp).where(InstalledApp.app_id == event.id)) is not None
        observed.append(event.id)

    service = WorkflowConversionService(
        ConsoleAppRepository(session_factory=sessions),
        converter=WorkflowConverter(),
        decrypt_token=lambda *_: "key",
        notify_created=created,
    )
    new_id = service.convert(context, app_id, {"name": "Converted", "icon": "🚀"})
    assert observed == [new_id]
    with sessions() as session:
        app = session.get(App, new_id)
        assert app is not None
        assert app.name == "Converted"
        assert app.icon == "🚀"
        assert app.mode == (AppMode.ADVANCED_CHAT if mode == AppMode.CHAT else AppMode.WORKFLOW)
        assert app.created_by == context.account_id
        assert session.scalar(select(Workflow.id).where(Workflow.app_id == app_id)) is None
        workflow = session.scalar(select(Workflow).where(Workflow.app_id == new_id))
        assert workflow is not None
        assert workflow.version == Workflow.VERSION_DRAFT
        assert [node["id"] for node in json.loads(workflow.graph)["nodes"]] == [
            "start",
            "llm",
            "answer" if mode == AppMode.CHAT else "end",
        ]


def test_workflow_write_failure_rolls_back_target_and_required_records(
    conversion_source: ConversionSource,
) -> None:
    sessions, context, app_id = conversion_source

    def reject_workflow(session: Session, *_: object) -> None:
        if any(isinstance(row, Workflow) for row in session.new):
            raise RuntimeError("workflow write failed")

    event.listen(sessions.class_, "before_flush", reject_workflow)
    notifications: list[dict[str, object]] = []

    def notify_created(*, event: AppEvent, account_id: str, backing_agent_id: str | None) -> None:
        notifications.append({"event": event, "account_id": account_id, "backing_agent_id": backing_agent_id})

    service = WorkflowConversionService(
        ConsoleAppRepository(session_factory=sessions),
        converter=WorkflowConverter(),
        decrypt_token=lambda *_: "key",
        notify_created=notify_created,
    )
    with pytest.raises(RuntimeError, match="workflow write failed"):
        service.convert(context, app_id, {})
    assert notifications == []
    with sessions() as session:
        assert list(session.scalars(select(App.id).where(App.tenant_id == context.active_workspace_id))) == [app_id]
        assert session.scalar(select(Workflow.id).where(Workflow.tenant_id == context.active_workspace_id)) is None
        assert (
            session.scalar(select(InstalledApp.id).where(InstalledApp.tenant_id == context.active_workspace_id)) is None
        )
        assert session.scalar(select(Site.id).where(Site.created_by == context.account_id)) is None
