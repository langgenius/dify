from flask import Blueprint, Flask
from flask_cors import CORS

from extensions.ext_blueprints import AUTHENTICATED_HEADERS, EXPOSED_HEADERS


def test_console_preflight_allows_personal_access_token_idempotency_key() -> None:
    blueprint = Blueprint("console_cors", __name__, url_prefix="/console/api")
    blueprint.add_url_rule("/account/personal-access-tokens", view_func=lambda: "ok", methods=["POST"])
    CORS(
        blueprint,
        resources={r"/*": {"origins": ["http://localhost:3000"]}},
        supports_credentials=True,
        allow_headers=list(AUTHENTICATED_HEADERS),
        methods=["GET", "PUT", "POST", "DELETE", "OPTIONS", "PATCH"],
        expose_headers=list(EXPOSED_HEADERS),
    )
    app = Flask(__name__)
    app.register_blueprint(blueprint)

    response = app.test_client().options(
        "/console/api/account/personal-access-tokens",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-csrf-token,idempotency-key",
        },
    )

    assert response.headers.get("Access-Control-Allow-Origin") == "http://localhost:3000"
    allowed_headers = response.headers.get("Access-Control-Allow-Headers", "").lower()
    assert "idempotency-key" in allowed_headers
