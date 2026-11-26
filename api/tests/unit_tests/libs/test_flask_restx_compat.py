from copy import deepcopy

from flask import Flask
from flask_restx import Api, Resource, fields

from libs.flask_restx_compat import finalize_openapi_payload, install_swagger_compatibility


def test_generated_openapi_preserves_raw_field_literals() -> None:
    """Real field examples and defaults retain their data through document finalization."""
    literal = {"tags": ["z", "a"], "required": ["second", "first"]}
    app = Flask(__name__)
    api = Api(app)
    install_swagger_compatibility()
    model = api.model("Payload", {"value": fields.Raw(default=literal, example=literal)})

    @api.route("/payload")
    class Payload(Resource):
        @api.marshal_with(model)
        def get(self) -> dict[str, object]:
            """Return the example payload for the documented resource."""
            return {"value": literal}

    with app.test_request_context():
        schema = api.__schema__["components"]["schemas"]["Payload"]["properties"]["value"]

    assert schema["example"] == literal
    assert schema["default"] == literal


def test_finalization_preserves_schema_literals_and_normalizes_schema_keywords() -> None:
    """Named schema maps do not turn keyword-named properties into literal values."""
    literal = {"enum": ["z", "a"], "tags": ["z", "a"]}
    field_schema = {
        "type": "object",
        "required": ["z", "a"],
        "properties": {"a": {"$ref": "#/definitions/Value"}, "z": {"type": "string"}},
        "example": literal,
        "examples": [literal],
        "default": literal,
        "const": literal,
        "enum": [literal],
    }
    payload: dict[str, object] = {
        "x-payload": literal,
        "paths": {
            "/payload": {
                "get": {
                    "responses": {
                        "default": {"content": {"application/json": {"schema": {"$ref": "#/definitions/Payload"}}}}
                    }
                }
            }
        },
        "components": {
            "schemas": {
                "Payload": {
                    "properties": {name: deepcopy(field_schema) for name in ("example", "default", "properties")}
                },
                "Value": {"type": "string", "enum": ["z", "a"]},
            }
        },
    }
    result = finalize_openapi_payload(payload, registered_models={})
    expected_field_schema = {
        **field_schema,
        "required": ["a", "z"],
        "properties": {"a": {"$ref": "#/components/schemas/Value"}, "z": {"type": "string"}},
    }
    assert result == {
        "x-payload": literal,
        "paths": {
            "/payload": {
                "get": {
                    "responses": {
                        "default": {
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Payload"}}}
                        }
                    }
                }
            }
        },
        "components": {
            "schemas": {
                "Payload": {"properties": dict.fromkeys(("example", "default", "properties"), expected_field_schema)},
                "Value": {"type": "string", "enum": ["a", "z"]},
            }
        },
    }


def test_parameter_lists_and_default_response_schemas_remain_sorted() -> None:
    """Literal preservation does not skip named responses or parameter objects."""
    schema = {"type": "object", "required": ["z", "a"]}
    parameter = {"in": "query", "name": "default", "schema": schema}
    payload: dict[str, object] = {
        "paths": {
            "/payload": {
                "parameters": [parameter],
                "get": {"responses": {"default": {"content": {"application/json": {"schema": schema}}}}},
            }
        }
    }
    expected_schema = {"type": "object", "required": ["a", "z"]}
    assert finalize_openapi_payload(payload) == {
        "paths": {
            "/payload": {
                "parameters": [{**parameter, "schema": expected_schema}],
                "get": {"responses": {"default": {"content": {"application/json": {"schema": expected_schema}}}}},
            }
        }
    }
