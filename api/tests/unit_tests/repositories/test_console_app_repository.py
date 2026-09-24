"""Short-session app persistence and tenant visibility regression tests."""

import json
from collections.abc import Callable
from uuid import uuid4

import pytest
from flask import has_request_context
from sqlalchemy import Engine, event, func, select, text
from sqlalchemy.orm import Session, sessionmaker

from fields.app_fields import AppPagination
from machinery.context import RequestContext
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.enums import CustomizeTokenStrategy
from models.model import App, AppMode, AppModelConfig, AppStar, IconType, Site
from models.workflow import Workflow, WorkflowType
from repositories.app.console_repository import ConsoleAppRepository
from services.app.console_service import ConsoleAppNotFoundError
from services.entities.app_entities import (
    AppListParams,
    AppTraceSettings,
    StarredAppListParams,
    UpdateAppParams,
)

WORKSPACE = str(uuid4())
ACTOR = str(uuid4())
CONTEXT = RequestContext("request", "trace", ACTOR, WORKSPACE)


def persist_app(session: Session, **changes: object) -> App:
    values: dict[str, object] = {
        "id": str(uuid4()),
        "tenant_id": WORKSPACE,
        "name": "Example",
        "mode": AppMode.CHAT,
        "description": "",
        "enable_site": True,
        "enable_api": True,
        "icon_type": IconType.EMOJI,
        "icon": "🤖",
        "icon_background": "#fff",
        "updated_by": ACTOR,
    }
    values.update(changes)
    app = App(**values)
    session.add(app)
    session.commit()
    return app


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> ConsoleAppRepository:
    return ConsoleAppRepository(session_factory=sqlite_session_factory)


@pytest.mark.parametrize(
    "operation",
    [
        lambda repo, ctx, app_id: repo.get(ctx, app_id),
        lambda repo, ctx, app_id: repo.rename(ctx, app_id, "Renamed"),
        lambda repo, ctx, app_id: repo.set_starred(ctx, app_id, True),
        lambda repo, ctx, app_id: repo.get_trace(ctx, app_id),
        lambda repo, ctx, app_id: repo.set_trace(ctx, app_id, AppTraceSettings(True, "langfuse")),
        lambda repo, ctx, app_id: repo.get_reference(ctx, app_id),
    ],
)
@pytest.mark.parametrize("visibility", ["other_tenant", "disabled", "workflow_only"])
def test_all_single_app_operations_preserve_visibility(
    repository: ConsoleAppRepository,
    sqlite_session: Session,
    operation: Callable[[ConsoleAppRepository, RequestContext, str], object],
    visibility: str,
) -> None:
    app = persist_app(sqlite_session)
    if visibility == "other_tenant":
        context = CONTEXT._replace(active_workspace_id=str(uuid4()))
    else:
        context = CONTEXT
        if visibility == "disabled":
            sqlite_session.execute(
                text("UPDATE apps SET status = :status WHERE id = :app_id"), {"status": "disabled", "app_id": app.id}
            )
        else:
            app.mode = AppMode.AGENT
            sqlite_session.add(
                Agent(
                    tenant_id=WORKSPACE,
                    name="Hidden",
                    scope=AgentScope.WORKFLOW_ONLY,
                    source=AgentSource.WORKFLOW,
                    status=AgentStatus.ACTIVE,
                    backing_app_id=app.id,
                )
            )
        sqlite_session.commit()
    with pytest.raises(ConsoleAppNotFoundError):
        operation(repository, context, app.id)
    assert sqlite_session.scalar(select(App.id).where(App.id == app.id)) is not None
    assert sqlite_session.scalar(select(func.count()).select_from(AppStar)) == 0


def test_detail_is_materialized_after_repository_session_closes(
    repository: ConsoleAppRepository,
    sqlite_session: Session,
    sqlite_engine: Engine,
) -> None:
    assert not has_request_context()
    app = persist_app(sqlite_session)
    config = AppModelConfig(app_id=app.id, model='{"provider":"openai","name":"example"}', pre_prompt="Prompt")
    site = Site(
        app_id=app.id,
        code="site-code",
        title="Public",
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
    )
    sqlite_session.add_all([config, site])
    sqlite_session.flush()
    app.app_model_config_id = config.id
    sqlite_session.commit()
    record = repository.get(CONTEXT, app.id)

    def reject_queries(*_args: object) -> None:
        raise AssertionError("Serialization must not query the database")

    event.listen(sqlite_engine, "before_cursor_execute", reject_queries)
    try:
        model_config = record.app_model_config
        site_data = record.site
        description = record.description
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", reject_queries)
    assert model_config is not None
    assert model_config["model"] == {"provider": "openai", "name": "example"}
    assert site_data is not None
    assert site_data["code"] == "site-code"
    assert description == ""


@pytest.mark.parametrize(
    "operation",
    [
        lambda repo, app_id: repo.rename(CONTEXT, app_id, "Renamed"),
        lambda repo, app_id: repo.update_icon(CONTEXT, app_id, icon="icon", icon_background="", icon_type=None),
        lambda repo, app_id: repo.set_site_enabled(CONTEXT, app_id, False),
        lambda repo, app_id: repo.set_api_enabled(CONTEXT, app_id, False),
    ],
)
def test_detail_writes_do_not_load_unrequested_site_or_tools(
    repository: ConsoleAppRepository,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    operation: Callable[[ConsoleAppRepository, str], object],
) -> None:
    app = persist_app(sqlite_session)

    def reject_unrequested_data(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("This response does not require site or plugin tool information")

    monkeypatch.setattr(App, "site_with_session", reject_unrequested_data)
    monkeypatch.setattr("repositories.app.response.load_app_tool_references", reject_unrequested_data)
    operation(repository, app.id)


def test_star_is_idempotent_and_scoped_to_account(repository: ConsoleAppRepository, sqlite_session: Session) -> None:
    app = persist_app(sqlite_session)
    repository.set_starred(CONTEXT, app.id, True)
    repository.set_starred(CONTEXT, app.id, True)
    another = CONTEXT._replace(account_id=str(uuid4()))
    repository.set_starred(another, app.id, True)
    repository.set_starred(CONTEXT, app.id, False)
    repository.set_starred(CONTEXT, app.id, False)
    assert sqlite_session.scalars(select(AppStar.account_id)).all() == [another.account_id]
    assert repository.list_apps(CONTEXT, StarredAppListParams()).data == []
    assert repository.list_apps(another, StarredAppListParams()).data[0].is_starred


def test_draft_trigger_enrichment_is_tenant_scoped_and_tolerates_bad_graphs(
    repository: ConsoleAppRepository, sqlite_session: Session
) -> None:
    apps = [persist_app(sqlite_session, mode=AppMode.WORKFLOW) for _ in range(3)]
    for i, app in enumerate(apps):
        workflow = Workflow(
            id=str(uuid4()),
            tenant_id=WORKSPACE if i != 1 else str(uuid4()),
            app_id=app.id,
            type=WorkflowType.WORKFLOW,
            version=Workflow.VERSION_DRAFT,
            graph="invalid"
            if i == 2
            else json.dumps(
                {
                    "nodes": [
                        {"id": "trigger", "data": {"type": "trigger-schedule"}},
                    ],
                    "edges": [],
                }
            ),
            features="{}",
            created_by=ACTOR,
        )
        sqlite_session.add(workflow)
    sqlite_session.commit()
    page = repository.list_apps(CONTEXT, AppListParams())
    flags = {app.id: app.has_draft_trigger for app in page.data}
    assert flags == {apps[0].id: True, apps[1].id: False, apps[2].id: False}
    assert AppPagination.model_validate(page, from_attributes=True).total == 3


def test_writes_use_explicit_actor_and_preserve_omitted_icon_type(
    repository: ConsoleAppRepository, sqlite_session: Session
) -> None:
    app = persist_app(sqlite_session, icon_type=IconType.IMAGE)
    result = repository.update(CONTEXT, app.id, UpdateAppParams(name="Updated"))
    assert result.icon_type == IconType.IMAGE
    assert result.updated_by == ACTOR
    sqlite_session.expire_all()
    persisted = sqlite_session.get(App, app.id)
    assert persisted is not None
    assert persisted.name == "Updated"


def test_trace_settings_commit_and_default(repository: ConsoleAppRepository, sqlite_session: Session) -> None:
    app = persist_app(sqlite_session)
    assert repository.get_trace(CONTEXT, app.id) == AppTraceSettings()
    settings = AppTraceSettings(True, "langfuse")
    repository.set_trace(CONTEXT, app.id, settings)
    assert repository.get_trace(CONTEXT, app.id) == settings
    repository.set_trace(CONTEXT, app.id, AppTraceSettings())
    assert repository.get_trace(CONTEXT, app.id) == AppTraceSettings()


def test_trace_settings_preserve_stored_json_validation(
    repository: ConsoleAppRepository, sqlite_session: Session
) -> None:
    app = persist_app(sqlite_session, tracing='{"enabled": "false", "obsolete_field": true}')
    assert repository.get_trace(CONTEXT, app.id) == AppTraceSettings()
