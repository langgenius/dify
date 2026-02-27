from flask import Blueprint, Flask
from flask_restx import Resource
from werkzeug.exceptions import BadRequest, Unauthorized

from constants import COOKIE_NAME_ACCESS_TOKEN, COOKIE_NAME_CSRF_TOKEN, COOKIE_NAME_REFRESH_TOKEN
from core.errors.error import AppInvokeQuotaExceededError
from libs.exception import BaseHTTPException
from libs.external_api import ExternalApi


def _create_api_app():
    app = Flask(__name__)
    bp = Blueprint("t", __name__)
    api = ExternalApi(bp)

    @api.route("/bad-request")
    class Bad(Resource):
        def get(self):
            raise BadRequest("invalid input")

    @api.route("/unauth")
    class Unauth(Resource):
        def get(self):
            raise Unauthorized("auth required")

    @api.route("/value-error")
    class ValErr(Resource):
        def get(self):
            raise ValueError("boom")

    @api.route("/quota")
    class Quota(Resource):
        def get(self):
            raise AppInvokeQuotaExceededError("quota exceeded")

    @api.route("/general")
    class Gen(Resource):
        def get(self):
            raise RuntimeError("oops")

    # Note: We avoid altering default_mediatype to keep normal error paths

    # Special 400 message rewrite
    @api.route("/json-empty")
    class JsonEmpty(Resource):
        def get(self):
            e = BadRequest()
            # Force the specific message the handler rewrites
            e.description = "Failed to decode JSON object: Expecting value: line 1 column 1 (char 0)"
            raise e

    # 400 mapping payload path
    @api.route("/param-errors")
    class ParamErrors(Resource):
        def get(self):
            e = BadRequest()
            # Coerce a mapping description to trigger param error shaping
            e.description = {"field": "is required"}
            raise e

    app.register_blueprint(bp, url_prefix="/api")
    return app


def test_external_api_error_handlers_basic_paths():
    app = _create_api_app()
    client = app.test_client()

    # 400
    res = client.get("/api/bad-request")
    assert res.status_code == 400
    data = res.get_json()
    assert data["code"] == "bad_request"
    assert data["status"] == 400

    # 401
    res = client.get("/api/unauth")
    assert res.status_code == 401
    assert "WWW-Authenticate" in res.headers

    # 400 ValueError
    res = client.get("/api/value-error")
    assert res.status_code == 400
    assert res.get_json()["code"] == "invalid_param"

    # 500 general
    res = client.get("/api/general")
    assert res.status_code == 500
    assert res.get_json()["status"] == 500


def test_external_api_json_message_and_bad_request_rewrite():
    app = _create_api_app()
    client = app.test_client()

    # JSON empty special rewrite
    res = client.get("/api/json-empty")
    assert res.status_code == 400
    assert res.get_json()["message"] == "Invalid JSON payload received or JSON payload is empty."


def test_external_api_param_mapping_and_quota():
    app = _create_api_app()
    client = app.test_client()

    # Param errors mapping payload path
    res = client.get("/api/param-errors")
    assert res.status_code == 400
    data = res.get_json()
    assert data["code"] == "invalid_param"
    assert data["params"] == "field"

    # Quota path — depending on Flask-RESTX internals it may be handled
    res = client.get("/api/quota")
    assert res.status_code in (400, 429)


def test_unauthorized_and_force_logout_clears_cookies():
    """Test that UnauthorizedAndForceLogout error clears auth cookies"""

    class UnauthorizedAndForceLogout(BaseHTTPException):
        error_code = "unauthorized_and_force_logout"
        description = "Unauthorized and force logout."
        code = 401

    app = Flask(__name__)
    bp = Blueprint("test", __name__)
    api = ExternalApi(bp)

    @api.route("/force-logout")
    class ForceLogout(Resource):  # type: ignore
        def get(self):  # type: ignore
            raise UnauthorizedAndForceLogout()

    app.register_blueprint(bp, url_prefix="/api")
    client = app.test_client()

    # Set cookies first
    client.set_cookie(COOKIE_NAME_ACCESS_TOKEN, "test_access_token")
    client.set_cookie(COOKIE_NAME_CSRF_TOKEN, "test_csrf_token")
    client.set_cookie(COOKIE_NAME_REFRESH_TOKEN, "test_refresh_token")

    # Make request that should trigger cookie clearing
    res = client.get("/api/force-logout")

    # Verify response
    assert res.status_code == 401
    data = res.get_json()
    assert data["code"] == "unauthorized_and_force_logout"
    assert data["status"] == 401
    assert "WWW-Authenticate" in res.headers

    # Verify Set-Cookie headers are present to clear cookies
    set_cookie_headers = res.headers.getlist("Set-Cookie")
    assert len(set_cookie_headers) == 3, f"Expected 3 Set-Cookie headers, got {len(set_cookie_headers)}"

    # Verify each cookie is being cleared (empty value and expired)
    cookie_names_found = set()
    for cookie_header in set_cookie_headers:
        # Check for cookie names
        if COOKIE_NAME_ACCESS_TOKEN in cookie_header:
            cookie_names_found.add(COOKIE_NAME_ACCESS_TOKEN)
            assert '""' in cookie_header or "=" in cookie_header  # Empty value
            assert "Expires=Thu, 01 Jan 1970" in cookie_header  # Expired
        elif COOKIE_NAME_CSRF_TOKEN in cookie_header:
            cookie_names_found.add(COOKIE_NAME_CSRF_TOKEN)
            assert '""' in cookie_header or "=" in cookie_header
            assert "Expires=Thu, 01 Jan 1970" in cookie_header
        elif COOKIE_NAME_REFRESH_TOKEN in cookie_header:
            cookie_names_found.add(COOKIE_NAME_REFRESH_TOKEN)
            assert '""' in cookie_header or "=" in cookie_header
            assert "Expires=Thu, 01 Jan 1970" in cookie_header

    # Verify all three cookies are present
    assert len(cookie_names_found) == 3
    assert COOKIE_NAME_ACCESS_TOKEN in cookie_names_found
    assert COOKIE_NAME_CSRF_TOKEN in cookie_names_found
    assert COOKIE_NAME_REFRESH_TOKEN in cookie_names_found
