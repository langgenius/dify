import json
from collections.abc import Iterator
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from events.app_event import app_was_deleted, app_was_updated
from models.account import Account
from models.dataset import AppDatasetJoin
from models.model import App, AppMode, AppModelConfig, IconType, InstalledApp
from services.app_service import AppService


@pytest.fixture
def _mock_deps() -> Iterator[None]:
    with (
        patch("services.app_service.BillingService"),
        patch("services.app_service.FeatureService"),
        patch("services.app_service.EnterpriseService"),
        patch("services.app_service.remove_app_and_related_data_task"),
    ):
        yield


@pytest.fixture
def account(sqlite_session: Session) -> Account:
    account = Account(name="Signal Tester", email="signal-tester@example.com")
    sqlite_session.add(account)
    sqlite_session.commit()
    return account


@pytest.fixture
def app_model(sqlite_session: Session, account: Account) -> App:
    app = App(
        tenant_id=str(uuid4()),
        name="Old Name",
        description="Old description",
        mode=AppMode.COMPLETION,
        icon_type=IconType.EMOJI,
        icon="🤖",
        icon_background="#fff",
        enable_site=False,
        enable_api=False,
        created_by=account.id,
        max_active_requests=0,
    )
    sqlite_session.add(app)
    sqlite_session.commit()
    return app


def _make_collector(target: list[App]):
    def handler(sender: App, **_kwargs: object) -> None:
        target.append(sender)

    return handler


@pytest.mark.parametrize("sqlite_session", [(App, Account)], indirect=True)
@pytest.mark.usefixtures("_mock_deps")
class TestAppWasDeletedSignal:
    def test_sends_signal(self, app_model: App, sqlite_session: Session) -> None:
        received: list[App] = []
        handler = _make_collector(received)
        app_was_deleted.connect(handler)
        try:
            AppService().delete_app(app_model, session=sqlite_session)
        finally:
            app_was_deleted.disconnect(handler)

        assert received == [app_model]
        assert sqlite_session.get(App, app_model.id) is None

    def test_signal_fires_before_db_delete(self, app_model: App, sqlite_session: Session) -> None:
        call_order: list[str] = []

        def signal_handler(_sender: App, **_kwargs: object) -> None:
            call_order.append("signal")

        def before_flush(session: Session, *_args: object) -> None:
            if app_model in session.deleted:
                call_order.append("db_delete")

        app_was_deleted.connect(signal_handler)
        event.listen(sqlite_session, "before_flush", before_flush)
        try:
            AppService().delete_app(app_model, session=sqlite_session)
        finally:
            event.remove(sqlite_session, "before_flush", before_flush)
            app_was_deleted.disconnect(signal_handler)

        assert call_order == ["signal", "db_delete"]
        assert sqlite_session.get(App, app_model.id) is None


@pytest.mark.parametrize("sqlite_session", [(App, Account)], indirect=True)
class TestAppWasUpdatedSignal:
    def test_update_app(self, app_model: App, account: Account, sqlite_session: Session) -> None:
        received: list[App] = []
        handler = _make_collector(received)
        app_was_updated.connect(handler)

        with patch("services.app_service.current_user", account):
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
                    session=sqlite_session,
                )
            finally:
                app_was_updated.disconnect(handler)

        persisted = sqlite_session.get(App, app_model.id)
        assert received == [app_model]
        assert persisted is not None
        assert persisted.name == "New"
        assert persisted.description == "Desc"
        assert persisted.updated_by == account.id

    def test_update_app_name(self, app_model: App, account: Account, sqlite_session: Session) -> None:
        received: list[App] = []
        handler = _make_collector(received)
        app_was_updated.connect(handler)

        with patch("services.app_service.current_user", account):
            try:
                AppService().update_app_name(app_model, "New Name", session=sqlite_session)
            finally:
                app_was_updated.disconnect(handler)

        assert received == [app_model]
        assert sqlite_session.get(App, app_model.id).name == "New Name"  # type: ignore[union-attr]

    def test_update_app_icon(self, app_model: App, account: Account, sqlite_session: Session) -> None:
        received: list[App] = []
        handler = _make_collector(received)
        app_was_updated.connect(handler)

        with patch("services.app_service.current_user", account):
            try:
                AppService().update_app_icon(app_model, "🎉", "#000", session=sqlite_session)
            finally:
                app_was_updated.disconnect(handler)

        persisted = sqlite_session.get(App, app_model.id)
        assert received == [app_model]
        assert persisted is not None
        assert (persisted.icon, persisted.icon_background) == ("🎉", "#000")

    def test_update_app_site_status_sends_when_changed(
        self, app_model: App, account: Account, sqlite_session: Session
    ) -> None:
        received: list[App] = []
        handler = _make_collector(received)
        app_was_updated.connect(handler)

        with patch("services.app_service.current_user", account):
            try:
                AppService().update_app_site_status(app_model, True, session=sqlite_session)
            finally:
                app_was_updated.disconnect(handler)

        assert received == [app_model]
        assert sqlite_session.get(App, app_model.id).enable_site is True  # type: ignore[union-attr]

    def test_update_app_site_status_skips_when_unchanged(self, app_model: App, sqlite_session: Session) -> None:
        app_model.enable_site = True
        sqlite_session.commit()
        received: list[App] = []
        handler = _make_collector(received)
        app_was_updated.connect(handler)
        try:
            AppService().update_app_site_status(app_model, True, session=sqlite_session)
        finally:
            app_was_updated.disconnect(handler)

        assert received == []
        assert sqlite_session.get(App, app_model.id).enable_site is True  # type: ignore[union-attr]

    def test_update_app_api_status_sends_when_changed(
        self, app_model: App, account: Account, sqlite_session: Session
    ) -> None:
        received: list[App] = []
        handler = _make_collector(received)
        app_was_updated.connect(handler)

        with patch("services.app_service.current_user", account):
            try:
                AppService().update_app_api_status(app_model, True, session=sqlite_session)
            finally:
                app_was_updated.disconnect(handler)

        assert received == [app_model]
        assert sqlite_session.get(App, app_model.id).enable_api is True  # type: ignore[union-attr]

    def test_update_app_api_status_skips_when_unchanged(self, app_model: App, sqlite_session: Session) -> None:
        app_model.enable_api = True
        sqlite_session.commit()
        received: list[App] = []
        handler = _make_collector(received)
        app_was_updated.connect(handler)
        try:
            AppService().update_app_api_status(app_model, True, session=sqlite_session)
        finally:
            app_was_updated.disconnect(handler)

        assert received == []
        assert sqlite_session.get(App, app_model.id).enable_api is True  # type: ignore[union-attr]


class TestAppModelConfigWasUpdatedSignal:
    def test_requires_caller_session(self) -> None:
        from events.event_handlers.update_app_dataset_join_when_app_model_config_updated import handle

        with pytest.raises(TypeError, match="session"):
            handle(SimpleNamespace(id="app-1"), app_model_config=None)

    def test_reuses_provided_session_without_committing(self) -> None:
        from events.event_handlers.update_app_dataset_join_when_app_model_config_updated import handle

        session = MagicMock()
        session.scalars.return_value.all.return_value = []
        app_model_config = AppModelConfig(app_id="app-1", created_by="user-1", updated_by="user-1")
        app_model_config.dataset_configs = json.dumps(
            {
                "retrieval_model": "multiple",
                "datasets": {"datasets": [{"dataset": {"id": "dataset-1"}}]},
            }
        )

        handle(SimpleNamespace(id="app-1"), app_model_config=app_model_config, session=session)

        added_join = session.add.call_args.args[0]
        assert isinstance(added_join, AppDatasetJoin)
        assert added_join.app_id == "app-1"
        assert added_join.dataset_id == "dataset-1"
        session.commit.assert_not_called()


class TestCreateInstalledAppWhenAppCreated:
    def test_skips_existing_installation(self) -> None:
        from events.event_handlers.create_installed_app_when_app_created import handle

        session = MagicMock()
        session.scalar.return_value = "installed-app-1"

        handle(SimpleNamespace(id="app-1", tenant_id="tenant-1"), session=session)

        session.add.assert_not_called()
        session.flush.assert_not_called()

    def test_adds_missing_installation_without_committing(self) -> None:
        from events.event_handlers.create_installed_app_when_app_created import handle

        session = MagicMock()
        session.scalar.return_value = None

        handle(SimpleNamespace(id="app-1", tenant_id="tenant-1"), session=session)

        installed_app = session.add.call_args.args[0]
        assert isinstance(installed_app, InstalledApp)
        assert installed_app.app_id == "app-1"
        assert installed_app.tenant_id == "tenant-1"
        session.flush.assert_called_once_with()
        session.commit.assert_not_called()
