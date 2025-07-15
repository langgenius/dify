from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, g
from flask_login import LoginManager, UserMixin

from libs.login import _get_user, current_user, login_required


class MockUser(UserMixin):
    """Mock user class for testing."""

    def __init__(self, id: str, is_authenticated: bool = True):
        self.id = id
        self._is_authenticated = is_authenticated

    @property
    def is_authenticated(self):
        return self._is_authenticated


class TestLoginRequired:
    """Test cases for login_required decorator."""

    @pytest.fixture
    def setup_app(self, app: Flask):
        """Set up Flask app with login manager."""
        # Initialize login manager
        login_manager = LoginManager()
        login_manager.init_app(app)

        # Mock unauthorized handler
        login_manager.unauthorized = MagicMock(return_value="Unauthorized")

        # Add a dummy user loader to prevent exceptions
        @login_manager.user_loader
        def load_user(user_id):
            return None

        return app

    def test_authenticated_user_can_access_protected_view(self, setup_app: Flask):
        """Test that authenticated users can access protected views."""

        @login_required
        def protected_view():
            return "Protected content"

        with setup_app.test_request_context():
            # Mock authenticated user
            mock_user = MockUser("test_user", is_authenticated=True)
            with patch("libs.login._get_user", return_value=mock_user):
                result = protected_view()
                assert result == "Protected content"

    def test_unauthenticated_user_cannot_access_protected_view(self, setup_app: Flask):
        """Test that unauthenticated users are redirected."""

        @login_required
        def protected_view():
            return "Protected content"

        with setup_app.test_request_context():
            # Mock unauthenticated user
            mock_user = MockUser("test_user", is_authenticated=False)
            with patch("libs.login._get_user", return_value=mock_user):
                result = protected_view()
                assert result == "Unauthorized"
                setup_app.login_manager.unauthorized.assert_called_once()

    def test_login_disabled_allows_unauthenticated_access(self, setup_app: Flask):
        """Test that LOGIN_DISABLED config bypasses authentication."""

        @login_required
        def protected_view():
            return "Protected content"

        with setup_app.test_request_context():
            # Mock unauthenticated user and LOGIN_DISABLED
            mock_user = MockUser("test_user", is_authenticated=False)
            with patch("libs.login._get_user", return_value=mock_user):
                with patch("libs.login.dify_config") as mock_config:
                    mock_config.LOGIN_DISABLED = True

                    result = protected_view()
                    assert result == "Protected content"
                    # Ensure unauthorized was not called
                    setup_app.login_manager.unauthorized.assert_not_called()

    def test_options_request_bypasses_authentication(self, setup_app: Flask):
        """Test that OPTIONS requests are exempt from authentication."""

        @login_required
        def protected_view():
            return "Protected content"

        with setup_app.test_request_context(method="OPTIONS"):
            # Mock unauthenticated user
            mock_user = MockUser("test_user", is_authenticated=False)
            with patch("libs.login._get_user", return_value=mock_user):
                result = protected_view()
                assert result == "Protected content"
                # Ensure unauthorized was not called
                setup_app.login_manager.unauthorized.assert_not_called()

    def test_flask_2_compatibility(self, setup_app: Flask):
        """Test Flask 2.x compatibility with ensure_sync."""

        @login_required
        def protected_view():
            return "Protected content"

        # Mock Flask 2.x ensure_sync
        setup_app.ensure_sync = MagicMock(return_value=lambda: "Synced content")

        with setup_app.test_request_context():
            mock_user = MockUser("test_user", is_authenticated=True)
            with patch("libs.login._get_user", return_value=mock_user):
                result = protected_view()
                assert result == "Synced content"
                setup_app.ensure_sync.assert_called_once()

    def test_flask_1_compatibility(self, setup_app: Flask):
        """Test Flask 1.x compatibility without ensure_sync."""

        @login_required
        def protected_view():
            return "Protected content"

        # Remove ensure_sync to simulate Flask 1.x
        if hasattr(setup_app, "ensure_sync"):
            delattr(setup_app, "ensure_sync")

        with setup_app.test_request_context():
            mock_user = MockUser("test_user", is_authenticated=True)
            with patch("libs.login._get_user", return_value=mock_user):
                result = protected_view()
                assert result == "Protected content"


class TestGetUser:
    """Test cases for _get_user function."""

    def test_get_user_returns_user_from_g(self, app: Flask):
        """Test that _get_user returns user from g._login_user."""
        mock_user = MockUser("test_user")

        with app.test_request_context():
            g._login_user = mock_user
            user = _get_user()
            assert user == mock_user
            assert user.id == "test_user"

    def test_get_user_loads_user_if_not_in_g(self, app: Flask):
        """Test that _get_user loads user if not already in g."""
        mock_user = MockUser("test_user")

        # Mock login manager
        login_manager = MagicMock()
        login_manager._load_user = MagicMock()
        app.login_manager = login_manager

        with app.test_request_context():
            # Simulate _load_user setting g._login_user
            def side_effect():
                g._login_user = mock_user

            login_manager._load_user.side_effect = side_effect

            user = _get_user()
            assert user == mock_user
            login_manager._load_user.assert_called_once()

    def test_get_user_returns_none_without_request_context(self, app: Flask):
        """Test that _get_user returns None outside request context."""
        # Outside of request context
        user = _get_user()
        assert user is None


class TestCurrentUser:
    """Test cases for current_user proxy."""

    def test_current_user_proxy_returns_authenticated_user(self, app: Flask):
        """Test that current_user proxy returns authenticated user."""
        mock_user = MockUser("test_user", is_authenticated=True)

        with app.test_request_context():
            with patch("libs.login._get_user", return_value=mock_user):
                assert current_user.id == "test_user"
                assert current_user.is_authenticated is True

    def test_current_user_proxy_returns_none_when_no_user(self, app: Flask):
        """Test that current_user proxy handles None user."""
        with app.test_request_context():
            with patch("libs.login._get_user", return_value=None):
                # When _get_user returns None, accessing attributes should fail
                # or current_user should evaluate to falsy
                try:
                    # Try to access an attribute that would exist on a real user
                    _ = current_user.id
                    pytest.fail("Should have raised AttributeError")
                except AttributeError:
                    # This is expected when current_user is None
                    pass

    def test_current_user_proxy_thread_safety(self, app: Flask):
        """Test that current_user proxy is thread-safe."""
        import threading

        results = {}

        def check_user_in_thread(user_id: str, index: int):
            with app.test_request_context():
                mock_user = MockUser(user_id)
                with patch("libs.login._get_user", return_value=mock_user):
                    results[index] = current_user.id

        # Create multiple threads with different users
        threads = []
        for i in range(5):
            thread = threading.Thread(target=check_user_in_thread, args=(f"user_{i}", i))
            threads.append(thread)
            thread.start()

        # Wait for all threads to complete
        for thread in threads:
            thread.join()

        # Verify each thread got its own user
        for i in range(5):
            assert results[i] == f"user_{i}"
