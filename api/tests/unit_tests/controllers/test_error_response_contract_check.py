import pytest
from flask import Blueprint, Flask, Response, json, request_finished
from flask_restx import Namespace, Resource
from pydantic import BaseModel

from controllers.common.schema import register_response_schema_models
from libs.exception import BaseHTTPException, RelayedHTTPError
from libs.external_api import ExternalApi, error_responses
from tests.unit_tests.controllers import error_contract
from tests.unit_tests.controllers.error_contract import check_response, violation


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

    @ns.route("/relayed")
    class Relayed(Resource):
        @error_responses(_ItemGoneError, RelayedHTTPError)
        def get(self) -> dict[str, str]:
            return {}

    api.add_namespace(ns)
    app.register_blueprint(blueprint)
    return app, api


def _check(body: object, status: int, path: str = "/check/items") -> str | None:
    app, api = _api()
    with app.test_request_context(path):
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


def test_accepts_a_body_matching_a_legacy_model_the_status_declares() -> None:
    assert _check({"error": "legacy"}, 409) is None
    assert _check({"code": "conflict", "message": "m", "status": 409}, 409) is None


def test_rejects_a_documented_code_served_with_another_status(monkeypatch: pytest.MonkeyPatch) -> None:
    # On the surfaces the lint covers every served code must be documented or generic.
    monkeypatch.setattr(error_contract, "_documents_business_errors", lambda _api: True)
    found = _check({"code": "item_gone", "message": "m", "status": 409}, 409)
    assert found is not None
    assert "'item_gone' is not documented" in found


def test_accepts_any_code_from_an_operation_that_relays_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(error_contract, "_documents_business_errors", lambda _api: True)
    assert _check({"code": "downstream_busy", "message": "m", "status": 503}, 503, "/check/relayed") is None
    assert _check({"code": "item_gone", "message": "m", "status": 404}, 404, "/check/relayed") is None
    # Relaying never excuses a body that is not the error body.
    found = _check({"error": "x"}, 503, "/check/relayed")
    assert found is not None
    assert "lacks" in found


def test_only_checks_documented_statuses_on_apis_without_business_errors() -> None:
    # A test-built API (like /openapi/v1) documents nothing, so an undocumented status stays open.
    assert _check({"code": "item_gone", "message": "m", "status": 409}, 409) is None


def test_rejects_a_body_matching_neither_the_legacy_nor_the_standard_model() -> None:
    found = _check({"code": "conflict", "message": "m"}, 409)
    assert found is not None
    assert "lacks ['status']" in found


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"code": "item_gone", "message": {"nested": True}, "status": 404}, "message"),
        ({"code": ["item_gone"], "message": "m", "status": 404}, "code"),
        ({"code": "item_gone", "message": "m", "status": "404"}, "status"),
    ],
)
def test_rejects_standard_fields_of_the_wrong_type(body: dict[str, object], field: str) -> None:
    found = _check(body, 404)
    assert found is not None
    assert "does not match ErrorResponse" in found
    assert f"{field}:" in found


@pytest.mark.allow_error_contract_violations
def test_checks_responses_served_by_an_api_mounted_on_the_app() -> None:
    app = Flask(__name__)
    api = ExternalApi(app)

    @api.route("/items")
    class Items(Resource):
        def get(self) -> tuple[dict[str, str], int]:
            return {"wrong": "shape"}, 400

    violations: list[str] = []

    def receiver(sender: Flask, response: Response, **_: object) -> None:
        check_response(sender, response, violations)

    with request_finished.connected_to(receiver, app):
        app.test_client().get("/items")

    assert len(violations) == 1
    assert "lacks" in violations[0]


@pytest.mark.allow_error_contract_violations
def test_reports_responses_it_cannot_check() -> None:
    app = Flask(__name__)
    api = ExternalApi(app)

    class _Unregistered(BaseModel):
        value: str

    @api.route("/items")
    class Items(Resource):
        @api.response(200, "OK", _Unregistered.__name__)
        def get(self) -> tuple[dict[str, str], int]:
            return {"wrong": "shape"}, 400

    violations: list[str] = []

    def receiver(sender: Flask, response: Response, **_: object) -> None:
        check_response(sender, response, violations)

    with request_finished.connected_to(receiver, app):
        app.test_client().get("/items")

    assert len(violations) == 1
    assert "cannot check the error contract" in violations[0]
