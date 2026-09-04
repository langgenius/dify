from decimal import Decimal
from inspect import unwrap
from unittest.mock import MagicMock, PropertyMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session, scoped_session, sessionmaker
from werkzeug.exceptions import NotFound

import controllers.console.explore.saved_message as module
from controllers.console.explore.error import NotCompletionAppError
from models import Account
from models.enums import ConversationFromSource, FeedbackFromSource, FeedbackRating
from models.model import App, AppMode, InstalledApp, Message, MessageFeedback
from services.errors.message import MessageNotExistsError


def make_message(session: Session, *, app_id: str, account_id: str) -> Message:
    message = Message(
        id=str(uuid4()),
        app_id=app_id,
        conversation_id=str(uuid4()),
        query="hello",
        message={"role": "user", "content": "hello"},
        answer="world",
        message_tokens=1,
        message_unit_price=Decimal(0),
        answer_tokens=1,
        answer_unit_price=Decimal(0),
        provider_response_latency=0,
        currency="USD",
        from_source=ConversationFromSource.API,
        from_account_id=account_id,
        app_mode=AppMode.COMPLETION,
    )
    message._inputs = {}
    message.status = "normal"
    session.add(message)
    session.flush()
    session.add(
        MessageFeedback(
            app_id=app_id,
            conversation_id=message.conversation_id,
            message_id=message.id,
            rating=FeedbackRating.LIKE,
            from_source=FeedbackFromSource.USER,
            from_account_id=account_id,
        )
    )
    session.flush()
    return message


def make_installed_app(session: Session, mode: AppMode | str) -> InstalledApp:
    app_model = App(
        tenant_id="owner-tenant",
        name="Explore App",
        mode=AppMode.value_of(mode),
        enable_site=True,
        enable_api=False,
    )
    session.add(app_model)
    session.flush()
    installed_app = InstalledApp(
        tenant_id="viewer-tenant",
        app_id=app_model.id,
        app_owner_tenant_id=app_model.tenant_id,
        position=0,
        is_pinned=False,
        last_used_at=None,
    )
    session.add(installed_app)
    session.commit()
    return installed_app


@pytest.fixture
def payload_patch():
    def _patch(payload):
        return patch.object(
            type(module.console_ns),
            "payload",
            new_callable=PropertyMock,
            return_value=payload,
        )

    return _patch


class _UsesSQLiteSession:
    sqlite_session: Session
    account: Account

    @pytest.fixture(autouse=True)
    def _bind_database(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ):
        self.sqlite_session = sqlite_session
        self.account = Account(name="User", email="user@example.com")
        self.sqlite_session.add(self.account)
        self.sqlite_session.commit()
        session_proxy = scoped_session(sqlite_session_factory)
        monkeypatch.setattr(module.db, "session", session_proxy)
        yield
        session_proxy.remove()


class TestSavedMessageListApi(_UsesSQLiteSession):
    def test_get_success(self, app: Flask):
        api = module.SavedMessageListApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode=AppMode.COMPLETION)

        pagination = MagicMock(
            limit=20,
            has_more=False,
            data=[
                make_message(self.sqlite_session, app_id=installed_app.app_id, account_id=self.account.id),
                make_message(self.sqlite_session, app_id=installed_app.app_id, account_id=self.account.id),
            ],
        )
        self.sqlite_session.commit()

        with (
            app.test_request_context("/", query_string={}),
            patch.object(
                module.SavedMessageService,
                "pagination_by_last_id",
                return_value=pagination,
            ) as pagination_mock,
        ):
            result = method(api, self.account, installed_app)

        pagination_mock.assert_called_once()
        assert pagination_mock.call_args.args[1] is self.account
        assert result["limit"] == 20
        assert result["has_more"] is False
        assert len(result["data"]) == 2

    def test_get_not_completion_app(self):
        api = module.SavedMessageListApi()
        method = unwrap(api.get)

        installed_app = make_installed_app(self.sqlite_session, mode=AppMode.CHAT)

        with pytest.raises(NotCompletionAppError):
            method(api, self.account, installed_app)

    def test_post_success(self, app: Flask, payload_patch):
        api = module.SavedMessageListApi()
        method = unwrap(api.post)

        installed_app = make_installed_app(self.sqlite_session, mode=AppMode.COMPLETION)

        payload = {"message_id": str(uuid4())}

        with (
            app.test_request_context("/", json=payload),
            payload_patch(payload),
            patch.object(module.SavedMessageService, "save") as save_mock,
        ):
            result = method(api, module.SavedMessageCreatePayload.model_validate(payload), self.account, installed_app)

        save_mock.assert_called_once()
        assert save_mock.call_args.args[1] is self.account
        assert result == {"result": "success"}

    def test_post_message_not_exists(self, app: Flask, payload_patch):
        api = module.SavedMessageListApi()
        method = unwrap(api.post)

        installed_app = make_installed_app(self.sqlite_session, mode=AppMode.COMPLETION)

        payload = {"message_id": str(uuid4())}

        with (
            app.test_request_context("/", json=payload),
            payload_patch(payload),
            patch.object(
                module.SavedMessageService,
                "save",
                side_effect=MessageNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(api, module.SavedMessageCreatePayload.model_validate(payload), self.account, installed_app)


class TestSavedMessageApi(_UsesSQLiteSession):
    def test_delete_success(self):
        api = module.SavedMessageApi()
        method = unwrap(api.delete)

        installed_app = make_installed_app(self.sqlite_session, mode=AppMode.COMPLETION)

        with (
            patch.object(module.SavedMessageService, "delete") as delete_mock,
        ):
            result, status = method(api, self.account, installed_app, str(uuid4()))

        delete_mock.assert_called_once()
        assert delete_mock.call_args.args[1] is self.account
        assert status == 204
        assert result == ""

    def test_delete_not_completion_app(self):
        api = module.SavedMessageApi()
        method = unwrap(api.delete)

        installed_app = make_installed_app(self.sqlite_session, mode=AppMode.CHAT)

        with pytest.raises(NotCompletionAppError):
            method(api, self.account, installed_app, str(uuid4()))
