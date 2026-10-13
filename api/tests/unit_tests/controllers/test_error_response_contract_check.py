from flask import Blueprint, Flask, Response, json
from flask_restx import Namespace, Resource
from pydantic import BaseModel

from controllers.common.schema import register_response_schema_models
from libs.exception import BaseHTTPException
from libs.external_api import ExternalApi, error_responses
from tests.unit_tests.controllers.error_contract import violation


class _ItemGoneError(BaseHTTPException):
    error_code = "item_gone"
    code = 404


class _LegacyConflict(BaseModel):
    error: str


def _api() -> tuple[Flask, ExternalApi]:
    app = Flask(__name__)
    blueprint = Blueprint("contract_check", __name__, url_prefix="/check")
    api = ExternalApi(blueprint)
    ns = Namespace("items", path="/")
    register_response_schema_models(ns, _LegacyConflict)

    @ns.route("/items")
    class Items(Resource):
        @ns.response(409, "Legacy conflict", ns.models[_LegacyConflict.__name__])
        @error_responses(_ItemGoneError)
        def get(self) -> dict[str, str]:
            return {}

    api.add_namespace(ns)
    app.register_blueprint(blueprint)
    return app, api


def _check(body: object, status: int) -> str | None:
    app, api = _api()
    with app.test_request_context("/check/items"):
        return violation(api, Response(json.dumps(body), status=status, mimetype="application/json"))


def test_rejects_a_body_without_the_standard_fields() -> None:
    found = _check({"error": "gone"}, 404)
    assert found is not None
    assert "lacks" in found


def test_rejects_a_code_the_operation_does_not_document_for_the_status() -> None:
    found = _check({"code": "surprise", "message": "m", "status": 404}, 404)
    assert found is not None
    assert "'surprise' is not documented" in found


def test_accepts_documented_and_implied_codes() -> None:
    assert _check({"code": "item_gone", "message": "m", "status": 404}, 404) is None
    assert _check({"code": "not_found", "message": "m", "status": 404}, 404) is None


def test_skips_statuses_that_declare_their_own_model() -> None:
    assert _check({"error": "legacy"}, 409) is None
