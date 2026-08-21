from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from enums import DeploymentEdition
from graphon.model_runtime.entities.model_entities import ModelType
from models import Account, Tenant
from models.account import TenantAccountJoin, TenantAccountRole
from models.agent import (
    Agent,
    AgentIconType,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.model import App, AppMode, AppModelConfig, IconType
from models.workflow import Workflow, WorkflowType
from services.agent.errors import AgentAccessNotReadyError, AgentNameConflictError
from services.app_service import AppListParams, AppService, CreateAppParams


def _persist_account(session: Session) -> Account:
    tenant = Tenant(name="App Service Workspace")
    account = Account(name="Test Account", email=f"app-service-{uuid4()}@example.com")
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        current=True,
        role=TenantAccountRole.OWNER,
    )
    account._current_tenant = tenant
    session.add_all([tenant, account, membership])
    session.commit()
    return account


def _account_identity(account_id: str) -> Account:
    account = Account(name="Current User", email=f"{account_id}@example.com")
    account.id = account_id
    return account


def _persist_app(session: Session, *, tenant_id: str, name: str = "Visible App") -> App:
    app = App(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=name,
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#FFFFFF",
        enable_site=False,
        enable_api=False,
    )
    session.add(app)
    session.commit()
    return app


def _persist_agent_app(session: Session, *, app_name: str = "Old", agent_name: str = "Old") -> tuple[App, Agent]:
    tenant_id = str(uuid4())
    creator_id = str(uuid4())
    app = App(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=app_name,
        description="old",
        mode=AppMode.AGENT,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#fff",
        enable_site=False,
        enable_api=False,
        created_by=creator_id,
    )
    agent = Agent(
        tenant_id=tenant_id,
        name=agent_name,
        description="old",
        role="research assistant",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        icon_type=AgentIconType.EMOJI,
        icon="robot",
        icon_background="#fff",
        app_id=app.id,
        created_by=creator_id,
    )
    session.add_all([app, agent])
    session.commit()
    return app, agent


class TestCreateAppTransactionBoundary:
    def test_commits_database_state_before_external_side_effects(
        self, sqlite_session: Session, config_overrides: Callable[..., None]
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        account = _persist_account(sqlite_session)
        phase_events: list[str] = []
        event.listen(sqlite_session, "after_commit", lambda _session: phase_events.append("commit"))

        with (
            patch(
                "services.app_service.app_was_created.send",
                side_effect=lambda *_args, **_kwargs: phase_events.append("signal"),
            ),
            patch(
                "services.app_service.enterprise_rbac_service.try_sync_creator_access_policy_member_bindings",
                side_effect=lambda *_args: phase_events.append("external"),
            ),
            patch(
                "services.app_service.FeatureService.get_system_features",
                return_value=SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
            ),
        ):
            app = AppService().create_app(
                account.current_tenant_id,
                CreateAppParams(name="Workflow", mode=AppMode.WORKFLOW.value),
                account,
                session=sqlite_session,
            )

        assert phase_events == ["commit", "signal", "commit", "external"]
        assert sqlite_session.get(App, app.id) is app

    def test_duplicate_agent_name_rolls_back_and_raises_conflict(self, sqlite_session: Session) -> None:
        account = _persist_account(sqlite_session)
        tenant_id = account.current_tenant_id or ""
        existing_agent = Agent(
            tenant_id=tenant_id,
            name="Existing Agent",
            description="existing",
            role="",
            scope=AgentScope.ROSTER,
            source=AgentSource.ROSTER,
            status=AgentStatus.ACTIVE,
        )
        sqlite_session.add(existing_agent)
        sqlite_session.commit()
        rollback_events: list[str] = []
        event.listen(sqlite_session, "after_rollback", lambda _session: rollback_events.append("rollback"))

        with pytest.raises(AgentNameConflictError):
            AppService().create_app(
                tenant_id,
                CreateAppParams(name="Existing Agent", mode=AppMode.AGENT.value),
                account,
                session=sqlite_session,
            )

        assert rollback_events == ["rollback"]
        assert sqlite_session.scalars(select(App).where(App.tenant_id == tenant_id)).all() == []
        assert sqlite_session.scalars(select(AppModelConfig)).all() == []
        assert sqlite_session.get(Agent, existing_agent.id) is existing_agent

    def test_falls_back_when_default_model_schema_is_unavailable(
        self, sqlite_session: Session, config_overrides: Callable[..., None]
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        account = _persist_account(sqlite_session)
        model_type_instance = MagicMock()
        model_type_instance.get_model_schema.side_effect = ValueError("Base model unknown-model not found")
        model_instance = SimpleNamespace(
            model_name="unknown-model",
            provider="langgenius/openai/openai",
            credentials={},
            model_type_instance=model_type_instance,
        )
        model_manager = MagicMock()
        model_manager.get_default_model_instance.return_value = model_instance
        model_manager.get_default_provider_model_name.return_value = ("openai", "gpt-4o")
        with (
            patch("services.app_service.ModelManager.for_tenant", return_value=model_manager),
            patch("services.app_service.app_was_created.send"),
            patch("services.app_service.enterprise_rbac_service.try_sync_creator_access_policy_member_bindings"),
            patch(
                "services.app_service.FeatureService.get_system_features",
                return_value=SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
            ),
        ):
            app = AppService().create_app(
                account.current_tenant_id,
                CreateAppParams(name="Chat", mode=AppMode.CHAT.value),
                account,
                session=sqlite_session,
            )

        app_model_config = sqlite_session.get(AppModelConfig, app.app_model_config_id)
        assert app_model_config is not None
        assert app.mode == AppMode.CHAT
        assert app_model_config.model_dict == {
            "provider": "openai",
            "name": "gpt-4o",
            "mode": "chat",
            "completion_params": {},
        }
        model_manager.get_default_provider_model_name.assert_called_once_with(
            tenant_id=account.current_tenant_id, model_type=ModelType.LLM
        )


@pytest.mark.parametrize(
    "update_status",
    [AppService.update_app_site_status, AppService.update_app_api_status],
)
def test_app_status_updates_commit_before_signal(update_status: Callable[..., App], sqlite_session: Session) -> None:
    account = _persist_account(sqlite_session)
    app = _persist_app(sqlite_session, tenant_id=account.current_tenant_id or "")
    phase_events: list[str] = []
    event.listen(sqlite_session, "after_commit", lambda _session: phase_events.append("commit"))

    with (
        patch("services.app_service.current_user", account),
        patch("services.app_service.app_was_updated.send", side_effect=lambda *_args: phase_events.append("signal")),
    ):
        update_status(AppService(), app, True, session=sqlite_session)

    assert phase_events == ["commit", "signal"]


@pytest.mark.parametrize(
    "update_status",
    [
        AppService.update_app_site_status,
        AppService.update_app_api_status,
    ],
)
def test_unpublished_agent_app_access_cannot_be_enabled(
    update_status: Callable[..., App], sqlite_session: Session
) -> None:
    app, _ = _persist_agent_app(sqlite_session)
    commits: list[str] = []
    event.listen(sqlite_session, "after_commit", lambda _session: commits.append("commit"))

    with patch("services.app_service.agent_has_workflow_callable_active_snapshot", return_value=False):
        with pytest.raises(AgentAccessNotReadyError):
            update_status(AppService(), app, True, session=sqlite_session)

    assert app.enable_site is False
    assert app.enable_api is False
    assert commits == []


class TestOpenapiVisibilityHelpers:
    """Coverage for the session-injected, openapi-visibility-scoped
    ``AppService`` getters used by ``/openapi/v1/apps*``. These helpers
    centralise the "row exists + status normal + openapi-visibility
    gate passes" check so the controller can stay free of SQL.
    """

    def test_get_app_by_id_is_plain_session_get(self, sqlite_session: Session):
        """``get_app_by_id`` must NOT apply status / visibility filters
        — callers (e.g. the openapi auth pipeline) need to differentiate
        404 (missing) from 403 (``enable_api`` off) and would lose that
        signal if the helper coalesced both into ``None``.
        """
        sentinel_app = _persist_app(sqlite_session, tenant_id=str(uuid4()))
        sentinel_app.status = "archived"  # type: ignore[assignment]

        assert AppService.get_app_by_id(sentinel_app.id, sqlite_session) is sentinel_app

    def test_get_app_by_id_returns_none_when_missing(self, sqlite_session: Session):
        assert AppService.get_app_by_id(str(uuid4()), sqlite_session) is None

    def test_get_visible_app_by_id_returns_app_when_visible(self, sqlite_session: Session):
        app = _persist_app(sqlite_session, tenant_id=str(uuid4()))

        with patch("services.app_service.is_openapi_visible", return_value=True):
            assert AppService.get_visible_app_by_id(app.id, sqlite_session) is app

    def test_get_visible_app_by_id_returns_none_when_row_missing(self, sqlite_session: Session):
        assert AppService.get_visible_app_by_id(str(uuid4()), sqlite_session) is None

    def test_get_visible_app_by_id_returns_none_when_status_not_normal(self, sqlite_session: Session):
        """Soft-deleted/archived rows must not surface on the openapi
        surface — the helper hides them by returning ``None``.
        """
        app = _persist_app(sqlite_session, tenant_id=str(uuid4()))
        app.status = "archived"  # type: ignore[assignment]

        with patch("services.app_service.is_openapi_visible", return_value=True):
            assert AppService.get_visible_app_by_id(app.id, sqlite_session) is None

    def test_get_visible_app_by_id_returns_none_when_visibility_gate_rejects(self, sqlite_session: Session):
        """``is_openapi_visible`` is the per-row counterpart to
        ``apply_openapi_gate`` — when it returns False the helper must
        treat the row as invisible (not "found but unauthorized").
        """
        app = _persist_app(sqlite_session, tenant_id=str(uuid4()))

        with patch("services.app_service.is_openapi_visible", return_value=False):
            assert AppService.get_visible_app_by_id(app.id, sqlite_session) is None

    def test_find_visible_apps_by_name_returns_scalars_through_visibility_gate(self, sqlite_session: Session):
        """Tenant-scoped name lookup. The helper passes the SELECT through
        ``apply_openapi_gate`` and materialises ``.scalars()`` into a list
        so the controller can branch on length (404 / single / 409).
        """
        tenant_id = str(uuid4())
        rows = [
            _persist_app(sqlite_session, tenant_id=tenant_id, name="my-app"),
            _persist_app(sqlite_session, tenant_id=tenant_id, name="my-app"),
        ]
        _persist_app(sqlite_session, tenant_id=str(uuid4()), name="my-app")

        with patch("services.app_service.apply_openapi_gate", side_effect=lambda q: q) as gate:
            out = AppService.find_visible_apps_by_name(name="my-app", tenant_id=tenant_id, session=sqlite_session)

        assert {app.id for app in out} == {app.id for app in rows}
        # Visibility gate must wrap the SELECT exactly once.
        gate.assert_called_once()

    def test_find_visible_apps_by_name_returns_empty_list_on_no_match(self, sqlite_session: Session):
        with patch("services.app_service.apply_openapi_gate", side_effect=lambda q: q):
            out = AppService.find_visible_apps_by_name(name="nope", tenant_id=str(uuid4()), session=sqlite_session)

        assert out == []

    def test_find_visible_apps_by_ids_short_circuits_on_empty_input(self, unbound_session: Session):
        """Empty id list must not emit ``WHERE id IN ()`` — Postgres
        rejects empty IN lists and the call is a guaranteed no-op
        anyway. The helper returns ``[]`` without touching the session.
        """
        assert AppService.find_visible_apps_by_ids([], unbound_session) == []

    def test_find_visible_apps_by_ids_passes_through_visibility_gate(self, sqlite_session: Session):
        """Bulk fetch routes through ``apply_openapi_gate`` exactly once
        and materialises the scalar rows. **No** status filter is
        applied here — the EE permitted-external pipeline filters
        non-normal hits in Python so its page count stays anchored.
        """
        rows = [_persist_app(sqlite_session, tenant_id=str(uuid4())) for _ in range(2)]

        with patch("services.app_service.apply_openapi_gate", side_effect=lambda q: q) as gate:
            out = AppService.find_visible_apps_by_ids([app.id for app in rows], sqlite_session)

        assert {app.id for app in out} == {app.id for app in rows}
        gate.assert_called_once()


def test_get_recent_apps_uses_one_tenant_scoped_projection_query(sqlite_session: Session) -> None:
    tenant_id = str(uuid4())
    other_tenant_id = str(uuid4())
    account = Account(name="Recent Apps Author", email="recent-apps@example.com")
    sqlite_session.add(account)
    sqlite_session.flush()

    def create_app(*, name: str, tenant_id: str, updated_at: datetime, mode: AppMode = AppMode.CHAT) -> App:
        app = App(
            id=str(uuid4()),
            tenant_id=tenant_id,
            name=name,
            description="",
            mode=mode,
            icon_type=IconType.EMOJI,
            icon="🚀",
            icon_background="#FFFFFF",
            enable_site=False,
            enable_api=False,
            created_by=account.id,
            maintainer=account.id,
            created_at=updated_at,
            updated_at=updated_at,
            use_icon_as_answer_icon=False,
        )
        return app

    newest = create_app(name="Newest", tenant_id=tenant_id, updated_at=datetime(2026, 7, 3))
    legacy_agent = AppModelConfig(
        app_id=newest.id,
        agent_mode='{"enabled": true, "strategy": "react"}',
    )
    newest.app_model_config_id = legacy_agent.id
    second = create_app(
        name="Second",
        tenant_id=tenant_id,
        updated_at=datetime(2026, 7, 2),
        mode=AppMode.WORKFLOW,
    )
    second.icon_type = None
    second.icon = None
    second.icon_background = None
    second.created_by = None
    second.maintainer = None
    channel = create_app(
        name="Channel",
        tenant_id=tenant_id,
        updated_at=datetime(2026, 7, 5),
        mode=AppMode.CHANNEL,
    )
    rag_pipeline = create_app(
        name="RAG Pipeline",
        tenant_id=tenant_id,
        updated_at=datetime(2026, 7, 4),
        mode=AppMode.RAG_PIPELINE,
    )
    oldest = create_app(name="Oldest", tenant_id=tenant_id, updated_at=datetime(2026, 7, 1))
    foreign = create_app(name="Foreign", tenant_id=other_tenant_id, updated_at=datetime(2026, 7, 4))
    sqlite_session.add_all([newest, legacy_agent, second, channel, rag_pipeline, oldest, foreign])
    sqlite_session.commit()

    statements: list[str] = []
    bind = sqlite_session.get_bind()

    def record_sql(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(bind, "before_cursor_execute", record_sql)
    try:
        recent_apps = AppService().get_recent_apps(
            account.id,
            tenant_id,
            AppListParams(limit=2),
            sqlite_session,
        )
    finally:
        event.remove(bind, "before_cursor_execute", record_sql)

    assert [(app.name, app.mode, app.icon_type, app.author_name, app.maintainer) for app in recent_apps] == [
        ("Newest", AppMode.CHAT, IconType.EMOJI, "Recent Apps Author", account.id),
        ("Second", AppMode.WORKFLOW, None, None, None),
    ]
    select_statements = [statement for statement in statements if statement.lstrip().upper().startswith("SELECT")]
    assert len(select_statements) == 1
    assert "count(" not in select_statements[0].lower()
    assert "app_model_configs" not in select_statements[0].lower()


class TestGetApp:
    def test_legacy_agent_detection_uses_caller_session(self, unbound_session: Session):
        app = App(
            mode=AppMode.CHAT,
        )
        account = Account(name="Test Account", email="test@example.com")
        account._current_tenant = Tenant(name="Test Tenant")
        account._current_tenant.id = "tenant-1"

        with (
            patch.object(App, "is_agent_with_session", return_value=False) as is_agent,
            patch.object(App, "app_model_config_with_session") as get_model_config,
            patch("services.app_service.current_user", account),
        ):
            assert AppService().get_app(app, session=unbound_session) is app

        is_agent.assert_called_once_with(session=unbound_session)
        get_model_config.assert_not_called()

    def test_agent_model_config_uses_caller_session(self, unbound_session: Session):
        app = App(
            mode=AppMode.AGENT_CHAT,
        )
        account = Account(name="Test Account", email="test@example.com")
        account._current_tenant = Tenant(name="Test Tenant")
        account._current_tenant.id = "tenant-1"

        with (
            patch.object(App, "is_agent_with_session") as is_agent,
            patch.object(App, "app_model_config_with_session", return_value=None) as get_model_config,
            patch("services.app_service.current_user", account),
        ):
            assert AppService().get_app(app, session=unbound_session) is app

        is_agent.assert_not_called()
        get_model_config.assert_called_once_with(session=unbound_session)


class TestAgentAppType:
    """S1: new ``AppMode.AGENT`` app type wiring."""

    def test_agent_mode_enum_and_template_exist(self):
        from constants.model_template import default_app_templates
        from models.model import AppMode

        assert AppMode.AGENT.value == "agent"
        assert AppMode.AGENT in default_app_templates
        # Runtime config comes from the Agent Soul, so no model_config is seeded.
        assert "model_config" not in default_app_templates[AppMode.AGENT]
        assert default_app_templates[AppMode.AGENT]["app"]["mode"] == AppMode.AGENT
        assert default_app_templates[AppMode.AGENT]["app"]["enable_site"] is False
        assert default_app_templates[AppMode.AGENT]["app"]["enable_api"] is False

    def test_create_app_params_accepts_agent_mode(self):
        from services.app_service import CreateAppParams

        params = CreateAppParams(name="Iris", mode="agent")
        assert params.mode == "agent"

    def test_bound_agent_id_is_none_for_non_agent_app(self):
        """Non-agent apps short-circuit without touching the DB."""
        from models.model import App, AppMode

        app = App(
            mode=AppMode.CHAT,
        )
        assert app.bound_agent_id is None

    def test_update_agent_app_syncs_backing_agent_identity(self, sqlite_session: Session):
        app, backing_agent = _persist_agent_app(sqlite_session)
        account_id = str(uuid4())

        with (
            patch("services.app_service.current_user", _account_identity(account_id)),
            patch("services.app_service.app_was_updated.send"),
        ):
            updated_app = AppService().update_app(
                app,
                {
                    "name": "Iris",
                    "description": "agent app",
                    "role": "research assistant",
                    "icon_type": "image",
                    "icon": "file-id",
                    "icon_background": "#123456",
                    "use_icon_as_answer_icon": False,
                    "max_active_requests": 0,
                },
                session=sqlite_session,
            )

        assert updated_app.name == "Iris"
        assert backing_agent.name == "Iris"
        assert backing_agent.description == "agent app"
        assert backing_agent.role == "research assistant"
        assert backing_agent.icon_type == AgentIconType.IMAGE
        assert backing_agent.icon == "file-id"
        assert backing_agent.icon_background == "#123456"
        assert backing_agent.updated_by == account_id
        assert backing_agent.updated_at == updated_app.updated_at

    def test_update_agent_app_preserves_role_when_args_omit_it(self, sqlite_session: Session):
        app, backing_agent = _persist_agent_app(sqlite_session)

        with (
            patch("services.app_service.current_user", _account_identity(str(uuid4()))),
            patch("services.app_service.app_was_updated.send"),
        ):
            AppService().update_app(
                app,
                {
                    "name": "Iris",
                    "description": "agent app",
                    "icon_type": "image",
                    "icon": "file-id",
                    "icon_background": "#123456",
                    "use_icon_as_answer_icon": False,
                    "max_active_requests": 0,
                },
                session=sqlite_session,
            )

        assert backing_agent.role == "research assistant"

    def test_update_agent_app_clears_role_when_args_set_empty_string(self, sqlite_session: Session):
        app, backing_agent = _persist_agent_app(sqlite_session)

        with (
            patch("services.app_service.current_user", _account_identity(str(uuid4()))),
            patch("services.app_service.app_was_updated.send"),
        ):
            AppService().update_app(
                app,
                {
                    "name": "Iris",
                    "description": "agent app",
                    "role": "",
                    "icon_type": "image",
                    "icon": "file-id",
                    "icon_background": "#123456",
                    "use_icon_as_answer_icon": False,
                    "max_active_requests": 0,
                },
                session=sqlite_session,
            )

        assert backing_agent.role == ""

    def test_update_agent_app_duplicate_name_rolls_back_and_raises_conflict(self, sqlite_session: Session):
        app, backing_agent = _persist_agent_app(sqlite_session)
        existing = Agent(
            tenant_id=app.tenant_id,
            name="Existing Agent",
            description="existing",
            role="",
            scope=AgentScope.ROSTER,
            source=AgentSource.ROSTER,
            status=AgentStatus.ACTIVE,
        )
        sqlite_session.add(existing)
        sqlite_session.commit()
        rollback_events: list[str] = []
        event.listen(sqlite_session, "after_rollback", lambda _session: rollback_events.append("rollback"))

        with (
            patch("services.app_service.current_user", _account_identity(str(uuid4()))),
            patch("services.app_service.app_was_updated.send"),
        ):
            with pytest.raises(AgentNameConflictError):
                AppService().update_app(
                    app,
                    {
                        "name": "Existing Agent",
                        "description": "agent app",
                        "role": "research assistant",
                        "icon_type": "emoji",
                        "icon": "robot",
                        "icon_background": "#fff",
                        "use_icon_as_answer_icon": False,
                        "max_active_requests": 0,
                    },
                    session=sqlite_session,
                )

        assert rollback_events == ["rollback"]
        sqlite_session.expire_all()
        assert sqlite_session.get(Agent, backing_agent.id).name == "Old"  # type: ignore[union-attr]

    def test_delete_agent_app_archives_backing_agent(self, sqlite_session: Session):
        app, backing_agent = _persist_agent_app(sqlite_session)
        workflow_app = _persist_app(sqlite_session, tenant_id=app.tenant_id, name="Workflow")
        workflow_app.mode = AppMode.WORKFLOW
        referencing_workflow = Workflow.new(
            tenant_id=app.tenant_id,
            app_id=workflow_app.id,
            type=WorkflowType.WORKFLOW.value,
            version=Workflow.VERSION_DRAFT,
            graph="{}",
            features="{}",
            created_by="account-1",
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        workflow_binding = WorkflowAgentNodeBinding(
            tenant_id=app.tenant_id,
            app_id=workflow_app.id,
            workflow_id=referencing_workflow.id,
            workflow_version=referencing_workflow.version,
            node_id="agent-node",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id=backing_agent.id,
            current_snapshot_id="snapshot-1",
            node_job_config={},
        )
        workflow_agents = [
            Agent(
                tenant_id=app.tenant_id,
                name=f"Workflow Agent {index}",
                description="",
                role="",
                scope=AgentScope.WORKFLOW_ONLY,
                source=AgentSource.WORKFLOW,
                status=AgentStatus.ACTIVE,
                app_id=app.id,
                workflow_id=str(uuid4()),
                workflow_node_id=f"node-{index}",
            )
            for index in range(2)
        ]
        sqlite_session.add_all([referencing_workflow, workflow_binding, *workflow_agents])
        sqlite_session.commit()
        account_id = str(uuid4())
        events: list[str] = []
        event.listen(sqlite_session, "after_commit", lambda _session: events.append("commit"))

        with (
            patch("services.app_service.current_user", _account_identity(account_id)),
            patch("services.app_service.app_was_deleted.send"),
            patch("services.app_service.BillingService"),
            patch("services.app_service.EnterpriseService"),
            patch("services.app_service.FeatureService"),
            patch(
                "services.app_service.remove_app_and_related_data_task.delay",
                side_effect=lambda **_kwargs: events.append("enqueue-app-cleanup"),
            ),
            patch(
                "services.app_service.AgentHomeSnapshotService.retire_all_for_agent",
                return_value=["home-1"],
            ) as mock_retire_homes,
            patch(
                "services.app_service.AgentWorkspaceService.retire_all_for_app",
                side_effect=lambda **_kwargs: events.append("retire-app-workspaces") or ["workspace-1"],
            ) as mock_retire_workspaces,
            patch(
                "services.app_service.WorkflowAgentRetirementService.retire_unowned",
                side_effect=lambda **_kwargs: events.append("retire-workflow-agents"),
            ) as mock_workflow_retirement,
            patch(
                "services.app_service.enqueue_agent_resource_collection",
                side_effect=lambda **_kwargs: events.append("enqueue"),
            ) as mock_enqueue_collection,
        ):
            AppService().delete_app(app, session=sqlite_session)

        assert events == [
            "retire-app-workspaces",
            "commit",
            "enqueue-app-cleanup",
            "retire-workflow-agents",
            "enqueue",
        ]
        sqlite_session.expire_all()
        persisted_agent = sqlite_session.get(Agent, backing_agent.id)
        assert persisted_agent is not None
        assert sqlite_session.get(App, app.id) is None
        assert persisted_agent.status == AgentStatus.ARCHIVED
        assert persisted_agent.archived_by == account_id
        assert persisted_agent.archived_at is not None
        persisted_workflow_binding = sqlite_session.get(WorkflowAgentNodeBinding, workflow_binding.id)
        assert persisted_workflow_binding is not None
        assert persisted_workflow_binding.agent_id == backing_agent.id
        mock_workflow_retirement.assert_called_once_with(
            tenant_id=app.tenant_id,
            agent_ids={agent.id for agent in workflow_agents},
            account_id=account_id,
        )
        mock_retire_workspaces.assert_called_once_with(
            session=sqlite_session,
            tenant_id=app.tenant_id,
            app_id=app.id,
        )
        mock_retire_homes.assert_called_once_with(
            session=sqlite_session,
            tenant_id=app.tenant_id,
            agent_id=backing_agent.id,
        )
        mock_enqueue_collection.assert_called_once_with(
            tenant_id=app.tenant_id,
            workspace_ids=["workspace-1"],
            binding_ids=[],
            home_snapshot_ids=["home-1"],
            purge_agent_ids=[backing_agent.id],
        )

    def test_delete_app_commit_failure_does_not_retire_workflow_agents_or_enqueue(self, sqlite_session: Session):
        app = _persist_app(sqlite_session, tenant_id=str(uuid4()))
        app.mode = AppMode.WORKFLOW
        workflow_agent = Agent(
            tenant_id=app.tenant_id,
            name="Workflow Agent",
            description="",
            role="",
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            status=AgentStatus.ACTIVE,
            app_id=app.id,
            workflow_id=str(uuid4()),
            workflow_node_id="node-1",
        )
        sqlite_session.add(workflow_agent)
        sqlite_session.commit()

        def fail_commit(_session: Session) -> None:
            raise RuntimeError("commit failed")

        event.listen(sqlite_session, "before_commit", fail_commit, once=True)
        with (
            patch("services.app_service.current_user", _account_identity(str(uuid4()))),
            patch("services.app_service.app_was_deleted.send"),
            patch("services.app_service.AgentWorkspaceService.retire_all_for_app", return_value=["workspace-1"]),
            patch("services.app_service.WorkflowAgentRetirementService.retire_unowned") as retire_unowned,
            patch("services.app_service.enqueue_agent_resource_collection") as enqueue_collection,
            patch("services.app_service.remove_app_and_related_data_task.delay") as enqueue_app_cleanup,
        ):
            with pytest.raises(RuntimeError, match="commit failed"):
                AppService().delete_app(app, session=sqlite_session)

        retire_unowned.assert_not_called()
        enqueue_collection.assert_not_called()
        enqueue_app_cleanup.assert_not_called()

    def test_delete_workflow_app_releases_all_bindings_before_retirement(self, sqlite_session: Session):
        app = _persist_app(sqlite_session, tenant_id=str(uuid4()))
        app.mode = AppMode.WORKFLOW
        workflow = Workflow.new(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=WorkflowType.WORKFLOW.value,
            version="historical-version",
            graph="{}",
            features="{}",
            created_by="account-1",
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        inline_binding = WorkflowAgentNodeBinding(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            workflow_version=workflow.version,
            node_id="inline-node",
            binding_type=WorkflowAgentBindingType.INLINE_AGENT,
            agent_id="inline-agent",
            current_snapshot_id="snapshot-1",
            node_job_config={},
        )
        roster_binding = WorkflowAgentNodeBinding(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            workflow_version=workflow.version,
            node_id="roster-node",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="roster-agent",
            current_snapshot_id="snapshot-2",
            node_job_config={},
        )
        sqlite_session.add_all([workflow, inline_binding, roster_binding])
        sqlite_session.commit()
        events: list[str] = []

        def retire_unowned(**kwargs):
            events.append("retire")
            assert sqlite_session.get(WorkflowAgentNodeBinding, inline_binding.id) is None
            assert sqlite_session.get(WorkflowAgentNodeBinding, roster_binding.id) is None
            assert kwargs["agent_ids"] == {"inline-agent"}

        with (
            patch("services.app_service.current_user", _account_identity(str(uuid4()))),
            patch("services.app_service.app_was_deleted.send"),
            patch("services.app_service.FeatureService"),
            patch("services.app_service.BillingService"),
            patch("services.app_service.EnterpriseService"),
            patch("services.app_service.AgentWorkspaceService.retire_all_for_app", return_value=[]),
            patch(
                "services.app_service.remove_app_and_related_data_task.delay",
                side_effect=lambda **_kwargs: events.append("enqueue-app-cleanup"),
            ),
            patch(
                "services.app_service.WorkflowAgentRetirementService.retire_unowned",
                side_effect=retire_unowned,
            ),
            patch("services.app_service.enqueue_agent_resource_collection"),
        ):
            AppService().delete_app(app, session=sqlite_session)

        assert events == ["enqueue-app-cleanup", "retire"]
        assert sqlite_session.get(WorkflowAgentNodeBinding, inline_binding.id) is None
        assert sqlite_session.get(WorkflowAgentNodeBinding, roster_binding.id) is None

    def test_delete_app_cleanup_enqueue_failure_propagates_before_retirement(self, sqlite_session: Session):
        app = _persist_app(sqlite_session, tenant_id=str(uuid4()))
        error = RuntimeError("broker unavailable")

        with (
            patch("services.app_service.current_user", _account_identity(str(uuid4()))),
            patch("services.app_service.app_was_deleted.send"),
            patch("services.app_service.AgentWorkspaceService.retire_all_for_app", return_value=[]),
            patch("services.app_service.remove_app_and_related_data_task.delay", side_effect=error),
            patch("services.app_service.WorkflowAgentRetirementService.retire_unowned") as retire_unowned,
            patch("services.app_service.enqueue_agent_resource_collection") as enqueue_collection,
        ):
            with pytest.raises(RuntimeError) as exc_info:
                AppService().delete_app(app, session=sqlite_session)

        assert exc_info.value is error
        retire_unowned.assert_not_called()
        enqueue_collection.assert_not_called()
