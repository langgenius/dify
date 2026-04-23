from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def mock_db():
    with patch("services.app_service.db") as mock_db:
        mock_db.session = MagicMock()
        yield mock_db


@pytest.fixture
def _mock_deps():
    with (
        patch("services.app_service.BillingService"),
        patch("services.app_service.FeatureService"),
        patch("services.app_service.EnterpriseService"),
        patch("services.app_service.remove_app_and_related_data_task"),
    ):
        yield


@pytest.fixture
def app_model():
    app = MagicMock()
    app.id = "app-123"
    app.tenant_id = "tenant-456"
    app.name = "Old Name"
    app.icon_type = "emoji"
    app.icon = "🤖"
    app.icon_background = "#fff"
    app.enable_site = False
    app.enable_api = False
    return app


def _make_collector(target: list):
    def handler(sender, **kw):
        target.append(sender)

    return handler


@pytest.mark.usefixtures("mock_db", "_mock_deps")
class TestAppWasDeletedSignal:
    def test_sends_signal(self, app_model):
        from events.app_event import app_was_deleted
        from services.app_service import AppService

        received = []
        handler = _make_collector(received)
        app_was_deleted.connect(handler)
        try:
            AppService().delete_app(app_model)
        finally:
            app_was_deleted.disconnect(handler)

        assert received == [app_model]

    def test_signal_fires_before_db_delete(self, app_model, mock_db):
        from events.app_event import app_was_deleted
        from services.app_service import AppService

        call_order: list[str] = []

        def handler(sender, **kw):
            call_order.append("signal")

        app_was_deleted.connect(handler)
        mock_db.session.delete.side_effect = lambda _: call_order.append("db_delete")

        try:
            AppService().delete_app(app_model)
        finally:
            app_was_deleted.disconnect(handler)

        assert call_order.index("signal") < call_order.index("db_delete")


@pytest.mark.usefixtures("mock_db")
class TestAppWasUpdatedSignal:
    def test_update_app(self, app_model):
        from events.app_event import app_was_updated
        from services.app_service import AppService

        received = []
        handler = _make_collector(received)
        app_was_updated.connect(handler)

        with patch("services.app_service.current_user", MagicMock(id="user-1")):
            try:
                AppService().update_app(
                    app_model,
                    {
                        "name": "New",
                        "description": "Desc",
                        "icon_type": "emoji",
                        "icon": "🤖",
                        "icon_background": "#fff",
                        "use_icon_as_answer_icon": False,
                        "max_active_requests": 0,
                    },
                )
            finally:
                app_was_updated.disconnect(handler)

        assert received == [app_model]

    def test_update_app_name(self, app_model):
        from events.app_event import app_was_updated
        from services.app_service import AppService

        received = []
        handler = _make_collector(received)
        app_was_updated.connect(handler)

        with patch("services.app_service.current_user", MagicMock(id="user-1")):
            try:
                AppService().update_app_name(app_model, "New Name")
            finally:
                app_was_updated.disconnect(handler)

        assert received == [app_model]

    def test_update_app_icon(self, app_model):
        from events.app_event import app_was_updated
        from services.app_service import AppService

        received = []
        handler = _make_collector(received)
        app_was_updated.connect(handler)

        with patch("services.app_service.current_user", MagicMock(id="user-1")):
            try:
                AppService().update_app_icon(app_model, "🎉", "#000")
            finally:
                app_was_updated.disconnect(handler)

        assert received == [app_model]

    def test_update_app_site_status_sends_when_changed(self, app_model):
        from events.app_event import app_was_updated
        from services.app_service import AppService

        received = []
        handler = _make_collector(received)
        app_was_updated.connect(handler)

        with patch("services.app_service.current_user", MagicMock(id="user-1")):
            try:
                app_model.enable_site = False
                AppService().update_app_site_status(app_model, True)
            finally:
                app_was_updated.disconnect(handler)

        assert received == [app_model]

    def test_update_app_site_status_skips_when_unchanged(self, app_model):
        from events.app_event import app_was_updated
        from services.app_service import AppService

        received = []
        handler = _make_collector(received)
        app_was_updated.connect(handler)

        try:
            app_model.enable_site = True
            AppService().update_app_site_status(app_model, True)
        finally:
            app_was_updated.disconnect(handler)

        assert received == []

    def test_update_app_api_status_sends_when_changed(self, app_model):
        from events.app_event import app_was_updated
        from services.app_service import AppService

        received = []
        handler = _make_collector(received)
        app_was_updated.connect(handler)

        with patch("services.app_service.current_user", MagicMock(id="user-1")):
            try:
                app_model.enable_api = False
                AppService().update_app_api_status(app_model, True)
            finally:
                app_was_updated.disconnect(handler)

        assert received == [app_model]

    def test_update_app_api_status_skips_when_unchanged(self, app_model):
        from events.app_event import app_was_updated
        from services.app_service import AppService

        received = []
        handler = _make_collector(received)
        app_was_updated.connect(handler)

        try:
            app_model.enable_api = True
            AppService().update_app_api_status(app_model, True)
        finally:
            app_was_updated.disconnect(handler)

        assert received == []
