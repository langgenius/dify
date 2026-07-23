import contextvars
import threading
from unittest import mock

import pytest
from flask import Flask
from flask_login import LoginManager, UserMixin, current_user, login_user

from core.logging.context import clear_request_context, get_identity_context, set_identity_context
from libs.flask_utils import preserve_flask_contexts, set_login_user


class User(UserMixin):
    """Simple User class for testing."""

    def __init__(self, id: str):
        self.id = id

    def get_id(self) -> str:
        return self.id


@pytest.fixture(autouse=True)
def _reset_logging_context():
    clear_request_context()
    yield
    clear_request_context()


@pytest.fixture
def login_app(app: Flask) -> Flask:
    """Set up a Flask app with flask-login."""
    # Set a secret key for the app
    app.config["SECRET_KEY"] = "test-secret-key"

    login_manager = LoginManager()
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id: str) -> User | None:
        if user_id == "test_user":
            return User("test_user")
        return None

    return app


@pytest.fixture
def test_user() -> User:
    """Create a test user."""
    return User("test_user")


def test_current_user_not_accessible_across_threads(login_app: Flask, test_user: User):
    """
    Test that current_user is not accessible in a different thread without preserve_flask_contexts.

    This test demonstrates that without the preserve_flask_contexts, we cannot access
    current_user in a different thread, even with app_context.
    """
    # Log in the user in the main thread
    with login_app.test_request_context():
        login_user(test_user)
        assert current_user.is_authenticated
        assert current_user.id == "test_user"

        # Store the result of the thread execution
        result = {"user_accessible": True, "error": None}

        # Define a function to run in a separate thread
        def check_user_in_thread():
            try:
                # Try to access current_user in a different thread with app_context
                with login_app.app_context():
                    # This should fail because current_user is not accessible across threads
                    # without preserve_flask_contexts
                    result["user_accessible"] = current_user.is_authenticated
            except Exception as e:
                result["error"] = str(e)

        # Run the function in a separate thread
        thread = threading.Thread(target=check_user_in_thread)
        thread.start()
        thread.join()

        # Verify that we got an error or current_user is not authenticated
        assert result["error"] is not None or (result["user_accessible"] is not None and not result["user_accessible"])


def test_current_user_accessible_with_preserve_flask_contexts(login_app: Flask, test_user: User):
    """
    Test that current_user is accessible in a different thread with preserve_flask_contexts.

    This test demonstrates that with the preserve_flask_contexts, we can access
    current_user in a different thread.
    """
    # Log in the user in the main thread
    with login_app.test_request_context():
        login_user(test_user)
        assert current_user.is_authenticated
        assert current_user.id == "test_user"

        # Save the context variables
        context_vars = contextvars.copy_context()

        # Store the result of the thread execution
        result = {"user_accessible": False, "user_id": None, "error": None}

        # Define a function to run in a separate thread
        def check_user_in_thread_with_manager():
            try:
                # Use preserve_flask_contexts to access current_user in a different thread
                with preserve_flask_contexts(login_app, context_vars):
                    from flask_login import current_user

                    if current_user:
                        result["user_accessible"] = True
                        result["user_id"] = current_user.id
                    else:
                        result["user_accessible"] = False
            except Exception as e:
                result["error"] = str(e)

        # Run the function in a separate thread
        thread = threading.Thread(target=check_user_in_thread_with_manager)
        thread.start()
        thread.join()

        # Verify that current_user is accessible and has the correct ID
        assert result["error"] is None
        assert result["user_accessible"] is True
        assert result["user_id"] == "test_user"


def test_set_login_user_snapshots_account_identity(app: Flask) -> None:
    from flask import g

    from models import Account

    user = mock.Mock(spec=Account)
    user.id = "account-id"
    user.current_tenant_id = "tenant-id"

    with app.app_context():
        set_login_user(user)

        assert g._login_user is user
        assert get_identity_context() == ("tenant-id", "account-id", "account")


def test_set_login_user_snapshots_end_user_identity(app: Flask) -> None:
    from flask import g

    from models import EndUser

    user = mock.Mock(spec=EndUser)
    user.id = "end-user-id"
    user.tenant_id = "tenant-id"
    user.type = "browser"

    with app.app_context():
        set_login_user(user)

        assert g._login_user is user
        assert get_identity_context() == ("tenant-id", "end-user-id", "browser")


def test_set_login_user_keeps_user_when_identity_is_unavailable(app: Flask) -> None:
    from flask import g

    from models import Account

    user = mock.Mock(spec=Account)
    type(user).current_tenant_id = mock.PropertyMock(side_effect=RuntimeError("unavailable"))
    user.id = "account-id"
    set_identity_context(tenant_id="stale", user_id="stale", user_type="stale")

    with app.app_context():
        set_login_user(user)

        assert g._login_user is user
        assert get_identity_context() == ("", "", "")
