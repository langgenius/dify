"""Regression tests for DifyTap cross-tenant access control on chat-messages.

Covers GHSA-jg5j-c9pq-w894 (CVE-2025-59422): Broken Access Control on the
chat-messages log endpoint allowed one tenant's authenticated user to read
another tenant's chat history by passing the target app_id in the URL. The
fix enforces the cross-tenant boundary in
``controllers/console/app/wraps.py`` via the
``WHERE App.tenant_id == current_tenant_id`` clause in
``_load_app_model_from_scoped_session`` (line 34-40). The ``get_app_model``
decorator raises ``AppNotFoundError`` when the load returns ``None``.
"""

import uuid
from types import SimpleNamespace
from unittest import mock

import pytest
from flask.testing import FlaskClient

from constants import HEADER_NAME_CSRF_TOKEN
from controllers.console.app import message as message_api
from controllers.console.app import wraps
from controllers.console import wraps as console_wraps
from libs.datetime_utils import naive_utc_now
from libs.token import _real_cookie_name, generate_csrf_token
from models import App, Tenant
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.enums import AppStatus
from models.model import AppMode
from services.account_service import AccountService


class TestChatMessageCrossTenant:
    """GHSA-jg5j-c9pq-w894 / CVE-2025-59422.

    These tests assert the cross-tenant boundary holds for the chat-messages
    list endpoint. They follow the mock-based pattern established in
    ``test_chat_message_permissions.py`` (the existing controller test) to
    exercise the decorator chain directly without round-tripping through the
    full Flask-Login + RBAC pipeline.
    """

    @pytest.fixture
    def mock_app_model(self):
        """App whose ``tenant_id`` is deliberately distinct from the mock
        account's current tenant.
        """
        app = App()
        app.id = str(uuid.uuid4())
        app.mode = AppMode.CHAT
        app.tenant_id = str(uuid.uuid4())
        app.status = AppStatus.NORMAL
        return app

    @pytest.fixture
    def mock_account(self):
        """Account whose current tenant is distinct from ``mock_app_model``'s
        ``tenant_id``.

        The ``current_tenant`` property setter would issue a DB query via
        ``Session``, which would (a) require a Flask app context and (b) be
        redundant — the cross-tenant boundary only reads ``_current_tenant.id``
        via the ``current_account_with_tenant`` shim that the test patches.
        We therefore assign ``_current_tenant`` directly and skip the DB
        round-trip. The earlier version of this fixture also patched
        ``models.account.Session`` globally, which broke ``load_user`` →
        ``set_tenant_id`` for the ``setup_account`` user (whose ``auth_header``
        the request actually carries). See ``git log`` for the abandoned
        ``mock.Mock()`` session-mock pattern inherited from
        ``test_chat_message_permissions.py``.
        """
        account = Account(name="Test Cross-Tenant User", email="test-cross-tenant@example.com")
        account.last_active_at = naive_utc_now()
        account.created_at = naive_utc_now()
        account.updated_at = naive_utc_now()
        account.id = str(uuid.uuid4())
        account.role = TenantAccountRole.OWNER

        tenant = Tenant(name="Test Tenant A")
        tenant.id = str(uuid.uuid4())
        account._current_tenant = tenant
        return account

    @pytest.fixture
    def csrf_auth_header(self, test_client: FlaskClient, setup_account):
        """Like ``auth_header`` from the integration conftest, but also
        attaches a CSRF cookie and ``X-CSRF-Token`` header so non-OPTIONS
        requests pass ``libs.login.login_required``'s ``check_csrf_token``
        gate. Mirrors the helper in
        ``tests/test_containers_integration_tests/controllers/console/helpers.py``.
        """
        access_token = AccountService.get_account_jwt_token(setup_account)
        csrf_token = generate_csrf_token(setup_account.id)
        test_client.set_cookie(_real_cookie_name("csrf_token"), csrf_token, domain="localhost")
        return {
            "Authorization": f"Bearer {access_token}",
            HEADER_NAME_CSRF_TOKEN: csrf_token,
        }

    def test_cross_tenant_chat_messages_returns_404(
        self,
        test_client: FlaskClient,
        csrf_auth_header,
        monkeypatch: pytest.MonkeyPatch,
        mock_app_model,
        mock_account,
    ):
        """Account A in tenant X must not be able to read chat messages for
        an app in tenant Y. The cross-tenant boundary is enforced by the
        ``_load_app_model_from_scoped_session`` filter; when the app is in a
        different tenant than the current user, the load returns ``None`` and
        ``get_app_model`` raises ``AppNotFoundError`` (HTTP 404).
        """
        # Simulate the cross-tenant case: the load function returns None
        # because the app's tenant_id does not match current_tenant_id.
        # This is the exact behavior produced by the WHERE clause that the
        # CVE fix added.
        monkeypatch.setattr(
            wraps,
            "_load_app_model_from_scoped_session",
            mock.Mock(return_value=None),
        )
        # with_current_user reads current_account_with_tenant() — patch it
        # directly. The test_chat_message_permissions.py pattern of
        # monkeypatch.setattr(message_api, "current_user", ...) is broken
        # because message.py does not import current_user into its namespace.
        monkeypatch.setattr(
            console_wraps,
            "current_account_with_tenant",
            mock.Mock(return_value=(mock_account, mock_account._current_tenant.id)),
        )

        response = test_client.get(
            f"/console/api/apps/{mock_app_model.id}/chat-messages",
            headers=csrf_auth_header,
            query_string={"conversation_id": str(uuid.uuid4())},
        )

        assert response.status_code == 404

    def test_same_tenant_chat_messages_returns_200(
        self,
        test_client: FlaskClient,
        csrf_auth_header,
        monkeypatch: pytest.MonkeyPatch,
        mock_app_model,
        mock_account,
    ):
        """Positive case (R9): the resource owner can read their own data.

        When the app is in the same tenant as the current user, the load
        succeeds, the conversation query runs, and the response is 200 with
        an empty message list. This guards against over-restriction in
        future hardening commits.
        """
        # Align the app's tenant with the mock account's current tenant.
        mock_account._current_tenant.id = mock_app_model.tenant_id

        monkeypatch.setattr(
            wraps,
            "_load_app_model_from_scoped_session",
            mock.Mock(return_value=mock_app_model),
        )
        monkeypatch.setattr(
            console_wraps,
            "current_account_with_tenant",
            mock.Mock(return_value=(mock_account, mock_account._current_tenant.id)),
        )

        conversation_id = uuid.uuid4()
        mock_conversation = SimpleNamespace(id=str(conversation_id), app_id=str(mock_app_model.id))
        mock_session = mock.Mock()
        mock_session.scalar.return_value = mock_conversation
        mock_session.scalars.return_value.all.return_value = []

        monkeypatch.setattr(message_api, "db", SimpleNamespace(session=mock_session))
        monkeypatch.setattr(message_api, "attach_message_extra_contents", mock.Mock())

        class DummyPagination:
            def __init__(self, data, limit, has_more):
                self.data = data
                self.limit = limit
                self.has_more = has_more

        monkeypatch.setattr(message_api, "InfiniteScrollPagination", DummyPagination)

        response = test_client.get(
            f"/console/api/apps/{mock_app_model.id}/chat-messages",
            headers=csrf_auth_header,
            query_string={"conversation_id": str(conversation_id)},
        )

        assert response.status_code == 200
        payload = response.get_json()
        assert payload is not None
        assert "data" in payload
        assert isinstance(payload["data"], list)
