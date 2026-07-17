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
from sqlalchemy import select

from constants import HEADER_NAME_CSRF_TOKEN
from controllers.console import wraps as console_wraps
from controllers.console.app import message as message_api
from controllers.console.app import wraps
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.token import _real_cookie_name, generate_csrf_token
from models import App, Tenant
from models.account import Account, AccountStatus, TenantAccountJoin, TenantAccountRole, TenantStatus
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


class TestChatMessageCrossTenantRealDB:
    """Real-DB verification of the WHERE App.tenant_id == current_tenant_id clause.

    The mock-based ``TestChatMessageCrossTenant`` tests above verify the decorator
    chain ("load returns None → controller returns 404"), but they mock the load
    function itself, so reverting the WHERE clause would not cause them to fail.
    This class exercises the *real* ``_load_app_model_from_scoped_session``
    against a real cross-tenant App row in PostgreSQL, so it actually exercises
    the WHERE clause the CVE fix added. R5 in the plan asks us to verify the
    regression tests fail against unpatched code — that verification lives here.
    """

    @pytest.fixture
    def cross_tenant_app(self, flask_app, setup_account):
        """Create a real App row in a tenant distinct from ``setup_account``'s tenant.

        Uses ``db.session`` (scoped via ``flask_app``) so the row is visible to
        the real load function. Cleans up the row, the tenant, and the owning
        account on teardown so the suite does not accumulate rows across runs.

        The fixture uses ``flask_app`` (function-scoped) to provide a Flask app
        context for ``db.session`` writes. ``setup_account`` is requested to
        force its setup (which itself needs a request context, handled inside
        that fixture).
        """
        from sqlalchemy import delete as sql_delete

        cross_app_id = None
        owner_b_id = None
        tenant_b_id = None
        cross_app = None

        with flask_app.test_request_context():
            owner_b = Account(
                name="Cross-Tenant Owner",
                email=f"cross-tenant-{uuid.uuid4()}@example.com",
                status=AccountStatus.ACTIVE,
                interface_language="en-US",
            )
            db.session.add(owner_b)
            db.session.flush()

            tenant_b = Tenant(name="Test Tenant B (cross-tenant)", status=TenantStatus.NORMAL)
            db.session.add(tenant_b)
            db.session.flush()

            join_b = TenantAccountJoin(
                tenant_id=tenant_b.id,
                account_id=owner_b.id,
                role=TenantAccountRole.OWNER,
                current=True,
            )
            db.session.add(join_b)

            cross_app = App(
                tenant_id=tenant_b.id,
                name="cross-tenant-app",
                description="App owned by tenant B, should not be visible to tenant A",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=True,
                api_rpm=60,
                api_rph=3600,
                is_demo=False,
                is_public=False,
                created_by=owner_b.id,
                updated_by=owner_b.id,
            )
            db.session.add(cross_app)
            db.session.commit()

            # Capture IDs inside the request context, before objects expire.
            cross_app_id = cross_app.id
            owner_b_id = owner_b.id
            tenant_b_id = tenant_b.id

        yield cross_app

        with flask_app.test_request_context():
            db.session.execute(sql_delete(App).where(App.id == cross_app_id))
            db.session.execute(sql_delete(TenantAccountJoin).where(TenantAccountJoin.account_id == owner_b_id))
            db.session.execute(sql_delete(Account).where(Account.id == owner_b_id))
            db.session.execute(sql_delete(Tenant).where(Tenant.id == tenant_b_id))
            db.session.commit()

    def test_real_load_filters_cross_tenant_app(self, flask_app, cross_tenant_app, setup_account, monkeypatch):
        """The real ``_load_app_model_from_scoped_session`` must return ``None``
        for an app whose tenant does not match the current user's tenant.

        Without the ``WHERE App.tenant_id == current_tenant_id`` clause added by
        the CVE fix, this test would fail (the load would return the
        cross-tenant App row instead of ``None``). With the clause in place, the
        load correctly filters out the row.

        We patch ``current_account_with_tenant`` to return ``setup_account``'s
        real tenant (read from the DB) so the test exercises the real SQL
        WHERE clause rather than a mocked-out one. The patch only supplies the
        identity input; the SQL filter itself is the production code.
        """
        cross_app_id = cross_tenant_app.id
        with flask_app.test_request_context():
            # setup_account is the real account created by the conftest
            # setup_account fixture. Its _current_tenant is not auto-set by
            # the fixture, so look up the tenant via the join to get a real
            # tenant id.
            from models.account import TenantAccountJoin

            current_tenant_id = db.session.scalar(
                select(TenantAccountJoin.tenant_id).where(TenantAccountJoin.account_id == setup_account.id).limit(1)
            )
            assert current_tenant_id is not None, "Test setup error: setup_account has no tenant join"
            assert cross_tenant_app.tenant_id != current_tenant_id, (
                "Test fixture error: cross-tenant app must be in a different tenant from setup_account"
            )

            # Sanity check: the row is actually visible via the same session the
            # load function uses, with no tenant filter. If this assertion fails,
            # the fixture is broken, not the production code.
            unfiltered = db.session.scalar(
                select(App).where(App.id == cross_app_id, App.status == AppStatus.NORMAL).limit(1)
            )
            assert unfiltered is not None, (
                "Test fixture error: cross-tenant App row is not visible via db.session. "
                "Check that the fixture committed the row."
            )
            assert unfiltered.id == cross_app_id, (
                "Test fixture error: cross-tenant App row id mismatch — fixture wrote a different row."
            )

            # Provide the current user's tenant id. This is the only thing
            # mocked: the SQL clause that consumes it is the production code.
            monkeypatch.setattr(
                wraps,
                "current_account_with_tenant",
                lambda: (setup_account, current_tenant_id),
            )

            # The real load. setup_account's tenant_id does not match
            # cross_tenant_app.tenant_id, so the WHERE clause must filter the
            # row out and return None.
            result = wraps._load_app_model_from_scoped_session(cross_app_id)

            assert result is None, (
                f"_load_app_model_from_scoped_session returned {result!r} for a "
                "cross-tenant app — the tenant filter in the WHERE clause is missing"
            )

    def test_real_load_returns_same_tenant_app(self, flask_app, setup_account, monkeypatch):
        """Positive case: a real App in the current user's tenant is returned.

        Guards against the WHERE clause being too restrictive (e.g. always
        returning ``None``). Uses the same load function as the cross-tenant
        test, but with the tenant ids aligned so the SQL matches.
        """
        from sqlalchemy import delete as sql_delete

        with flask_app.test_request_context():
            from models.account import TenantAccountJoin

            current_tenant_id = db.session.scalar(
                select(TenantAccountJoin.tenant_id).where(TenantAccountJoin.account_id == setup_account.id).limit(1)
            )
            assert current_tenant_id is not None, "Test setup error: setup_account has no tenant join"

            same_tenant_app = App(
                tenant_id=current_tenant_id,
                name="same-tenant-app",
                description="App owned by setup_account's tenant",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=True,
                api_rpm=60,
                api_rph=3600,
                is_demo=False,
                is_public=False,
                created_by=setup_account.id,
                updated_by=setup_account.id,
            )
            db.session.add(same_tenant_app)
            db.session.commit()
            same_tenant_app_id = same_tenant_app.id

            try:
                monkeypatch.setattr(
                    wraps,
                    "current_account_with_tenant",
                    lambda: (setup_account, current_tenant_id),
                )

                result = wraps._load_app_model_from_scoped_session(same_tenant_app_id)
                assert result is not None, (
                    "_load_app_model_from_scoped_session returned None for a "
                    "same-tenant app — the WHERE clause is too restrictive"
                )
                assert result.id == same_tenant_app_id
            finally:
                db.session.execute(sql_delete(App).where(App.id == same_tenant_app_id))
                db.session.commit()
