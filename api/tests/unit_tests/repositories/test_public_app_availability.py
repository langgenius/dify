"""Exercise the shared public publication gate using real persisted owner chains."""

from uuid import uuid4

import pytest
from sqlalchemy import select
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
from models.model import App, AppMode, AppModelConfig, CustomizeTokenStrategy, Site
from models.workflow import Workflow, WorkflowType
from repositories.web_passport_repository import WebPassportRepository
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository


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
                customize_token_strategy=CustomizeTokenStrategy.UUID,
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
