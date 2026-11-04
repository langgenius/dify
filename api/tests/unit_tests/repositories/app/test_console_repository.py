"""Short-session app persistence and tenant visibility regression tests."""

import json
from collections.abc import Callable
from dataclasses import asdict
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from flask import has_request_context
from sqlalchemy import Engine, delete, event, func, select, text, update
from sqlalchemy.orm import Session, sessionmaker

from fields.app_fields import AppPagination
from machinery.context import RequestContext
from models.account import Account, AccountStatus
from models.account_webapp import AccountWebApp
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.enums import CustomizeTokenStrategy, EndUserType
from models.model import App, AppMode, AppModelConfig, AppStar, EndUser, IconType, Site
from models.workflow import Workflow, WorkflowType
from repositories.app.console_repository import ConsoleAppRepository
from services.app.console_service import ConsoleAppNotFoundError
from services.app_tracing_config_service import AppTraceSettings
from services.consumer_service import ConsumerIdentity
from services.entities.app_entities import (
    AppListParams,
    AppRecord,
    StarredAppListParams,
    UpdateAppParams,
)
from tests.helpers.end_user_api_key import make_harness

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
    app = App()
    for key, value in values.items():
        setattr(app, key, value)
    session.add(app)
    session.commit()
    return app


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> ConsoleAppRepository:
    return ConsoleAppRepository(session_factory=sqlite_session_factory)


@pytest.mark.parametrize("case", ["visible", "missing", "disabled_api", "disabled_status", "foreign_workspace"])
def test_visible_app_lookup_checks_workspace_status_and_api(sqlite_session: Session, case: str) -> None:
    app = persist_app(sqlite_session, enable_api=case != "disabled_api")
    if case == "disabled_status":
        sqlite_session.execute(
            text("UPDATE apps SET status = :status WHERE id = :app_id"), {"status": "disabled", "app_id": app.id}
        )
        sqlite_session.commit()
    app_id = str(uuid4()) if case == "missing" else app.id
    tenant_id = str(uuid4()) if case == "foreign_workspace" else WORKSPACE

    result = ConsoleAppRepository.get_visible_app_by_id(app_id, sqlite_session, tenant_id=tenant_id)

    if case == "visible":
        assert result is app
    else:
        assert result is None


def test_visible_apps_bulk_lookup_preserves_cross_workspace_semantics(sqlite_session: Session) -> None:
    visible = persist_app(sqlite_session)
    foreign = persist_app(sqlite_session, tenant_id=str(uuid4()))
    disabled_api = persist_app(sqlite_session, enable_api=False)

    result = ConsoleAppRepository.find_visible_apps_by_ids(
        [visible.id, foreign.id, disabled_api.id, str(uuid4())], sqlite_session
    )

    assert {app.id for app in result} == {visible.id, foreign.id}


def test_visible_apps_bulk_lookup_skips_database_for_empty_ids(unbound_session: Session) -> None:
    assert ConsoleAppRepository.find_visible_apps_by_ids([], unbound_session) == []


def test_related_apps_materializes_scoped_records_and_closes_session(sqlite_engine: Engine) -> None:
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False, close_resets_only=False)
    with factory() as session:
        visible_id = persist_app(session, name="Visible").id
        disabled_id = persist_app(session, enable_api=False).id
        foreign_id = persist_app(session, tenant_id=str(uuid4())).id

    repository = ConsoleAppRepository(session_factory=factory)
    connections: set[object] = set()
    checkouts: list[object] = []

    def checkout(connection: object, *_args: object) -> None:
        connections.add(connection)
        checkouts.append(connection)

    def checkin(connection: object, *_args: object) -> None:
        connections.remove(connection)

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        related = repository.related_apps(WORKSPACE, [disabled_id, foreign_id, visible_id, str(uuid4())])
        assert [item.id for item in related] == [disabled_id, visible_id]
        assert all(isinstance(item, AppRecord) for item in related)
        assert not connections

        checkout_count = len(checkouts)
        assert checkout_count > 0
        assert asdict(related[1])["name"] == "Visible"
        serialized = AppPagination.model_validate(
            {"page": 1, "limit": 2, "total": 2, "has_more": False, "data": related}
        ).model_dump(mode="json")
        assert [item["id"] for item in serialized["data"]] == [disabled_id, visible_id]
        assert len(checkouts) == checkout_count
        assert not connections
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)


def test_rbac_maintainer_lookup_requires_owning_workspace(
    repository: ConsoleAppRepository, sqlite_session: Session
) -> None:
    app = persist_app(sqlite_session, maintainer=ACTOR)
    assert repository.get_maintainer_id(WORKSPACE, app.id) == ACTOR
    assert repository.get_maintainer_id("other-workspace", app.id) is None
    assert repository.get_maintainer_id(WORKSPACE, "missing") is None


@pytest.mark.parametrize("normal", [True, False])
def test_authorization_maintainer_requires_normal_app(
    repository: ConsoleAppRepository, sqlite_session: Session, normal: bool
) -> None:
    app = persist_app(sqlite_session, maintainer=ACTOR)
    if not normal:
        sqlite_session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": app.id})
        sqlite_session.commit()
    assert repository.get_maintainer_id(WORKSPACE, app.id) == ACTOR
    assert repository.get_maintainer_id(WORKSPACE, app.id, normal_only=True) == (ACTOR if normal else None)


@pytest.mark.parametrize(
    "operation",
    [
        lambda repo, ctx, app_id: repo.get(ctx, app_id),
        lambda repo, ctx, app_id: repo.rename(ctx, app_id, "Renamed"),
        lambda repo, ctx, app_id: repo.set_starred(ctx, app_id, True),
        lambda repo, ctx, app_id: repo.get_trace(ctx, app_id),
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
            _features="{}",
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


def test_openapi_visible_app_list_only_includes_apps_with_api_enabled(
    repository: ConsoleAppRepository, sqlite_session: Session
) -> None:
    visible = persist_app(sqlite_session, name="Visible")
    persist_app(sqlite_session, name="API disabled", enable_api=False)

    page = repository.list_apps(CONTEXT, AppListParams(openapi_visible=True))

    assert [app.id for app in page.data] == [visible.id]
    assert page.total == 1


def test_trace_settings_default(repository: ConsoleAppRepository, sqlite_session: Session) -> None:
    app = persist_app(sqlite_session)
    assert repository.get_trace(CONTEXT, app.id) == AppTraceSettings()


def test_trace_settings_preserve_stored_json_validation(
    repository: ConsoleAppRepository, sqlite_session: Session
) -> None:
    app = persist_app(sqlite_session, tracing='{"enabled": "false", "obsolete_field": true}')
    assert repository.get_trace(CONTEXT, app.id) == AppTraceSettings()


@pytest.mark.parametrize("empty_whitelist", [True, False])
def test_app_list_includes_maintained_apps_outside_whitelist(
    repository: ConsoleAppRepository, sqlite_session: Session, empty_whitelist: bool
) -> None:
    own = persist_app(sqlite_session, maintainer=ACTOR, created_by="other")
    allowed = persist_app(sqlite_session, maintainer="other")
    persist_app(sqlite_session, maintainer="other", created_by=ACTOR)
    persist_app(sqlite_session, maintainer=ACTOR, tenant_id=str(uuid4()))
    params = AppListParams(accessible_app_ids=[] if empty_whitelist else [allowed.id])

    page = repository.list_apps(CONTEXT, params)

    expected = {own.id} if empty_whitelist else {own.id, allowed.id}
    assert {app.id for app in page.data} == expected
    assert page.total == len(expected)


@pytest.mark.parametrize("status", [AccountStatus.ACTIVE, AccountStatus.UNINITIALIZED])
def test_first_app_usage_preserves_earliest_event_across_apps_and_removal(
    repository: ConsoleAppRepository, sqlite_session_factory: sessionmaker[Session], status: AccountStatus
) -> None:
    base = make_harness(sqlite_session_factory)
    other = make_harness(sqlite_session_factory)
    assert base.context.account_id is not None
    identity = ConsumerIdentity(base.context.account_id)
    moment = datetime(2026, 11, 4, 10)
    with sqlite_session_factory.begin() as session:
        session.execute(update(Account).where(Account.id == identity.account_id).values(status=status))
        session.execute(
            update(EndUser).where(EndUser.id == other.context.end_user_id).values(account_id=identity.account_id)
        )
    for app, used_at, earliest in (
        (base, moment, moment),
        (other, moment + timedelta(hours=1), moment),
        (other, moment - timedelta(hours=1), moment - timedelta(hours=1)),
        (base, moment, moment - timedelta(hours=1)),
    ):
        repository.record_consumer_usage(
            identity,
            tenant_id=app.context.tenant_id,
            app_id=app.context.app_id,
            end_user_id=app.context.end_user_id,
            used_at=used_at,
        )
        with sqlite_session_factory() as session:
            assert (
                session.scalar(select(Account.first_app_used_at).where(Account.id == identity.account_id)) == earliest
            )
    repository.remove(identity, base.context.app_id)
    with sqlite_session_factory.begin() as session:
        session.execute(delete(AccountWebApp).where(AccountWebApp.account_id == identity.account_id))
    repository.record_consumer_usage(
        identity,
        tenant_id=base.context.tenant_id,
        app_id=base.context.app_id,
        end_user_id=base.context.end_user_id,
        used_at=moment + timedelta(days=1),
    )
    with sqlite_session_factory() as session:
        assert session.scalar(select(Account.first_app_used_at).where(Account.id == identity.account_id)) == (
            moment - timedelta(hours=1)
        )
        assert session.scalar(select(Account.first_app_used_at).where(Account.id == other.context.account_id)) is None


@pytest.mark.parametrize("mismatch", ["account", "tenant", "app", "end_user", "type", "mode", "status", "guest"])
def test_invalid_consumer_usage_does_not_record_first_app_time(
    repository: ConsoleAppRepository, sqlite_session_factory: sessionmaker[Session], mismatch: str
) -> None:
    base = make_harness(sqlite_session_factory)
    assert base.context.account_id is not None
    identity = ConsumerIdentity(str(uuid4()) if mismatch == "account" else base.context.account_id)
    with sqlite_session_factory.begin() as session:
        if mismatch == "type":
            session.execute(
                update(EndUser).where(EndUser.id == base.context.end_user_id).values(type=EndUserType.SERVICE_API)
            )
        elif mismatch == "mode":
            session.execute(update(App).where(App.id == base.context.app_id).values(mode=AppMode.CHAT))
        elif mismatch == "status":
            session.execute(
                update(Account).where(Account.id == identity.account_id).values(status=AccountStatus.BANNED)
            )
        elif mismatch == "guest":
            session.execute(update(EndUser).where(EndUser.id == base.context.end_user_id).values(account_id=None))
    repository.record_consumer_usage(
        identity,
        tenant_id=str(uuid4()) if mismatch == "tenant" else base.context.tenant_id,
        app_id=str(uuid4()) if mismatch == "app" else base.context.app_id,
        end_user_id=str(uuid4()) if mismatch == "end_user" else base.context.end_user_id,
        used_at=datetime(2026, 11, 4),
    )
    with sqlite_session_factory() as session:
        assert session.scalar(select(Account.first_app_used_at).where(Account.id == base.context.account_id)) is None
        assert session.scalar(select(func.count()).select_from(AccountWebApp)) == 0
