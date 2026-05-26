from __future__ import annotations

from unittest.mock import MagicMock, patch

from models.model import App
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

        assert AppService.get_app_by_id(mock_session, "app-uuid") is sentinel_app
        mock_session.get.assert_called_once_with(App, "app-uuid")

    def test_get_app_by_id_returns_none_when_missing(self):
        mock_session = MagicMock()
        mock_session.get.return_value = None

        assert AppService.get_app_by_id(mock_session, "missing") is None

    def test_get_visible_app_by_id_returns_app_when_visible(self):
        mock_session = MagicMock()
        app = MagicMock(spec=App)
        app.status = "normal"
        mock_session.get.return_value = app

        with patch("services.app_service.is_openapi_visible", return_value=True):
            assert AppService.get_visible_app_by_id(mock_session, "app-uuid") is app

        mock_session.get.assert_called_once_with(App, "app-uuid")

    def test_get_visible_app_by_id_returns_none_when_row_missing(self):
        mock_session = MagicMock()
        mock_session.get.return_value = None

        assert AppService.get_visible_app_by_id(mock_session, "missing") is None

    def test_get_visible_app_by_id_returns_none_when_status_not_normal(self):
        """Soft-deleted/archived rows must not surface on the openapi
        surface — the helper hides them by returning ``None``.
        """
        mock_session = MagicMock()
        app = MagicMock(spec=App)
        app.status = "archived"
        mock_session.get.return_value = app

        with patch("services.app_service.is_openapi_visible", return_value=True):
            assert AppService.get_visible_app_by_id(mock_session, "app-uuid") is None

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
            assert AppService.get_visible_app_by_id(mock_session, "app-uuid") is None

    def test_find_visible_apps_by_name_returns_scalars_through_visibility_gate(self):
        """Tenant-scoped name lookup. The helper passes the SELECT through
        ``apply_openapi_gate`` and materialises ``.scalars()`` into a list
        so the controller can branch on length (404 / single / 409).
        """
        mock_session = MagicMock()
        rows = [MagicMock(spec=App), MagicMock(spec=App)]
        mock_session.execute.return_value.scalars.return_value = iter(rows)

        with patch("services.app_service.apply_openapi_gate", side_effect=lambda q: q) as gate:
            out = AppService.find_visible_apps_by_name(mock_session, name="my-app", tenant_id="tenant-1")

        assert out == rows
        # Visibility gate must wrap the SELECT exactly once.
        gate.assert_called_once()
        mock_session.execute.assert_called_once()

    def test_find_visible_apps_by_name_returns_empty_list_on_no_match(self):
        mock_session = MagicMock()
        mock_session.execute.return_value.scalars.return_value = iter([])

        with patch("services.app_service.apply_openapi_gate", side_effect=lambda q: q):
            out = AppService.find_visible_apps_by_name(mock_session, name="nope", tenant_id="tenant-1")

        assert out == []

    def test_find_visible_apps_by_ids_short_circuits_on_empty_input(self):
        """Empty id list must not emit ``WHERE id IN ()`` — Postgres
        rejects empty IN lists and the call is a guaranteed no-op
        anyway. The helper returns ``[]`` without touching the session.
        """
        mock_session = MagicMock()

        assert AppService.find_visible_apps_by_ids(mock_session, []) == []
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
            out = AppService.find_visible_apps_by_ids(mock_session, ["a", "b"])

        assert out == rows
        gate.assert_called_once()
        mock_session.execute.assert_called_once()
