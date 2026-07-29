from unittest import mock

import pytest
from werkzeug.exceptions import Unauthorized

from core.logging.context import clear_request_context, get_identity_context


@pytest.fixture(autouse=True)
def _reset_logging_context():
    clear_request_context()
    yield
    clear_request_context()


def test_validate_jwt_token_sets_logging_identity_before_view() -> None:
    from controllers.web import wraps

    app_model = mock.Mock()
    end_user = mock.Mock(id="end-user-id", tenant_id="tenant-id", type=None)
    clear_request_context()

    @wraps.validate_jwt_token
    def protected_view(received_app, received_user):
        assert get_identity_context() == ("tenant-id", "end-user-id", "end_user")
        return received_app, received_user

    with mock.patch.object(wraps, "decode_jwt_token", return_value=(app_model, end_user)):
        result = protected_view()

    assert result == (app_model, end_user)


def test_validate_jwt_token_does_not_set_identity_when_authentication_fails() -> None:
    from controllers.web import wraps

    clear_request_context()

    @wraps.validate_jwt_token
    def protected_view(_app, _user):
        raise AssertionError("view must not be called")

    with (
        mock.patch.object(wraps, "decode_jwt_token", side_effect=Unauthorized()),
        pytest.raises(Unauthorized),
    ):
        protected_view()

    assert get_identity_context() == ("", "", "")
