from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask, g
from flask_login import LoginManager, UserMixin
from pytest_mock import MockerFixture

import libs.login as login_module
from libs.login import current_user
from models.account import Account


@pytest.fixture
def protected_view():
    """Build a small login-protected view that exercises the decorator logic."""

    @login_module.login_required
    def _protected_view():
        return "Protected content"

    return _protected_view


class MockUser(UserMixin):
    """Mock user class for testing."""

    def __init__(self, id: str, is_authenticated: bool = True):
        self.id = id
        self._is_authenticated = is_authenticated

    @property
    def is_authenticated(self) -> bool:
        return self._is_authenticated


@pytest.fixture
def login_app(mocker: MockerFixture) -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True

    login_manager = LoginManager()
    login_manager.init_app(app)
    login_manager.unauthorized = mocker.Mock(name="unauthorized", return_value="Unauthorized")

    @login_manager.user_loader
    def load_user(_user_id: str):
        return None

    return app


@pytest.fixture(autouse=True)
def reset_login_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(login_module.dify_config, "LOGIN_DISABLED", False)


@pytest.fixture
def csrf_check(mocker: MockerFixture) -> MagicMock:
    return mocker.patch.object(login_module, "check_csrf_token")


@pytest.fixture
def resolve_current_user(mocker: MockerFixture):
    def _patch(user: MockUser | Account | None) -> MagicMock:
        return mocker.patch.object(login_module, "_resolve_current_user", return_value=user)

    return _patch


class TestLoginRequired:
    """Test cases for login_required decorator."""

    def test_authenticated_user_can_access_protected_view(
        self,
        login_app: Flask,
        protected_view,
        csrf_check: MagicMock,
        resolve_current_user,
    ):
        """Test that authenticated users can access protected views."""

        mock_user = MockUser("test_user", is_authenticated=True)
        resolve_user = resolve_current_user(mock_user)

        with login_app.test_request_context():
            result = protected_view()
            csrf_check.assert_called_once()
            assert csrf_check.call_args.args[0].method == "GET"
            assert csrf_check.call_args.args[1] == "test_user"

        assert result == "Protected content"
        resolve_user.assert_called_once_with()
        login_app.login_manager.unauthorized.assert_not_called()

    @pytest.mark.parametrize(
        ("resolved_user", "description"),
        [
            pytest.param(None, "missing user", id="missing-user"),
            pytest.param(MockUser("test_user", is_authenticated=False), "unauthenticated user", id="unauthenticated"),
        ],
    )
    def test_unauthorized_access_returns_login_manager_response(
        self,
        login_app: Flask,
        protected_view,
        csrf_check: MagicMock,
        resolve_current_user,
        resolved_user: MockUser | None,
        description: str,
    ):
        """Test that missing or unauthenticated users are redirected."""

        resolve_user = resolve_current_user(resolved_user)

        with login_app.test_request_context():
            result = protected_view()

        assert result == "Unauthorized", description
        resolve_user.assert_called_once_with()
        login_app.login_manager.unauthorized.assert_called_once_with()
        csrf_check.assert_not_called()

    @pytest.mark.parametrize(
        ("method", "login_disabled"),
        [
            pytest.param("OPTIONS", False, id="options"),
            pytest.param("GET", True, id="login-disabled"),
        ],
    )
    def test_bypass_paths_skip_authentication_and_csrf(
        self,
        login_app: Flask,
        protected_view,
        csrf_check: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
        resolve_current_user,
        method: str,
        login_disabled: bool,
    ):
        """Test that bypass conditions skip auth lookup, CSRF, and unauthorized handling."""

        resolve_user = resolve_current_user(MockUser("test_user"))
        monkeypatch.setattr(login_module.dify_config, "LOGIN_DISABLED", login_disabled)

        with login_app.test_request_context(method=method):
            result = protected_view()
        assert result == "Protected content"
        resolve_user.assert_not_called()
        csrf_check.assert_not_called()
        login_app.login_manager.unauthorized.assert_not_called()


class TestGetUser:
    """Test cases for _get_user function."""

    def test_get_user_returns_user_from_g(self, login_app: Flask):
        """Test that _get_user returns user from g._login_user."""
        mock_user = MockUser("test_user")

        with login_app.test_request_context():
            g._login_user = mock_user
            user = login_module._get_user()
            assert user == mock_user
            assert user.id == "test_user"

    def test_get_user_loads_user_if_not_in_g(self, login_app: Flask, mocker: MockerFixture):
        """Test that _get_user loads user if not already in g."""
        mock_user = MockUser("test_user")

        def _load_user() -> None:
            g._login_user = mock_user

        load_user = mocker.patch.object(login_app.login_manager, "_load_user", side_effect=_load_user)

        with login_app.test_request_context():
            user = login_module._get_user()

        assert user == mock_user
        load_user.assert_called_once_with()

    def test_get_user_returns_none_without_request_context(self):
        """Test that _get_user returns None outside request context."""
        user = login_module._get_user()
        assert user is None


class TestCurrentUser:
    """Test cases for current_user proxy."""

    def test_current_user_proxy_returns_authenticated_user(self, login_app: Flask, mocker: MockerFixture):
        """Test that current_user proxy returns authenticated user."""
        mock_user = MockUser("test_user", is_authenticated=True)
        mocker.patch.object(login_module, "_get_user", return_value=mock_user)

        with login_app.test_request_context():
            assert current_user.id == "test_user"
            assert current_user.is_authenticated is True

    def test_current_user_proxy_raises_attribute_error_when_no_user(self, login_app: Flask, mocker: MockerFixture):
        """Test that current_user proxy handles None user."""
        mocker.patch.object(login_module, "_get_user", return_value=None)

        with login_app.test_request_context():
            with pytest.raises(AttributeError):
                _ = current_user.id


class TestCurrentAccountWithTenant:
    """Test cases for current_account_with_tenant helper."""

    def test_returns_account_and_tenant_id(self, mocker: MockerFixture):
        account = Account(name="Test User", email="test@example.com")
        account._current_tenant = SimpleNamespace(id="tenant-123")
        current_user_proxy = mocker.Mock()
        current_user_proxy._get_current_object.return_value = account
        mocker.patch.object(login_module, "current_user", new=current_user_proxy)

        user, tenant_id = login_module.current_account_with_tenant()

        assert user is account
        assert tenant_id == "tenant-123"
        current_user_proxy._get_current_object.assert_called_once_with()

    def test_raises_when_current_user_is_not_account(self, mocker: MockerFixture):
        mocker.patch.object(login_module, "current_user", new=MockUser("test_user"))

        with pytest.raises(ValueError, match="current_user must be an Account instance"):
            login_module.current_account_with_tenant()

    def test_raises_when_account_has_no_tenant(self, mocker: MockerFixture):
        account = Account(name="Test User", email="test@example.com")
        mocker.patch.object(login_module, "current_user", new=account)

        with pytest.raises(AssertionError, match="tenant information should be loaded"):
            login_module.current_account_with_tenant()
