import json
from unittest.mock import ANY, MagicMock, patch

from flask import Blueprint, Flask, Response, request

from extensions.ext_login import load_user_from_request, unauthorized_handler


def test_unauthorized_handler_returns_json_response() -> None:
    response = unauthorized_handler()

    assert isinstance(response, Response)
    assert response.status_code == 401
    assert response.content_type == "application/json"
    assert json.loads(response.get_data(as_text=True)) == {
        "code": "unauthorized",
        "message": "Unauthorized.",
    }


def test_console_request_loader_uses_session_claim_for_account_lookup() -> None:
    app = Flask(__name__)
    app.config["TESTING"] = True
    console = Blueprint("console", __name__, url_prefix="/console/api")
    account = MagicMock()

    @console.route("/account/profile")
    def profile() -> tuple[str, int]:
        loaded_account = load_user_from_request(request)
        assert loaded_account is account
        return "ok", 200

    app.register_blueprint(console)

    with (
        patch("extensions.ext_login.PassportService") as mock_passport_service,
        patch("extensions.ext_login.AccountService.load_logged_in_account") as mock_load_logged_in_account,
    ):
        mock_passport_service.return_value.verify.return_value = {
            "user_id": "account-id",
            "session_id": "session-id",
        }
        mock_load_logged_in_account.return_value = account

        response = app.test_client().get(
            "/console/api/account/profile",
            headers={"Authorization": "Bearer access-token"},
        )

    assert response.status_code == 200
    mock_load_logged_in_account.assert_called_once_with(
        account_id="account-id",
        session_id="session-id",
        session=ANY,
    )
