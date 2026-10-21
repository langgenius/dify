"""Regression tests for deterministic Flask-RESTX document finalization."""

from copy import deepcopy
from typing import override

from flask import Blueprint, Flask
from flask_restx import Resource
from flask_restx.swagger import Swagger

from libs.external_api import ExternalApi
from libs.flask_restx_compat import finalize_openapi_payload


def test_finalize_openapi_payload_does_not_mutate_its_source() -> None:
    payload: dict[str, object] = {
        "paths": {
            "/legacy": {
                "get": {
                    "operationId": "read_item",
                    "responses": {"200": {}},
                    "x-dify-binary-response-media-types": ["application/octet-stream"],
                }
            }
        }
    }
    source = deepcopy(payload)

    finalized = finalize_openapi_payload(payload)

    assert payload == source
    operation = finalized["paths"]["/legacy"]["get"]  # type: ignore[index]
    assert "x-dify-binary-response-media-types" not in operation


def test_document_finisher_output_receives_final_normalization() -> None:
    class FinishingApi(ExternalApi):
        @override
        def finish_document(self, document: dict[str, object]) -> dict[str, object]:
            document = super().finish_document(document)
            components = document.setdefault("components", {})
            assert isinstance(components, dict)
            schemas = components.setdefault("schemas", {})
            assert isinstance(schemas, dict)
            schemas["AddedByFinisher"] = {"enum": ["z", "a"], "type": "string"}
            return document

    app = Flask(__name__)
    blueprint = Blueprint("finishing", __name__)
    api = FinishingApi(blueprint)

    @api.route("/items")
    class Items(Resource):
        def get(self) -> dict[str, object]:
            return {"ok": True}

    app.register_blueprint(blueprint)
    with app.test_request_context("/"):
        document = Swagger(api).as_dict()

    assert document["components"]["schemas"]["AddedByFinisher"]["enum"] == ["a", "z"]
