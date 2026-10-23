from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.app.public_runtime import published_app_filter
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.enums import AppStatus, EndUserType
from models.enums import CustomizeTokenStrategy as _webapp_access_query_repository_CustomizeTokenStrategy
from models.model import App, AppMode, AppModelConfig, EndUser, Site
from models.model import CustomizeTokenStrategy as _public_app_availability_CustomizeTokenStrategy
from models.workflow import Workflow, WorkflowType
from repositories.web_passport_repository import WebPassportRepository
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository
from services.webapp_access_query_service import WebAppAccessUnavailableError

"""Exercise the shared public publication gate using real persisted owner chains."""


def _app(session: Session, mode: AppMode) -> App:
    app = App(
        id=str(uuid4()), tenant_id=str(uuid4()), name="Private fixture", mode=mode, enable_site=True, enable_api=True
    )
    session.add_all(
        [
            app,
            Site(
                app_id=app.id,
                code="public-code",
                title="private",
                default_language="en-US",
                customize_token_strategy=_public_app_availability_CustomizeTokenStrategy.UUID,
            ),
        ]
    )
    session.flush()
    return app


def _workflow(session: Session, app: App, *, version: str = "published") -> Workflow:
    workflow = Workflow(
        id=str(uuid4()),
        tenant_id=app.tenant_id,
        app_id=app.id,
        type=WorkflowType.WORKFLOW if app.mode == AppMode.WORKFLOW else WorkflowType.CHAT,
        version=version,
        graph='{"nodes":[]}',
        features="{}",
        created_by=str(uuid4()),
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    session.add(workflow)
    return workflow


def _agent(session: Session, app: App, *, published: bool) -> tuple[Agent, AgentConfigSnapshot]:
    agent = Agent(
        id=str(uuid4()),
        tenant_id=app.tenant_id,
        app_id=app.id,
        name="Private Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        active_config_is_published=published,
    )
    snapshot = AgentConfigSnapshot(
        id=str(uuid4()),
        tenant_id=app.tenant_id,
        agent_id=agent.id,
        version=1,
        home_snapshot_id=str(uuid4()),
        config_snapshot={},
    )
    agent.active_config_snapshot_id = snapshot.id
    session.add_all([agent, snapshot])
    if published:
        session.add(
            AgentConfigRevision(
                tenant_id=app.tenant_id,
                agent_id=agent.id,
                current_snapshot_id=snapshot.id,
                revision=1,
                operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
            )
        )
    return agent, snapshot


def _assert_readers(factory: sessionmaker[Session], app: App, expected: bool) -> None:
    access = WebAppAccessQueryRepository(session_factory=factory)
    assert access.find_app_id_by_code("public-code") == (app.id if expected else None)
    assert access.is_app_available(app.id) is expected
    passports = WebPassportRepository(session_factory=factory, generate_session_id=lambda: "never-created")
    record = passports.get_active_web_app("public-code")
    assert (record is not None) is expected


@pytest.mark.parametrize(
    "mode",
    [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT, AppMode.CHAT, AppMode.COMPLETION, AppMode.AGENT_CHAT, AppMode.AGENT],
)
@pytest.mark.parametrize("published", [False, True])
def test_all_public_app_modes_require_their_published_artifact(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], mode: AppMode, published: bool
) -> None:
    app = _app(sqlite_session, mode)
    if mode == AppMode.AGENT:
        _agent(sqlite_session, app, published=published)
    elif mode in (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT):
        draft = _workflow(sqlite_session, app, version="draft")
        if published:
            app.workflow_id = _workflow(sqlite_session, app).id
        assert draft.id != app.workflow_id
    elif published:
        config = AppModelConfig(app_id=app.id)
        config.id = str(uuid4())
        app.app_model_config_id = config.id
        sqlite_session.add(config)
    sqlite_session.commit()
    _assert_readers(sqlite_session_factory, app, published)


@pytest.mark.parametrize("invalid", ["draft-pointer", "missing", "other-app", "other-tenant"])
@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
def test_workflow_pointer_must_resolve_to_this_apps_published_workflow(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], mode: AppMode, invalid: str
) -> None:
    app = _app(sqlite_session, mode)
    workflow = _workflow(sqlite_session, app, version="draft" if invalid == "draft-pointer" else "published")
    app.workflow_id = str(uuid4()) if invalid == "missing" else workflow.id
    if invalid == "other-app":
        workflow.app_id = str(uuid4())
    if invalid == "other-tenant":
        workflow.tenant_id = str(uuid4())
    sqlite_session.commit()
    _assert_readers(sqlite_session_factory, app, False)


@pytest.mark.parametrize("invalid", ["missing", "other-app"])
def test_model_config_pointer_must_resolve_to_this_app(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], invalid: str
) -> None:
    app = _app(sqlite_session, AppMode.CHAT)
    config = AppModelConfig(app_id=app.id if invalid == "missing" else str(uuid4()))
    config.id = str(uuid4())
    app.app_model_config_id = str(uuid4()) if invalid == "missing" else config.id
    sqlite_session.add(config)
    sqlite_session.commit()
    _assert_readers(sqlite_session_factory, app, False)


@pytest.mark.parametrize(
    "state",
    [
        "dirty-draft",
        "seeded",
        "snapshot-missing",
        "snapshot-other-agent",
        "snapshot-other-tenant",
        "agent-other-tenant",
        "archived",
        "workflow-only",
    ],
)
def test_agent_publication_uses_owned_visible_snapshot_not_dirty_draft_flag(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], state: str
) -> None:
    app = _app(sqlite_session, AppMode.AGENT)
    agent, snapshot = _agent(sqlite_session, app, published=state != "seeded")
    # A seeded snapshot is not public even when an inconsistent dirty flag says otherwise.
    agent.active_config_is_published = state == "seeded"
    if state == "snapshot-missing":
        agent.active_config_snapshot_id = str(uuid4())
    elif state == "snapshot-other-agent":
        snapshot.agent_id = str(uuid4())
    elif state == "snapshot-other-tenant":
        snapshot.tenant_id = str(uuid4())
    elif state == "agent-other-tenant":
        agent.tenant_id = str(uuid4())
    elif state == "archived":
        agent.status = AgentStatus.ARCHIVED
    elif state == "workflow-only":
        agent.scope = AgentScope.WORKFLOW_ONLY
        agent.backing_app_id = app.id
    sqlite_session.commit()
    _assert_readers(sqlite_session_factory, app, state == "dirty-draft")


def test_public_predicate_does_not_change_management_visibility(sqlite_session: Session) -> None:
    app = _app(sqlite_session, AppMode.ADVANCED_CHAT)
    draft = _workflow(sqlite_session, app, version="draft")
    sqlite_session.commit()
    assert sqlite_session.scalar(select(App.id).where(App.id == app.id, published_app_filter())) is None
    assert sqlite_session.get(App, app.id) is app
    assert sqlite_session.get(Workflow, draft.id) is draft


_APP_ID = "11111111-1111-1111-1111-111111111111"
_TENANT_ID = "22222222-2222-2222-2222-222222222222"
_END_USER_ID = "33333333-3333-3333-3333-333333333333"
_OTHER_APP_ID = "44444444-4444-4444-4444-444444444444"
_OTHER_TENANT_ID = "55555555-5555-5555-5555-555555555555"


def _persist_webapp_session(session: Session, *, enable_site: bool = True) -> None:
    session.add(
        App(
            id=_APP_ID,
            tenant_id=_TENANT_ID,
            name="Session App",
            description="",
            mode=AppMode.CHAT,
            icon_type=None,
            icon=None,
            icon_background=None,
            enable_site=enable_site,
            enable_api=True,
        )
    )
    session.add(
        Site(
            app_id=_APP_ID,
            code="site-code",
            title="Test Site",
            default_language="en-US",
            customize_token_strategy=_webapp_access_query_repository_CustomizeTokenStrategy.UUID,
        )
    )
    session.add(
        EndUser(
            id=_END_USER_ID,
            tenant_id=_TENANT_ID,
            app_id=_APP_ID,
            type=EndUserType.BROWSER,
            session_id="browser-session",
        )
    )
    session.commit()


def test_find_app_id_by_code_returns_matching_site_app(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        config = AppModelConfig(app_id=_APP_ID)
        config.id = "22222222-2222-2222-2222-222222222222"
        session.add(config)
        session.add(
            App(
                id=_APP_ID,
                tenant_id=_APP_ID,
                name="Test App",
                mode="chat",
                enable_site=True,
                enable_api=True,
                app_model_config_id=config.id,
            )
        )
        session.add(
            Site(
                app_id=_APP_ID,
                code="site-code",
                title="Test Site",
                default_language="en-US",
                customize_token_strategy=_webapp_access_query_repository_CustomizeTokenStrategy.UUID,
            )
        )

    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    assert repository.find_app_id_by_code("site-code") == _APP_ID
    assert repository.is_app_available(_APP_ID) is True


@pytest.mark.parametrize("disabled", ["app", "deleted-app"])
def test_inactive_or_dangling_site_does_not_resolve_as_public_app(
    sqlite_session_factory: sessionmaker[Session], disabled: str
) -> None:
    with sqlite_session_factory.begin() as session:
        if disabled != "deleted-app":
            config = AppModelConfig(app_id=_APP_ID)
            config.id = "22222222-2222-2222-2222-222222222222"
            session.add(config)
            session.add(
                App(
                    id=_APP_ID,
                    tenant_id=_APP_ID,
                    name="Test App",
                    mode="chat",
                    enable_site=disabled != "app",
                    enable_api=True,
                    app_model_config_id=config.id,
                )
            )
        session.add(
            Site(
                app_id=_APP_ID,
                code="hidden",
                title="Hidden",
                status=AppStatus.NORMAL,
                default_language="en-US",
                customize_token_strategy=_webapp_access_query_repository_CustomizeTokenStrategy.UUID,
            )
        )
    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)
    assert repository.find_app_id_by_code("hidden") is None
    assert repository.is_app_available(_APP_ID) is False


def test_malformed_app_id_is_not_a_database_error() -> None:
    factory = MagicMock()
    repository = WebAppAccessQueryRepository(session_factory=factory)
    assert repository.is_app_available("not-an-app-id") is False
    factory.assert_not_called()


def test_app_id_database_failure_remains_unavailable(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine
) -> None:
    database_error = OperationalError("select", {}, RuntimeError("connection failed"))

    def fail_query(*_args: object) -> None:
        raise database_error

    event.listen(sqlite_engine, "before_cursor_execute", fail_query)
    try:
        repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)
        with pytest.raises(WebAppAccessUnavailableError) as raised:
            repository.is_app_available(_APP_ID)
        assert raised.value.__cause__ is database_error
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", fail_query)


def test_find_app_id_by_code_returns_none_for_missing_code(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    assert repository.find_app_id_by_code("missing-code") is None


def test_find_active_session_returns_framework_neutral_record(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_webapp_session(sqlite_session)
    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    record = repository.find_active_session(
        app_id=_APP_ID,
        app_code="site-code",
        end_user_id=_END_USER_ID,
    )

    assert record is not None
    assert record.end_user_session_id == "browser-session"


def test_find_active_session_rejects_disabled_app(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_webapp_session(sqlite_session, enable_site=False)
    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    assert (
        repository.find_active_session(
            app_id=_APP_ID,
            app_code="site-code",
            end_user_id=_END_USER_ID,
        )
        is None
    )


@pytest.mark.parametrize(
    ("site_app_id", "end_user_app_id", "end_user_tenant_id"),
    [
        pytest.param(_OTHER_APP_ID, _APP_ID, _TENANT_ID, id="site-app-mismatch"),
        pytest.param(_APP_ID, _OTHER_APP_ID, _TENANT_ID, id="end-user-app-mismatch"),
        pytest.param(_APP_ID, _APP_ID, _OTHER_TENANT_ID, id="end-user-tenant-mismatch"),
    ],
)
def test_find_active_session_rejects_mismatched_owners(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    site_app_id: str,
    end_user_app_id: str,
    end_user_tenant_id: str,
) -> None:
    _persist_webapp_session(sqlite_session)
    with sqlite_session_factory.begin() as session:
        session.add(
            App(
                id=_OTHER_APP_ID,
                tenant_id=_TENANT_ID,
                name="Other App",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=True,
            )
        )
        site = session.scalar(select(Site).where(Site.code == "site-code"))
        end_user = session.get(EndUser, _END_USER_ID)
        assert site is not None
        assert end_user is not None
        site.app_id = site_app_id
        end_user.app_id = end_user_app_id
        end_user.tenant_id = end_user_tenant_id

    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    assert (
        repository.find_active_session(
            app_id=_APP_ID,
            app_code="site-code",
            end_user_id=_END_USER_ID,
        )
        is None
    )


@pytest.mark.parametrize(
    ("app_id", "app_code", "end_user_id"),
    [
        pytest.param(_OTHER_APP_ID, "site-code", _END_USER_ID, id="missing-app"),
        pytest.param(_APP_ID, "missing-code", _END_USER_ID, id="missing-site"),
        pytest.param(_APP_ID, "site-code", "66666666-6666-6666-6666-666666666666", id="missing-end-user"),
    ],
)
def test_find_active_session_rejects_missing_records(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    app_id: str,
    app_code: str,
    end_user_id: str,
) -> None:
    _persist_webapp_session(sqlite_session)
    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    assert repository.find_active_session(app_id=app_id, app_code=app_code, end_user_id=end_user_id) is None


def test_find_app_id_by_code_maps_database_failures_to_unavailable(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    database_error = OperationalError("select", {}, RuntimeError("connection failed"))
    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    with (
        patch.object(Session, "scalar", side_effect=database_error),
        pytest.raises(WebAppAccessUnavailableError) as raised,
    ):
        repository.find_app_id_by_code("site-code")

    assert raised.value.__cause__ is database_error


def test_find_app_id_by_code_does_not_hide_unknown_errors(sqlite_session_factory: sessionmaker[Session]) -> None:
    failure = TypeError("repository bug")
    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    with patch.object(Session, "scalar", side_effect=failure), pytest.raises(TypeError) as raised:
        repository.find_app_id_by_code("site-code")

    assert raised.value is failure
