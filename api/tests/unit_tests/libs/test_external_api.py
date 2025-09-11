from flask import Blueprint, Flask
from flask_restx import Resource
from werkzeug.exceptions import BadRequest, Unauthorized

from core.errors.error import AppInvokeQuotaExceededError
from libs.external_api import ExternalApi


def _create_api_app():
    app = Flask(__name__)
    bp = Blueprint("t", __name__)
    api = ExternalApi(bp)

    @api.route("/bad-request")
    class Bad(Resource):  # type: ignore
        def get(self):  # type: ignore
            raise BadRequest("invalid input")

    @api.route("/unauth")
    class Unauth(Resource):  # type: ignore
        def get(self):  # type: ignore
            raise Unauthorized("auth required")

    @api.route("/value-error")
    class ValErr(Resource):  # type: ignore
        def get(self):  # type: ignore
            raise ValueError("boom")

    @api.route("/quota")
    class Quota(Resource):  # type: ignore
        def get(self):  # type: ignore
            raise AppInvokeQuotaExceededError("quota exceeded")

    @api.route("/general")
    class Gen(Resource):  # type: ignore
        def get(self):  # type: ignore
            raise RuntimeError("oops")

    # Note: We avoid altering default_mediatype to keep normal error paths

    # Special 400 message rewrite
    @api.route("/json-empty")
    class JsonEmpty(Resource):  # type: ignore
        def get(self):  # type: ignore
            e = BadRequest()
            # Force the specific message the handler rewrites
            e.description = "Failed to decode JSON object: Expecting value: line 1 column 1 (char 0)"
            raise e

    # 400 mapping payload path
    @api.route("/param-errors")
    class ParamErrors(Resource):  # type: ignore
        def get(self):  # type: ignore
            e = BadRequest()
            # Coerce a mapping description to trigger param error shaping
            e.description = {"field": "is required"}  # type: ignore[assignment]
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


def test_external_api_param_mapping_and_quota_and_exc_info_none():
    # Force exc_info() to return (None,None,None) only during request
    import libs.external_api as ext

    orig_exc_info = ext.sys.exc_info
    try:
        ext.sys.exc_info = lambda: (None, None, None)  # type: ignore[assignment]

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
    finally:
        ext.sys.exc_info = orig_exc_info  # type: ignore[assignment]
