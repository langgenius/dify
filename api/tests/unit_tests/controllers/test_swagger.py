"""OpenAPI JSON rendering tests for Flask-RESTX API blueprints."""

from collections.abc import Iterator

import pytest
from flask import Flask


def _schema_refs(value: object) -> set[str]:
    refs: set[str] = set()
    if isinstance(value, dict):
        ref = value.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            refs.add(ref.removeprefix("#/components/schemas/"))
        for item in value.values():
            refs.update(_schema_refs(item))
    elif isinstance(value, list):
        for item in value:
            refs.update(_schema_refs(item))
    return refs


def _parameters_by_name(operation: dict[str, object]) -> dict[str, dict[str, object]]:
    parameters = operation.get("parameters", [])
    assert isinstance(parameters, list)
    result: dict[str, dict[str, object]] = {}
    for parameter in parameters:
        if not isinstance(parameter, dict):
            continue
        name = parameter.get("name")
        if isinstance(name, str):
            result[name] = parameter
    return result


def _get_operations(payload: dict[str, object]) -> Iterator[tuple[str, dict[str, object]]]:
    paths = payload["paths"]
    assert isinstance(paths, dict)
    for path, path_item in paths.items():
        if not isinstance(path, str) or not isinstance(path_item, dict):
            continue
        operation = path_item.get("get")
        if isinstance(operation, dict):
            yield path, operation


def _multipart_form_schema(operation: dict[str, object]) -> dict[str, object]:
    request_body = operation.get("requestBody")
    assert isinstance(request_body, dict)
    content = request_body.get("content")
    assert isinstance(content, dict)
    multipart = content.get("multipart/form-data")
    assert isinstance(multipart, dict)
    schema = multipart.get("schema")
    assert isinstance(schema, dict)
    return schema


@pytest.mark.parametrize(
    ("first_kwargs", "second_kwargs"),
    [
        ({"min_items": 1}, {"min_items": 2}),
        ({"max_items": 1}, {"max_items": 2}),
        ({"unique": True}, {"unique": False}),
    ],
)
def test_inline_model_name_includes_list_constraints(
    first_kwargs: dict[str, object],
    second_kwargs: dict[str, object],
):
    from flask_restx import fields

    from libs.flask_restx_compat import _inline_model_name

    first_inline_model: dict[object, object] = {"items": fields.List(fields.String, **first_kwargs)}
    second_inline_model: dict[object, object] = {"items": fields.List(fields.String, **second_kwargs)}

    assert _inline_model_name(first_inline_model) != _inline_model_name(second_inline_model)


def test_openapi_json_endpoints_render(monkeypatch: pytest.MonkeyPatch):
    from configs import dify_config
    from controllers.console import bp as console_bp
    from controllers.service_api import bp as service_api_bp
    from controllers.web import bp as web_bp

    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", True)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    app.register_blueprint(console_bp)
    app.register_blueprint(web_bp)
    app.register_blueprint(service_api_bp)

    client = app.test_client()

    for route in ("/console/api/openapi.json", "/api/openapi.json", "/v1/openapi.json"):
        response = client.get(route)

        assert response.status_code == 200
        payload = response.get_json()
        assert payload["openapi"].startswith("3.")
        assert "paths" in payload
        assert "schemas" in payload["components"]
        assert isinstance(payload["components"]["schemas"], dict)
        missing_refs = _schema_refs(payload) - set(payload["components"]["schemas"])
        assert not missing_refs
        get_request_body_paths = [path for path, operation in _get_operations(payload) if "requestBody" in operation]
        assert not get_request_body_paths

    assert app.config["RESTX_INCLUDE_ALL_MODELS"] is True


def test_service_document_file_routes_document_multipart_form_data(monkeypatch: pytest.MonkeyPatch):
    from configs import dify_config
    from controllers.service_api import bp as service_api_bp

    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", True)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    app.register_blueprint(service_api_bp)

    payload = app.test_client().get("/v1/openapi.json").get_json()
    paths = payload["paths"]

    create_operation = paths["/datasets/{dataset_id}/document/create-by-file"]["post"]
    create_schema = _multipart_form_schema(create_operation)
    create_properties = create_schema["properties"]
    assert isinstance(create_properties, dict)
    assert create_properties["file"] == {"type": "string", "format": "binary"}
    assert create_properties["data"] == {"type": "string"}
    assert create_schema["required"] == ["file"]
    assert create_operation["requestBody"]["required"] is True

    for path in (
        "/datasets/{dataset_id}/documents/{document_id}",
        "/datasets/{dataset_id}/documents/{document_id}/update-by-file",
        "/datasets/{dataset_id}/documents/{document_id}/update_by_file",
    ):
        update_operation = paths[path]["patch" if path.endswith("{document_id}") else "post"]
        update_schema = _multipart_form_schema(update_operation)
        update_properties = update_schema["properties"]
        assert isinstance(update_properties, dict)
        assert update_properties["file"] == {"type": "string", "format": "binary"}
        assert update_properties["data"] == {"type": "string"}
        assert "required" not in update_schema
        assert update_operation["requestBody"]["required"] is False


def test_service_document_list_documents_query_params_render(monkeypatch: pytest.MonkeyPatch):
    from configs import dify_config
    from controllers.service_api import bp as service_api_bp

    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", True)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    app.register_blueprint(service_api_bp)

    payload = app.test_client().get("/v1/openapi.json").get_json()
    operation = payload["paths"]["/datasets/{dataset_id}/documents"]["get"]
    params = _parameters_by_name(operation)

    for name in ("page", "limit", "keyword", "status"):
        assert params[name]["in"] == "query"


def test_console_account_avatar_query_param_renders_as_query(monkeypatch: pytest.MonkeyPatch):
    from configs import dify_config
    from controllers.console import bp as console_bp

    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", True)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    app.register_blueprint(console_bp)

    payload = app.test_client().get("/console/api/openapi.json").get_json()
    operation = payload["paths"]["/account/avatar"]["get"]
    params = _parameters_by_name(operation)

    assert "payload" not in params
    assert params["avatar"]["in"] == "query"
    assert params["avatar"]["required"] is True
