from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.exc import IntegrityError

from models.model import App
from services.agent.errors import AgentNameConflictError
from services.app_service import AppService


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
        sentinel_app = MagicMock(spec=App)
        sentinel_app.status = "archived"  # explicitly NOT "normal"
        mock_session.get.return_value = sentinel_app

        assert AppService.get_app_by_id("app-uuid", session=mock_session) is sentinel_app
        mock_session.get.assert_called_once_with(App, "app-uuid")

    def test_get_app_by_id_returns_none_when_missing(self):
        mock_session = MagicMock()
        mock_session.get.return_value = None

        assert AppService.get_app_by_id("missing", session=mock_session) is None

    def test_get_visible_app_by_id_returns_app_when_visible(self):
        mock_session = MagicMock()
        app = MagicMock(spec=App)
        app.status = "normal"
        mock_session.get.return_value = app

        with patch("services.app_service.is_openapi_visible", return_value=True):
            assert AppService.get_visible_app_by_id("app-uuid", session=mock_session) is app

        mock_session.get.assert_called_once_with(App, "app-uuid")

    def test_get_visible_app_by_id_returns_none_when_row_missing(self):
        mock_session = MagicMock()
        mock_session.get.return_value = None

        assert AppService.get_visible_app_by_id("missing", session=mock_session) is None

    def test_get_visible_app_by_id_returns_none_when_status_not_normal(self):
        """Soft-deleted/archived rows must not surface on the openapi
        surface — the helper hides them by returning ``None``.
        """
        mock_session = MagicMock()
        app = MagicMock(spec=App)
        app.status = "archived"
        mock_session.get.return_value = app

        with patch("services.app_service.is_openapi_visible", return_value=True):
            assert AppService.get_visible_app_by_id("app-uuid", session=mock_session) is None

    def test_get_visible_app_by_id_returns_none_when_visibility_gate_rejects(self):
        """``is_openapi_visible`` is the per-row counterpart to
        ``apply_openapi_gate`` — when it returns False the helper must
        treat the row as invisible (not "found but unauthorized").
        """
        mock_session = MagicMock()
        app = MagicMock(spec=App)
        app.status = "normal"
        mock_session.get.return_value = app

        with patch("services.app_service.is_openapi_visible", return_value=False):
            assert AppService.get_visible_app_by_id("app-uuid", session=mock_session) is None

    def test_find_visible_apps_by_name_returns_scalars_through_visibility_gate(self):
        """Tenant-scoped name lookup. The helper passes the SELECT through
        ``apply_openapi_gate`` and materialises ``.scalars()`` into a list
        so the controller can branch on length (404 / single / 409).
        """
        mock_session = MagicMock()
        rows = [MagicMock(spec=App), MagicMock(spec=App)]
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

        assert AppService.find_visible_apps_by_ids([], session=mock_session) == []
        mock_session.execute.assert_not_called()

    def test_find_visible_apps_by_ids_passes_through_visibility_gate(self):
        """Bulk fetch routes through ``apply_openapi_gate`` exactly once
        and materialises the scalar rows. **No** status filter is
        applied here — the EE permitted-external pipeline filters
        non-normal hits in Python so its page count stays anchored.
        """
        mock_session = MagicMock()
        rows = [MagicMock(spec=App), MagicMock(spec=App)]
        mock_session.execute.return_value.scalars.return_value.all.return_value = rows

        with patch("services.app_service.apply_openapi_gate", side_effect=lambda q: q) as gate:
            out = AppService.find_visible_apps_by_ids(["a", "b"], session=mock_session)

        assert out == rows
        gate.assert_called_once()
        mock_session.execute.assert_called_once()


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

    def test_create_app_params_accepts_agent_mode(self):
        from services.app_service import CreateAppParams

        params = CreateAppParams(name="Iris", mode="agent")
        assert params.mode == "agent"

    def test_bound_agent_id_is_none_for_non_agent_app(self):
        """Non-agent apps short-circuit without touching the DB."""
        from models.model import App, AppMode

        app = App()
        app.mode = AppMode.CHAT
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
        backing_agent = SimpleNamespace(status=AgentStatus.ACTIVE, archived_by=None, archived_at=None)

        with (
            patch("services.app_service.db") as mock_db,
            patch("services.app_service.current_user", SimpleNamespace(id="account-2")),
            patch("services.app_service.BillingService"),
            patch("services.app_service.EnterpriseService"),
            patch("services.app_service.FeatureService"),
            patch("services.app_service.dify_config"),
            patch("services.app_service.remove_app_and_related_data_task"),
        ):
            mock_db.session.scalar.return_value = backing_agent
            AppService().delete_app(app, session=mock_db.session)  # type: ignore[arg-type]

        assert backing_agent.status == AgentStatus.ARCHIVED
        assert backing_agent.archived_by == "account-2"
        assert backing_agent.archived_at is not None
        mock_db.session.delete.assert_called_once_with(app)
