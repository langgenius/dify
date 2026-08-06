from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from graphon.model_runtime.entities.model_entities import ModelType
from models import Account, Tenant
from models.model import App, AppMode, AppModelConfig, IconType
from models.workflow import Workflow
from services.agent.errors import AgentAccessNotReadyError, AgentNameConflictError
from services.app_service import AppListParams, AppService, CreateAppParams


class TestCreateAppTransactionBoundary:
    def test_commits_database_state_before_external_side_effects(self) -> None:
        session = MagicMock()
        account = Account(name="Test Account", email="test@example.com")
        account.id = "account-1"
        account._current_tenant = Tenant(name="Test Tenant")
        account._current_tenant.id = "tenant-1"
        phase_events: list[str] = []
        session.commit.side_effect = lambda: phase_events.append("commit")

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
            patch("services.app_service.dify_config.BILLING_ENABLED", False),
        ):
            AppService().create_app(
                "tenant-1",
                CreateAppParams(name="Workflow", mode=AppMode.WORKFLOW.value),
                account,
                session=session,
            )

        assert phase_events == ["commit", "signal", "commit", "external"]

    def test_falls_back_when_default_model_schema_is_unavailable(self) -> None:
        session = MagicMock()
        account = Account(name="Test Account", email="test@example.com")
        account.id = "account-1"
        account._current_tenant = Tenant(name="Test Tenant")
        account._current_tenant.id = "tenant-1"
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
        added_objects: list[object] = []
        session.add.side_effect = added_objects.append

        with (
            patch("services.app_service.ModelManager.for_tenant", return_value=model_manager),
            patch("services.app_service.app_was_created.send"),
            patch("services.app_service.enterprise_rbac_service.try_sync_creator_access_policy_member_bindings"),
            patch(
                "services.app_service.FeatureService.get_system_features",
                return_value=SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
            ),
            patch("services.app_service.dify_config.BILLING_ENABLED", False),
        ):
            app = AppService().create_app(
                "tenant-1",
                CreateAppParams(name="Chat", mode=AppMode.CHAT.value),
                account,
                session=session,
            )

        app_model_config = next(obj for obj in added_objects if isinstance(obj, AppModelConfig))
        assert app.mode == AppMode.CHAT
        assert app_model_config.model_dict == {
            "provider": "openai",
            "name": "gpt-4o",
            "mode": "chat",
            "completion_params": {},
        }
        model_manager.get_default_provider_model_name.assert_called_once_with(
            tenant_id="tenant-1", model_type=ModelType.LLM
        )


@pytest.mark.parametrize(
    "update_status",
    [AppService.update_app_site_status, AppService.update_app_api_status],
)
def test_app_status_updates_commit_before_signal(update_status: Callable[..., App]) -> None:
    app = cast(App, SimpleNamespace(enable_site=False, enable_api=False, mode=AppMode.CHAT))
    session = MagicMock()
    phase_events: list[str] = []
    session.commit.side_effect = lambda: phase_events.append("commit")

    with (
        patch("services.app_service.current_user", SimpleNamespace(id="account-1")),
        patch("services.app_service.app_was_updated.send", side_effect=lambda *_args: phase_events.append("signal")),
    ):
        update_status(AppService(), app, True, session=session)

    assert phase_events == ["commit", "signal"]


@pytest.mark.parametrize(
    "update_status",
    [
        AppService.update_app_site_status,
        AppService.update_app_api_status,
    ],
)
def test_unpublished_agent_app_access_cannot_be_enabled(update_status: Callable[..., App]) -> None:
    app = cast(
        App,
        SimpleNamespace(
            id="app-1",
            tenant_id="tenant-1",
            mode=AppMode.AGENT,
            enable_site=False,
            enable_api=False,
        ),
    )
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(id="agent-1")

    with patch("services.app_service.agent_has_workflow_callable_active_snapshot", return_value=False):
        with pytest.raises(AgentAccessNotReadyError):
            update_status(AppService(), app, True, session=session)

    assert app.enable_site is False
    assert app.enable_api is False
    session.commit.assert_not_called()


class TestOpenapiVisibilityHelpers:
    """Coverage for the session-injected, openapi-visibility-scoped
    ``AppService`` getters used by ``/openapi/v1/apps*``. These helpers
    centralise the "row exists + status normal + openapi-visibility
    gate passes" check so the controller can stay free of SQL.
    """

    def test_get_app_by_id_is_plain_session_get(self):
        """``get_app_by_id`` must NOT apply status / visibility filters
        — callers (e.g. the openapi auth pipeline) need to differentiate
        404 (missing) from 403 (``enable_api`` off) and would lose that
        signal if the helper coalesced both into ``None``.
        """
        mock_session = MagicMock()
        sentinel_app = App(
            status="archived",
        )  # explicitly NOT "normal"
        mock_session.get.return_value = sentinel_app

        assert AppService.get_app_by_id("app-uuid", mock_session) is sentinel_app
        mock_session.get.assert_called_once_with(App, "app-uuid")

    def test_get_app_by_id_returns_none_when_missing(self):
        mock_session = MagicMock()
        mock_session.get.return_value = None

        assert AppService.get_app_by_id("missing", mock_session) is None

    def test_get_visible_app_by_id_returns_app_when_visible(self):
        mock_session = MagicMock()
        app = App(
            status="normal",
        )
        mock_session.get.return_value = app

        with patch("services.app_service.is_openapi_visible", return_value=True):
            assert AppService.get_visible_app_by_id("app-uuid", mock_session) is app

        mock_session.get.assert_called_once_with(App, "app-uuid")

    def test_get_visible_app_by_id_returns_none_when_row_missing(self):
        mock_session = MagicMock()
        mock_session.get.return_value = None

        assert AppService.get_visible_app_by_id("missing", mock_session) is None

    def test_get_visible_app_by_id_returns_none_when_status_not_normal(self):
        """Soft-deleted/archived rows must not surface on the openapi
        surface — the helper hides them by returning ``None``.
        """
        mock_session = MagicMock()
        app = App(
            status="archived",
        )
        mock_session.get.return_value = app

        with patch("services.app_service.is_openapi_visible", return_value=True):
            assert AppService.get_visible_app_by_id("app-uuid", mock_session) is None

    def test_get_visible_app_by_id_returns_none_when_visibility_gate_rejects(self):
        """``is_openapi_visible`` is the per-row counterpart to
        ``apply_openapi_gate`` — when it returns False the helper must
        treat the row as invisible (not "found but unauthorized").
        """
        mock_session = MagicMock()
        app = App(
            status="normal",
        )
        mock_session.get.return_value = app

        with patch("services.app_service.is_openapi_visible", return_value=False):
            assert AppService.get_visible_app_by_id("app-uuid", mock_session) is None

    def test_find_visible_apps_by_name_returns_scalars_through_visibility_gate(self):
        """Tenant-scoped name lookup. The helper passes the SELECT through
        ``apply_openapi_gate`` and materialises ``.scalars()`` into a list
        so the controller can branch on length (404 / single / 409).
        """
        mock_session = MagicMock()
        rows = [App(), App()]
        mock_session.execute.return_value.scalars.return_value = iter(rows)

        with patch("services.app_service.apply_openapi_gate", side_effect=lambda q: q) as gate:
            out = AppService.find_visible_apps_by_name(name="my-app", tenant_id="tenant-1", session=mock_session)

        assert out == rows
        # Visibility gate must wrap the SELECT exactly once.
        gate.assert_called_once()
        mock_session.execute.assert_called_once()

    def test_find_visible_apps_by_name_returns_empty_list_on_no_match(self):
        mock_session = MagicMock()
        mock_session.execute.return_value.scalars.return_value = iter([])

        with patch("services.app_service.apply_openapi_gate", side_effect=lambda q: q):
            out = AppService.find_visible_apps_by_name(name="nope", tenant_id="tenant-1", session=mock_session)

        assert out == []

    def test_find_visible_apps_by_ids_short_circuits_on_empty_input(self):
        """Empty id list must not emit ``WHERE id IN ()`` — Postgres
        rejects empty IN lists and the call is a guaranteed no-op
        anyway. The helper returns ``[]`` without touching the session.
        """
        mock_session = MagicMock()

        assert AppService.find_visible_apps_by_ids([], mock_session) == []
        mock_session.execute.assert_not_called()

    def test_find_visible_apps_by_ids_passes_through_visibility_gate(self):
        """Bulk fetch routes through ``apply_openapi_gate`` exactly once
        and materialises the scalar rows. **No** status filter is
        applied here — the EE permitted-external pipeline filters
        non-normal hits in Python so its page count stays anchored.
        """
        mock_session = MagicMock()
        rows = [App(), App()]
        mock_session.execute.return_value.scalars.return_value.all.return_value = rows

        with patch("services.app_service.apply_openapi_gate", side_effect=lambda q: q) as gate:
            out = AppService.find_visible_apps_by_ids(["a", "b"], mock_session)

        assert out == rows
        gate.assert_called_once()
        mock_session.execute.assert_called_once()


@pytest.mark.parametrize("sqlite_session", [(Account, App, AppModelConfig)], indirect=True)
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


class TestAppMeta:
    def test_loads_workflow_with_caller_session(self):
        session = MagicMock()
        session.get.return_value = SimpleNamespace(graph_dict={"nodes": []})
        app = cast(App, SimpleNamespace(mode=AppMode.WORKFLOW, workflow_id="workflow-1"))

        assert AppService().get_app_meta(app, session=session) == {"tool_icons": {}}

        session.get.assert_called_once_with(Workflow, "workflow-1")

    def test_loads_app_model_config_with_caller_session(self):
        session = MagicMock()
        session.get.return_value = SimpleNamespace(agent_mode_dict={"tools": []})
        app = cast(App, SimpleNamespace(mode=AppMode.CHAT, app_model_config_id="config-1"))

        assert AppService().get_app_meta(app, session=session) == {"tool_icons": {}}

        session.get.assert_called_once_with(AppModelConfig, "config-1")


class TestGetApp:
    def test_legacy_agent_detection_uses_caller_session(self):
        session = MagicMock()
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
            assert AppService().get_app(app, session=session) is app

        is_agent.assert_called_once_with(session=session)
        get_model_config.assert_not_called()

    def test_agent_model_config_uses_caller_session(self):
        session = MagicMock()
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
            assert AppService().get_app(app, session=session) is app

        is_agent.assert_not_called()
        get_model_config.assert_called_once_with(session=session)


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

    def test_update_agent_app_syncs_backing_agent_identity(self):
        from models.agent import AgentIconType
        from models.model import AppMode, IconType
        from services.app_service import AppService

        app = SimpleNamespace(
            id="app-1",
            tenant_id="tenant-1",
            mode=AppMode.AGENT,
            name="Old",
            description="old",
            role="draft",
            icon_type=IconType.EMOJI,
            icon="robot",
            icon_background="#fff",
            use_icon_as_answer_icon=False,
            max_active_requests=None,
            created_by="account-1",
        )
        backing_agent = SimpleNamespace(
            name="Old",
            description="old",
            role="draft",
            icon_type=AgentIconType.EMOJI,
            icon="robot",
            icon_background="#fff",
            updated_by=None,
            updated_at=None,
        )

        with (
            patch("services.app_service.db") as mock_db,
            patch("services.app_service.current_user", SimpleNamespace(id="account-2")),
        ):
            mock_db.session.scalar.return_value = backing_agent
            updated_app = AppService().update_app(
                app,  # type: ignore[arg-type]
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
                session=mock_db.session,
            )

        assert updated_app.name == "Iris"
        assert backing_agent.name == "Iris"
        assert backing_agent.description == "agent app"
        assert backing_agent.role == "research assistant"
        assert backing_agent.icon_type == AgentIconType.IMAGE
        assert backing_agent.icon == "file-id"
        assert backing_agent.icon_background == "#123456"
        assert backing_agent.updated_by == "account-2"
        assert backing_agent.updated_at == updated_app.updated_at

    def test_update_agent_app_preserves_role_when_args_omit_it(self):
        from models.agent import AgentIconType
        from models.model import AppMode, IconType
        from services.app_service import AppService

        app = SimpleNamespace(
            id="app-1",
            tenant_id="tenant-1",
            mode=AppMode.AGENT,
            name="Old",
            description="old",
            role="draft",
            icon_type=IconType.EMOJI,
            icon="robot",
            icon_background="#fff",
            use_icon_as_answer_icon=False,
            max_active_requests=None,
            created_by="account-1",
        )
        backing_agent = SimpleNamespace(
            name="Old",
            description="old",
            role="research assistant",
            icon_type=AgentIconType.EMOJI,
            icon="robot",
            icon_background="#fff",
            updated_by=None,
            updated_at=None,
        )

        with (
            patch("services.app_service.db") as mock_db,
            patch("services.app_service.current_user", SimpleNamespace(id="account-2")),
        ):
            mock_db.session.scalar.return_value = backing_agent
            AppService().update_app(
                app,  # type: ignore[arg-type]
                {
                    "name": "Iris",
                    "description": "agent app",
                    "icon_type": "image",
                    "icon": "file-id",
                    "icon_background": "#123456",
                    "use_icon_as_answer_icon": False,
                    "max_active_requests": 0,
                },
                session=mock_db.session,
            )

        assert backing_agent.role == "research assistant"

    def test_update_agent_app_clears_role_when_args_set_empty_string(self):
        from models.agent import AgentIconType
        from models.model import AppMode, IconType
        from services.app_service import AppService

        app = SimpleNamespace(
            id="app-1",
            tenant_id="tenant-1",
            mode=AppMode.AGENT,
            name="Old",
            description="old",
            role="draft",
            icon_type=IconType.EMOJI,
            icon="robot",
            icon_background="#fff",
            use_icon_as_answer_icon=False,
            max_active_requests=None,
            created_by="account-1",
        )
        backing_agent = SimpleNamespace(
            name="Old",
            description="old",
            role="research assistant",
            icon_type=AgentIconType.EMOJI,
            icon="robot",
            icon_background="#fff",
            updated_by=None,
            updated_at=None,
        )

        with (
            patch("services.app_service.db") as mock_db,
            patch("services.app_service.current_user", SimpleNamespace(id="account-2")),
        ):
            mock_db.session.scalar.return_value = backing_agent
            AppService().update_app(
                app,  # type: ignore[arg-type]
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
                session=mock_db.session,
            )

        assert backing_agent.role == ""

    def test_update_agent_app_duplicate_name_rolls_back_and_raises_conflict(self):
        from models.agent import AgentIconType
        from models.model import AppMode, IconType
        from services.app_service import AppService

        app = SimpleNamespace(
            id="app-1",
            tenant_id="tenant-1",
            mode=AppMode.AGENT,
            name="Old",
            description="old",
            role="draft",
            icon_type=IconType.EMOJI,
            icon="robot",
            icon_background="#fff",
            use_icon_as_answer_icon=False,
            max_active_requests=None,
            created_by="account-1",
        )
        backing_agent = SimpleNamespace(
            name="Old",
            description="old",
            role="research assistant",
            icon_type=AgentIconType.EMOJI,
            icon="robot",
            icon_background="#fff",
            updated_by=None,
            updated_at=None,
        )

        with (
            patch("services.app_service.db") as mock_db,
            patch("services.app_service.current_user", SimpleNamespace(id="account-2")),
        ):
            mock_db.session.scalar.return_value = backing_agent
            mock_db.session.commit.side_effect = IntegrityError("duplicate", None, None)
            with pytest.raises(AgentNameConflictError):
                AppService().update_app(
                    app,  # type: ignore[arg-type]
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
                    session=mock_db.session,
                )

        mock_db.session.rollback.assert_called_once()

    def test_delete_agent_app_archives_backing_agent(self):
        from models.agent import AgentStatus
        from models.model import AppMode
        from services.app_service import AppService

        app = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.AGENT)
        backing_agent = SimpleNamespace(id="agent-1", status=AgentStatus.ACTIVE, archived_by=None, archived_at=None)
        events: list[str] = []

        with (
            patch("services.app_service.db") as mock_db,
            patch("services.app_service.current_user", SimpleNamespace(id="account-2")),
            patch("services.app_service.BillingService"),
            patch("services.app_service.EnterpriseService"),
            patch("services.app_service.FeatureService"),
            patch("services.app_service.dify_config"),
            patch("services.app_service.remove_app_and_related_data_task"),
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
                side_effect=lambda **_kwargs: (
                    events.append("retire-workflow-agents") or (["workflow-binding-1"], ["workflow-home-1"])
                ),
            ) as mock_workflow_retirement,
            patch(
                "services.app_service.enqueue_agent_resource_collection",
                side_effect=lambda **_kwargs: events.append("enqueue"),
            ) as mock_enqueue_collection,
        ):
            mock_db.session.scalar.return_value = backing_agent
            mock_db.session.commit.side_effect = lambda: events.append("commit")
            workflow_agents = MagicMock()
            workflow_agents.all.return_value = ["workflow-agent-1", "workflow-agent-2"]
            bindings = MagicMock()
            bindings.all.return_value = []
            mock_db.session.scalars.side_effect = [workflow_agents, bindings]
            AppService().delete_app(app, session=mock_db.session)  # type: ignore[arg-type]

        assert events == ["retire-app-workspaces", "commit", "retire-workflow-agents", "enqueue"]
        assert backing_agent.status == AgentStatus.ARCHIVED
        assert backing_agent.archived_by == "account-2"
        assert backing_agent.archived_at is not None
        mock_db.session.delete.assert_called_once_with(app)
        mock_workflow_retirement.assert_called_once_with(
            tenant_id="tenant-1",
            agent_ids=["workflow-agent-1", "workflow-agent-2"],
            account_id="account-2",
        )
        mock_retire_workspaces.assert_called_once_with(
            session=mock_db.session,
            tenant_id="tenant-1",
            app_id="app-1",
        )
        mock_retire_homes.assert_called_once_with(
            session=mock_db.session,
            tenant_id="tenant-1",
            agent_id="agent-1",
        )
        mock_enqueue_collection.assert_called_once_with(
            tenant_id="tenant-1",
            workspace_ids=["workspace-1"],
            binding_ids=["workflow-binding-1"],
            home_snapshot_ids=["home-1", "workflow-home-1"],
        )

    def test_delete_app_commit_failure_does_not_retire_workflow_agents_or_enqueue(self):
        from models.model import AppMode
        from services.app_service import AppService

        app = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW)
        with (
            patch("services.app_service.db") as mock_db,
            patch("services.app_service.current_user", SimpleNamespace(id="account-2")),
            patch("services.app_service.AgentWorkspaceService.retire_all_for_app", return_value=["workspace-1"]),
            patch("services.app_service.WorkflowAgentRetirementService.retire_unowned") as retire_unowned,
            patch("services.app_service.enqueue_agent_resource_collection") as enqueue_collection,
        ):
            mock_db.session.scalar.return_value = None
            workflow_agents = MagicMock()
            workflow_agents.all.return_value = ["workflow-agent-1"]
            mock_db.session.scalars.return_value = workflow_agents
            mock_db.session.commit.side_effect = RuntimeError("commit failed")

            with pytest.raises(RuntimeError, match="commit failed"):
                AppService().delete_app(app, session=mock_db.session)  # type: ignore[arg-type]

        retire_unowned.assert_not_called()
        enqueue_collection.assert_not_called()
