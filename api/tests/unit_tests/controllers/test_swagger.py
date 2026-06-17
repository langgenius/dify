"""OpenAPI JSON rendering tests for Flask-RESTX API blueprints."""

import json
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


def _json_body_schema(payload: dict[str, object], operation: dict[str, object]) -> dict[str, object]:
    request_body = operation.get("requestBody")
    assert isinstance(request_body, dict)
    content = request_body.get("content")
    assert isinstance(content, dict)
    json_media = content.get("application/json")
    assert isinstance(json_media, dict)
    schema = json_media.get("schema")
    assert isinstance(schema, dict)

    ref = schema.get("$ref")
    if isinstance(ref, str):
        schema_name = ref.removeprefix("#/components/schemas/")
        resolved = payload["components"]["schemas"][schema_name]
        assert isinstance(resolved, dict)
        return resolved

    return schema


def _response_content_types(operation: dict[str, object], status_code: str = "200") -> set[str]:
    responses = operation.get("responses")
    assert isinstance(responses, dict)
    response = responses.get(status_code)
    assert isinstance(response, dict)
    content = response.get("content")
    assert isinstance(content, dict)
    return set(content)


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


def test_uuid_path_format_is_derived_from_route_converter():
    from flask_restx import swagger as restx_swagger

    from libs.flask_restx_compat import install_swagger_compatibility

    app = Flask(__name__)
    with app.app_context():
        install_swagger_compatibility()
        params = restx_swagger.extract_path_params("/resources/<uuid:custom_resource_uuid>")

    assert params["custom_resource_uuid"] == {
        "format": "uuid",
        "in": "path",
        "name": "custom_resource_uuid",
        "required": True,
        "type": "string",
    }


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
    assert create_properties["data"] == {
        "description": "Optional JSON string with document creation settings.",
        "type": "string",
    }
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
        assert update_properties["data"] == {
            "description": "Optional JSON string with document update settings.",
            "type": "string",
        }
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


def test_service_openapi_documents_decorator_user_contracts(monkeypatch: pytest.MonkeyPatch):
    from configs import dify_config
    from controllers.service_api import bp as service_api_bp

    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", True)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    app.register_blueprint(service_api_bp)

    payload = app.test_client().get("/v1/openapi.json").get_json()
    paths = payload["paths"]

    required_json_user_operations = (
        ("/completion-messages", "post"),
        ("/completion-messages/{task_id}/stop", "post"),
        ("/chat-messages", "post"),
        ("/chat-messages/{task_id}/stop", "post"),
        ("/messages/{message_id}/feedbacks", "post"),
        ("/form/human_input/{form_token}", "post"),
        ("/workflows/run", "post"),
        ("/workflows/{workflow_id}/run", "post"),
        ("/workflows/tasks/{task_id}/stop", "post"),
    )
    for path, method in required_json_user_operations:
        schema = _json_body_schema(payload, paths[path][method])
        assert schema["properties"]["user"] == {"description": "End user identifier", "type": "string"}
        assert "user" in schema["required"]

    optional_json_user_operations = (
        ("/text-to-audio", "post"),
        ("/conversations/{c_id}", "delete"),
        ("/conversations/{c_id}/name", "post"),
        ("/conversations/{c_id}/variables/{variable_id}", "put"),
    )
    for path, method in optional_json_user_operations:
        schema = _json_body_schema(payload, paths[path][method])
        assert schema["properties"]["user"] == {"description": "End user identifier", "type": "string"}
        assert "user" not in schema.get("required", [])

    messages_params = _parameters_by_name(paths["/messages"]["get"])
    assert messages_params["user"]["in"] == "query"
    assert messages_params["user"]["required"] is False

    events_params = _parameters_by_name(paths["/workflow/{task_id}/events"]["get"])
    assert events_params["user"]["in"] == "query"
    assert events_params["user"]["required"] is True


def test_service_openapi_documents_app_multipart_contracts(monkeypatch: pytest.MonkeyPatch):
    from configs import dify_config
    from controllers.service_api import bp as service_api_bp

    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", True)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    app.register_blueprint(service_api_bp)

    payload = app.test_client().get("/v1/openapi.json").get_json()
    paths = payload["paths"]

    for path in ("/files/upload", "/audio-to-text"):
        schema = _multipart_form_schema(paths[path]["post"])
        assert schema["properties"]["file"] == {"format": "binary", "type": "string"}
        assert schema["properties"]["user"] == {"description": "End user identifier", "type": "string"}
        assert schema["required"] == ["file"]

    pipeline_schema = _multipart_form_schema(paths["/datasets/pipeline/file-upload"]["post"])
    assert pipeline_schema["properties"]["file"] == {"format": "binary", "type": "string"}
    assert pipeline_schema["required"] == ["file"]


def test_service_openapi_documents_non_json_response_media_types(monkeypatch: pytest.MonkeyPatch):
    from configs import dify_config
    from controllers.service_api import bp as service_api_bp

    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", True)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    app.register_blueprint(service_api_bp)

    payload = app.test_client().get("/v1/openapi.json").get_json()
    paths = payload["paths"]

    assert _response_content_types(paths["/chat-messages"]["post"]) == {
        "application/json",
        "text/event-stream",
    }
    assert _response_content_types(paths["/workflow/{task_id}/events"]["get"]) == {"text/event-stream"}
    assert _response_content_types(paths["/text-to-audio"]["post"]) == {"audio/mpeg"}
    assert _response_content_types(paths["/files/{file_id}/preview"]["get"]) == {
        "application/octet-stream",
        "application/pdf",
        "audio/aac",
        "audio/flac",
        "audio/mp4",
        "audio/mpeg",
        "audio/ogg",
        "audio/wav",
        "audio/x-m4a",
        "image/gif",
        "image/jpeg",
        "image/png",
        "image/webp",
        "text/plain",
        "video/mp4",
        "video/quicktime",
        "video/webm",
    }
    assert _response_content_types(paths["/datasets/{dataset_id}/documents/download-zip"]["post"]) == {
        "application/zip"
    }


def test_service_openapi_documents_uuid_params_and_deprecated_routes(monkeypatch: pytest.MonkeyPatch):
    from configs import dify_config
    from controllers.service_api import bp as service_api_bp

    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", True)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    app.register_blueprint(service_api_bp)

    payload = app.test_client().get("/v1/openapi.json").get_json()
    paths = payload["paths"]

    dataset_params = _parameters_by_name(paths["/datasets/{dataset_id}"]["get"])
    assert dataset_params["dataset_id"]["schema"] == {
        "description": "Dataset ID",
        "format": "uuid",
        "type": "string",
    }

    conversation_params = _parameters_by_name(paths["/conversations/{c_id}"]["delete"])
    assert conversation_params["c_id"]["schema"] == {
        "description": "Conversation ID",
        "format": "uuid",
        "type": "string",
    }

    assert paths["/datasets/{dataset_id}/document/create_by_file"]["post"]["deprecated"] is True
    assert paths["/datasets/{dataset_id}/documents/{document_id}/update_by_text"]["post"]["deprecated"] is True


def test_service_openapi_documents_path_action_enums(monkeypatch: pytest.MonkeyPatch):
    from configs import dify_config
    from controllers.service_api import bp as service_api_bp

    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", True)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    app.register_blueprint(service_api_bp)

    payload = app.test_client().get("/v1/openapi.json").get_json()
    paths = payload["paths"]

    annotation_params = _parameters_by_name(paths["/apps/annotation-reply/{action}"]["post"])
    assert annotation_params["action"]["schema"]["enum"] == ["enable", "disable"]

    document_status_params = _parameters_by_name(paths["/datasets/{dataset_id}/documents/status/{action}"]["patch"])
    assert document_status_params["action"]["schema"]["enum"] == ["enable", "disable", "archive", "un_archive"]

    metadata_params = _parameters_by_name(paths["/datasets/{dataset_id}/metadata/built-in/{action}"]["post"])
    assert metadata_params["action"]["schema"]["enum"] == ["enable", "disable"]


def test_service_openapi_documents_conditional_payload_schemas(monkeypatch: pytest.MonkeyPatch):
    from configs import dify_config
    from controllers.service_api import bp as service_api_bp

    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", True)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    app.register_blueprint(service_api_bp)

    payload = app.test_client().get("/v1/openapi.json").get_json()
    paths = payload["paths"]

    rename_schema = _json_body_schema(payload, paths["/conversations/{c_id}/name"]["post"])
    auto_generate_branch, manual_name_branch = rename_schema["anyOf"]
    assert auto_generate_branch["properties"]["auto_generate"]["enum"] == [True]
    assert auto_generate_branch["required"] == ["auto_generate"]
    assert manual_name_branch["properties"]["auto_generate"]["enum"] == [False]
    assert manual_name_branch["properties"]["name"]["pattern"] == r".*\S.*"
    assert manual_name_branch["required"] == ["name"]
    for branch in rename_schema["anyOf"]:
        assert branch["properties"]["user"] == {"description": "End user identifier", "type": "string"}

    document_update_schema = payload["components"]["schemas"]["DocumentTextUpdate"]
    with_text_branch, without_text_branch = document_update_schema["anyOf"]
    assert with_text_branch["properties"]["text"]["type"] == "string"
    assert with_text_branch["properties"]["name"]["type"] == "string"
    assert with_text_branch["required"] == ["name", "text"]
    assert without_text_branch["properties"]["text"]["type"] == "null"


def test_service_openapi_does_not_encode_docs_coverage_boundaries(monkeypatch: pytest.MonkeyPatch):
    from configs import dify_config
    from controllers.service_api import bp as service_api_bp

    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", True)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    app.register_blueprint(service_api_bp)

    payload = app.test_client().get("/v1/openapi.json").get_json()
    paths = payload["paths"]

    for path_item in paths.values():
        assert isinstance(path_item, dict)
        for method in ("delete", "get", "patch", "post", "put"):
            operation = path_item.get(method)
            if not isinstance(operation, dict):
                continue
            assert "x-dify-api-reference-visibility" not in operation
            assert "x-dify-api-lifecycle" not in operation

    assert paths["/datasets/{dataset_id}/document/create_by_text"]["post"]["deprecated"] is True
    assert paths["/datasets/{dataset_id}/document/create_by_file"]["post"]["deprecated"] is True
    assert paths["/datasets/{dataset_id}/documents/{document_id}/update-by-file"]["post"]["deprecated"] is True


def test_service_openapi_documents_auth_and_compatibility_payloads(monkeypatch: pytest.MonkeyPatch):
    from configs import dify_config
    from controllers.service_api import bp as service_api_bp

    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", True)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    app.register_blueprint(service_api_bp)

    payload = app.test_client().get("/v1/openapi.json").get_json()

    assert payload["components"]["securitySchemes"]["Bearer"] == {
        "bearerFormat": "API_KEY",
        "description": "Use the Service API key as a Bearer token in the Authorization header.",
        "scheme": "bearer",
        "type": "http",
    }

    tag_unbinding_schema = payload["components"]["schemas"]["TagUnbindingPayload"]
    assert tag_unbinding_schema["description"] == (
        "Accepts either the legacy tag_id payload or the normalized tag_ids payload."
    )
    tag_id_schema, tag_ids_schema = tag_unbinding_schema["anyOf"]
    assert tag_id_schema["properties"]["tag_id"]["description"] == ("Legacy single tag ID accepted by the Service API.")
    assert tag_id_schema["required"] == ["tag_id", "target_id"]
    assert tag_ids_schema["properties"]["tag_ids"]["minItems"] == 1
    assert tag_ids_schema["required"] == ["tag_ids", "target_id"]


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


def test_console_plugin_category_list_exported_schema_uses_typed_items(tmp_path):
    from dev.generate_swagger_specs import generate_specs

    written_paths = generate_specs(tmp_path)
    console_openapi_path = next(path for path in written_paths if path.name == "console-openapi.json")
    payload = json.loads(console_openapi_path.read_text(encoding="utf-8"))
    operation = payload["paths"]["/workspaces/current/plugin/{category}/list"]["get"]
    response_ref = operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].removeprefix(
        "#/components/schemas/"
    )
    schemas = payload["components"]["schemas"]
    response_schema = schemas[response_ref]

    assert response_schema["properties"]["plugins"]["items"]["$ref"] == (
        "#/components/schemas/PluginCategoryInstalledPluginResponse"
    )
    assert response_schema["properties"]["builtin_tools"]["items"]["$ref"] == (
        "#/components/schemas/PluginCategoryBuiltinToolProviderResponse"
    )

    installed_plugin_schema = schemas["PluginCategoryInstalledPluginResponse"]
    for field in (
        "plugin_unique_identifier",
        "source",
        "version",
        "declaration",
        "endpoints_active",
        "endpoints_setups",
    ):
        assert field in installed_plugin_schema["properties"]

    builtin_tool_schema = schemas["PluginCategoryBuiltinToolProviderResponse"]
    for field in ("plugin_unique_identifier", "team_credentials", "type", "tools"):
        assert field in builtin_tool_schema["properties"]
