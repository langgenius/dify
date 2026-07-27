"""Regression coverage for authenticated browser CORS headers."""

from flask import Blueprint, Flask

from extensions.ext_blueprints import AUTHENTICATED_HEADERS, _apply_cors_once


def test_authenticated_cors_allows_request_metadata_headers() -> None:
    app = Flask(__name__)
    blueprint = Blueprint("cors_probe", __name__, url_prefix="/console/api")

    @blueprint.post("/probe")
    def probe() -> tuple[str, int]:
        return "", 204

    _apply_cors_once(
        blueprint,
        resources={r"/*": {"origins": ["http://localhost:3000"]}},
        supports_credentials=True,
        allow_headers=list(AUTHENTICATED_HEADERS),
        methods=["POST", "OPTIONS"],
    )
    app.register_blueprint(blueprint)

    response = app.test_client().options(
        "/console/api/probe",
        headers={
            "Access-Control-Request-Headers": "Idempotency-Key, X-Request-ID",
            "Access-Control-Request-Method": "POST",
            "Origin": "http://localhost:3000",
        },
    )

    allowed_headers = response.headers.get("Access-Control-Allow-Headers", "").lower()
    assert "idempotency-key" in allowed_headers
    assert "x-request-id" in allowed_headers
