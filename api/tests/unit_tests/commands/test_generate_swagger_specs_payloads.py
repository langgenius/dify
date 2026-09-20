"""generate swagger specs payloads tests."""

import json
from pathlib import Path

from tests.unit_tests.commands._swagger_spec_helpers import _load_generate_swagger_specs_module


def test_finalize_openapi_payload_preserves_canonical_operation_id():
    module = _load_generate_swagger_specs_module()
    payload = {
        "paths": {
            "/items/create-by-file": {
                "post": {"operationId": "create_item", "responses": {"200": {}}},
            },
            "/items/create_by_file": {
                "post": {"deprecated": True, "operationId": "create_item", "responses": {"200": {}}},
            },
        }
    }

    result = module.finalize_openapi_payload(payload)

    assert result["paths"]["/items/create-by-file"]["post"]["operationId"] == "create_item"
    legacy_operation_id = result["paths"]["/items/create_by_file"]["post"]["operationId"]
    assert legacy_operation_id.startswith("create_item_")


def test_finalize_openapi_payload_only_marks_explicit_binary_responses():
    module = _load_generate_swagger_specs_module()
    payload = {
        "paths": {
            "/transport": {
                "get": {
                    "operationId": "get_transport",
                    "responses": {
                        "200": {
                            "content": {
                                "application/octet-stream": {},
                                "application/json; charset=utf-8": {},
                                "application/problem+json": {},
                                "text/event-stream; charset=utf-8": {
                                    "schema": {"$ref": "#/components/schemas/BlockingResponse"}
                                },
                                "text/plain": {},
                            }
                        }
                    },
                    "x-dify-binary-response-media-types": ["application/octet-stream"],
                }
            }
        }
    }

    result = module.finalize_openapi_payload(payload)
    operation = result["paths"]["/transport"]["get"]
    content = operation["responses"]["200"]["content"]

    assert content["application/octet-stream"]["schema"] == {"format": "binary", "type": "string"}
    assert content["text/event-stream; charset=utf-8"]["schema"] == {"type": "string"}
    assert content["application/json; charset=utf-8"] == {}
    assert content["application/problem+json"] == {}
    assert content["text/plain"] == {}
    assert "x-dify-binary-response-media-types" not in operation


def test_standalone_inline_model_name_includes_list_constraints():
    module = _load_generate_swagger_specs_module()

    from flask_restx import fields

    cases = (
        ({"min_items": 1}, {"min_items": 2}),
        ({"max_items": 1}, {"max_items": 2}),
        ({"unique": True}, {"unique": False}),
    )
    for first_kwargs, second_kwargs in cases:
        first_inline_model = {"items": fields.List(fields.String, **first_kwargs)}
        second_inline_model = {"items": fields.List(fields.String, **second_kwargs)}

        assert module._inline_model_name(first_inline_model) != module._inline_model_name(second_inline_model)


def test_generate_specs_writes_web_file_upload_error_codes(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)
    web_path = next(path for path in written_paths if path.name == "web-openapi.json")
    payload = json.loads(web_path.read_text(encoding="utf-8"))

    upload_bad_request = payload["paths"]["/files/upload"]["post"]["responses"]["400"]["description"]
    assert "`file_extension_blocked`" in upload_bad_request
