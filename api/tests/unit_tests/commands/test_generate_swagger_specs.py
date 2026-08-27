"""Unit tests for the standalone OpenAPI export helper."""

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

from jsonschema import Draft202012Validator


def _walk_values(value):
    yield value
    match value:
        case dict():
            for child in value.values():
                yield from _walk_values(child)
        case list():
            for child in value:
                yield from _walk_values(child)


def _load_generate_swagger_specs_module():
    api_dir = Path(__file__).resolve().parents[3]
    script_path = api_dir / "dev" / "generate_swagger_specs.py"

    spec = importlib.util.spec_from_file_location("generate_swagger_specs", script_path)
    assert spec
    assert spec.loader

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)  # type: ignore[attr-defined]
    return module


def _operation_ids(payload):
    methods = {"delete", "get", "head", "options", "patch", "post", "put", "trace"}
    for path_item in payload["paths"].values():
        for method, operation in path_item.items():
            if method in methods and isinstance(operation, dict) and "operationId" in operation:
                yield operation["operationId"]


def _get_operations(payload):
    for path_item in payload["paths"].values():
        operation = path_item.get("get")
        if isinstance(operation, dict):
            yield operation


def _response_schema(operation, status="200"):
    return operation["responses"][status]["content"]["application/json"]["schema"]


def _request_schema(operation, content_type="application/json"):
    return operation["requestBody"]["content"][content_type]["schema"]


def _nullable_schema_ref(schema):
    if "$ref" in schema:
        return schema["$ref"]
    return next(item["$ref"] for item in schema["anyOf"] if "$ref" in item)


def _reset_schema_cache(api):
    api._schema = None
    api.__dict__.pop("__schema__", None)


def test_generate_specs_writes_console_web_and_service_openapi_files(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)

    assert [path.name for path in written_paths] == [
        "console-openapi.json",
        "web-openapi.json",
        "service-openapi.json",
        "openapi-openapi.json",
    ]

    for path in written_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload["openapi"] == "3.1.0"
        assert "paths" in payload


def test_generate_specs_match_live_openapi_payloads(tmp_path: Path):
    module = _load_generate_swagger_specs_module()
    app = module.create_spec_app()
    client = app.test_client()
    target_apis = module._target_apis()
    for api in target_apis.values():
        _reset_schema_cache(api)
    live_payloads = {target.filename: client.get(target.route).get_json() for target in module.SPEC_TARGETS}

    # Poison the endpoint cache after reading the live contract. The exporter
    # must independently serialize each API instead of succeeding by reading
    # the same cached payload through the HTTP spec route.
    poison_payload = {"poison": "stale schema cache"}
    for api in target_apis.values():
        api._schema = poison_payload
        api.__dict__["__schema__"] = poison_payload
    try:
        for target in module.SPEC_TARGETS:
            response = client.get(target.route)
            assert response.status_code == 200
            assert response.get_json() == poison_payload
        written_paths = module.generate_specs(tmp_path)
    finally:
        for api in target_apis.values():
            _reset_schema_cache(api)

    assert {path.name for path in written_paths} == set(live_payloads)
    for path in written_paths:
        assert json.loads(path.read_text(encoding="utf-8")) == live_payloads[path.name]


def test_generate_specs_after_controllers_were_imported_with_swagger_disabled(tmp_path: Path):
    api_dir = Path(__file__).resolve().parents[3]
    script = """
import sys
from pathlib import Path

from controllers.console import api as console_api
from controllers.openapi import api as openapi_api
from controllers.service_api import api as service_api
from controllers.web import api as web_api

apis = (console_api, web_api, service_api, openapi_api)
assert all(api._add_specs is False for api in apis)

from dev.generate_swagger_specs import generate_specs

written_paths = generate_specs(Path(sys.argv[1]))
assert [path.name for path in written_paths] == [
    "console-openapi.json",
    "web-openapi.json",
    "service-openapi.json",
    "openapi-openapi.json",
]
"""
    env = os.environ.copy()
    env["PYTHONPATH"] = str(api_dir)
    env["SWAGGER_UI_ENABLED"] = "false"

    result = subprocess.run(
        [sys.executable, "-c", script, str(tmp_path)],
        cwd=api_dir,
        env=env,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_apply_runtime_defaults_forces_swagger_routes_on(monkeypatch):
    module = _load_generate_swagger_specs_module()
    from configs import dify_config

    monkeypatch.setenv("SWAGGER_UI_ENABLED", "false")
    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", False)

    module.apply_runtime_defaults()

    assert dify_config.SWAGGER_UI_ENABLED is True


def test_generate_specs_writes_openapi_with_resolvable_references_and_null_defaults(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)

    for path in written_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        schemas = payload["components"]["schemas"]
        refs = {
            item["$ref"].removeprefix("#/components/schemas/")
            for item in _walk_values(payload)
            if isinstance(item, dict)
            and isinstance(item.get("$ref"), str)
            and item["$ref"].startswith("#/components/schemas/")
        }

        assert refs <= set(schemas)
        assert all("nullable" not in value for value in _walk_values(payload) if isinstance(value, dict))

    service_payload = json.loads((tmp_path / "service-openapi.json").read_text(encoding="utf-8"))
    conversation_id = service_payload["components"]["schemas"]["ChatRequestPayload"]["properties"]["conversation_id"]
    assert "default" in conversation_id
    assert conversation_id["default"] is None


def test_generate_specs_writes_unique_operation_ids(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)

    for path in written_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        operation_ids = list(_operation_ids(payload))

        assert len(operation_ids) == len(set(operation_ids))


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


def test_system_features_specs_exclude_backend_only_fields(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)
    excluded_fields = {
        "enable_trial_app",
        "is_allow_create_workspace",
        "max_plugin_package_size",
        "plugin_manager",
    }

    for spec_name in ("console-openapi.json", "web-openapi.json"):
        spec_path = next(path for path in written_paths if path.name == spec_name)
        payload = json.loads(spec_path.read_text(encoding="utf-8"))
        schemas = payload["components"]["schemas"]
        system_features_schema = schemas["SystemFeatureModel"]

        assert excluded_fields.isdisjoint(system_features_schema["properties"])
        assert "PluginManagerModel" not in schemas


def test_generate_specs_writes_get_operations_without_request_bodies(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)

    for path in written_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))

        assert all("requestBody" not in operation for operation in _get_operations(payload))


def test_generate_specs_writes_service_api_reference_descriptions(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)
    service_path = next(path for path in written_paths if path.name == "service-openapi.json")
    payload = json.loads(service_path.read_text(encoding="utf-8"))

    chat_operation = payload["paths"]["/chat-messages"]["post"]
    assert chat_operation["summary"] == "Send Chat Message"
    assert chat_operation["description"] == "Send a request to the chat application."
    assert chat_operation["tags"] == ["Chatflows", "Chats"]
    serialized_payload = json.dumps(payload)
    assert "](/api-reference/files/upload-file)" in serialized_payload
    assert "](/en/api-reference/" not in serialized_payload

    rename_operation = payload["paths"]["/conversations/{conversation_id}/name"]["post"]
    assert rename_operation["summary"] == "Rename Conversation"

    datasource_node_operation = payload["paths"]["/datasets/{dataset_id}/pipeline/datasource/nodes/{node_id}/run"][
        "post"
    ]
    assert datasource_node_operation["operationId"] == "run_datasource_node"

    pipeline_operation = payload["paths"]["/datasets/{dataset_id}/pipeline/run"]["post"]
    assert pipeline_operation["operationId"] == "run_pipeline"

    chat_error_content = chat_operation["responses"]["401"]["content"]
    assert chat_error_content == {"application/json": {}}
    chat_success_content = chat_operation["responses"]["200"]["content"]
    assert chat_success_content["application/json"]["schema"] == {"$ref": "#/components/schemas/ChatBlockingResponse"}
    assert chat_success_content["text/event-stream"]["schema"] == {"type": "string"}

    schemas = payload["components"]["schemas"]
    expected_property_descriptions = {
        ("AgentThought", "tool_labels"): "Labels for tools used.",
        ("CompletionBlockingResponse", "metadata"): "Metadata including usage and retriever resources.",
        ("DatasetCreatePayload", "retrieval_model"): (
            "Retrieval model configuration. Controls how chunks are searched and ranked when querying this "
            "knowledge base."
        ),
        ("DatasetDetailResponse", "external_knowledge_info"): (
            "Connection details for external knowledge bases. Populated when `provider` is `external`; otherwise "
            "its properties are `null`."
        ),
        ("DatasetDetailResponse", "icon_info"): "Icon display configuration for the knowledge base.",
        ("DatasetDetailResponse", "retrieval_model_dict"): "Retrieval configuration for the knowledge base.",
        ("DatasetDetailResponse", "summary_index_setting"): "Summary index configuration.",
        ("DatasetRetrievalModelResponse", "reranking_model"): "Reranking model configuration.",
        ("DatasetWeightedScoreResponse", "keyword_setting"): "Keyword search weight settings.",
        ("DatasetWeightedScoreResponse", "vector_setting"): "Semantic search weight settings.",
        ("HitTestingRecord", "segment"): "Matched chunk from the knowledge base.",
        ("HitTestingResponse", "query"): "The original query object.",
        ("HitTestingSegment", "document"): "Parent document information for the matched chunk.",
        ("Parameters", "system_parameters"): "System-level parameter limits.",
        ("ParagraphInputConfig", "default"): (
            "Raw default-value configuration for the paragraph input. Runtime-resolved values are exposed in the "
            "surrounding `resolved_default_values` mapping."
        ),
        ("ProviderModelWithStatusEntity", "fetch_from"): (
            "Where the model definition comes from. `predefined-model` for built-in models, "
            "`customizable-model` for user-configured models."
        ),
        ("ProviderWithModelsResponse", "status"): (
            "Provider status. `active` when credentials are configured and valid."
        ),
        ("SelectInputConfig", "option_source"): (
            "Source of options for `select` inputs. Present only when `type` is `select`."
        ),
        ("StringListSource", "selector"): "Variable reference path when `type` is `variable`.",
    }
    for (schema_name, property_name), description in expected_property_descriptions.items():
        assert schemas[schema_name]["properties"][property_name]["description"] == description

    assert schemas["PipelineRunJsonResponse"]["description"] == (
        "JSON result for published runs and draft runs using `response_mode: blocking`."
    )
    for schema_name in ("DatasetDetailResponse", "DatasetDetailWithPartialMembersResponse"):
        assert schemas[schema_name]["properties"]["external_knowledge_info"]["description"] == (
            "Connection details for external knowledge bases. Populated when `provider` is `external`; otherwise "
            "its properties are `null`."
        )

    chat_blocking_schema = schemas["ChatBlockingResponse"]
    assert chat_blocking_schema["discriminator"] == {
        "mapping": {
            "message": "#/components/schemas/ChatMessageBlockingResponse",
            "workflow_paused": "#/components/schemas/ChatPausedBlockingResponse",
        },
        "propertyName": "event",
    }
    assert schemas["ChatPausedBlockingDataResponse"]["properties"]["reasons"]["items"] == {
        "$ref": "#/components/schemas/ChatPauseReasonResponse"
    }
    chat_pause_reason = schemas["ChatPauseReasonResponse"]
    assert chat_pause_reason["required"] == ["TYPE"]
    assert {"form_token", "expiration_time", "inputs", "actions", "TYPE"} <= set(chat_pause_reason["properties"])

    feedback_properties = schemas["AppFeedbackResponse"]["properties"]
    assert feedback_properties["created_at"]["type"] == "string"
    assert "format" not in feedback_properties["created_at"]
    assert feedback_properties["updated_at"]["type"] == "string"
    assert "format" not in feedback_properties["updated_at"]

    completion_success_content = payload["paths"]["/completion-messages"]["post"]["responses"]["200"]["content"]
    assert completion_success_content["application/json"]["schema"] == {
        "$ref": "#/components/schemas/CompletionBlockingResponse"
    }
    assert completion_success_content["text/event-stream"]["schema"] == {"type": "string"}

    workflow_success_content = payload["paths"]["/workflows/run"]["post"]["responses"]["200"]["content"]
    assert workflow_success_content["application/json"]["schema"] == {
        "$ref": "#/components/schemas/WorkflowBlockingResponse"
    }
    assert workflow_success_content["text/event-stream"]["schema"] == {"type": "string"}
    workflow_blocking_refs = {branch["$ref"] for branch in schemas["WorkflowBlockingResponse"]["anyOf"]}
    assert workflow_blocking_refs == {
        "#/components/schemas/WorkflowFinishedBlockingResponse",
        "#/components/schemas/WorkflowPausedBlockingResponse",
    }
    workflow_paused_properties = schemas["WorkflowPausedBlockingDataResponse"]["properties"]
    assert {"paused_nodes", "reasons"} <= set(workflow_paused_properties)
    assert workflow_paused_properties["reasons"]["items"] == {
        "$ref": "#/components/schemas/WorkflowPauseReasonResponse"
    }
    workflow_pause_reason = schemas["WorkflowPauseReasonResponse"]
    assert workflow_pause_reason["required"] == ["TYPE"]
    assert {"form_token", "expiration_time", "inputs", "actions", "TYPE"} <= set(workflow_pause_reason["properties"])

    pipeline_success_content = pipeline_operation["responses"]["200"]["content"]
    assert pipeline_success_content["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PipelineRunJsonResponse"
    }
    assert pipeline_success_content["text/event-stream"]["schema"] == {"type": "string"}
    pipeline_json_refs = {branch["$ref"] for branch in schemas["PipelineRunJsonResponse"]["anyOf"]}
    assert pipeline_json_refs == {
        "#/components/schemas/PublishedPipelineRunResponse",
        "#/components/schemas/WorkflowBlockingResponse",
    }
    assert schemas["PublishedPipelineRunResponse"]["required"] == ["batch", "dataset", "documents"]

    preview_content = payload["paths"]["/files/{file_id}/preview"]["get"]["responses"]["200"]["content"]
    assert preview_content == {"*/*": {"schema": {"format": "binary", "type": "string"}}}

    scoped_stop_schema = schemas["ScopedTaskStopPayload"]
    workflow_stop_schema = schemas["WorkflowTaskStopPayload"]
    assert scoped_stop_schema["required"] == ["user"]
    assert workflow_stop_schema["required"] == ["user"]
    assert "Send the same" in scoped_stop_schema["properties"]["user"]["description"]
    assert "does not need to match" in workflow_stop_schema["properties"]["user"]["description"]
    for path in ("/chat-messages/{task_id}/stop", "/completion-messages/{task_id}/stop"):
        assert _request_schema(payload["paths"][path]["post"])["$ref"] == ("#/components/schemas/ScopedTaskStopPayload")
        assert "404" not in payload["paths"][path]["post"]["responses"]
    assert _request_schema(payload["paths"]["/workflows/tasks/{task_id}/stop"]["post"])["$ref"] == (
        "#/components/schemas/WorkflowTaskStopPayload"
    )
    assert "404" not in payload["paths"]["/workflows/tasks/{task_id}/stop"]["post"]["responses"]

    vector_space_operations = {
        (method, path)
        for path, path_item in payload["paths"].items()
        for method, operation in path_item.items()
        if isinstance(operation, dict) and "503" in operation.get("responses", {})
    }
    assert vector_space_operations == {
        ("post", "/datasets/{dataset_id}/document/create-by-file"),
        ("post", "/datasets/{dataset_id}/document/create-by-text"),
        ("post", "/datasets/{dataset_id}/document/create_by_file"),
        ("post", "/datasets/{dataset_id}/document/create_by_text"),
        ("patch", "/datasets/{dataset_id}/documents/{document_id}"),
        ("post", "/datasets/{dataset_id}/documents/{document_id}/segments"),
        ("post", "/datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}"),
        ("post", "/datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks"),
        (
            "patch",
            "/datasets/{dataset_id}/documents/{document_id}/segments/{segment_id}/child_chunks/{child_chunk_id}",
        ),
        ("post", "/datasets/{dataset_id}/documents/{document_id}/update-by-file"),
        ("post", "/datasets/{dataset_id}/documents/{document_id}/update-by-text"),
        ("post", "/datasets/{dataset_id}/documents/{document_id}/update_by_file"),
        ("post", "/datasets/{dataset_id}/documents/{document_id}/update_by_text"),
    }
    vector_space_unavailable_description = (
        "`service_unavailable` : Vector space usage could not be verified. Returned on the Dify Cloud Sandbox "
        "plan only; retry the request later."
    )
    for method, path in vector_space_operations:
        assert payload["paths"][path][method]["responses"]["503"]["description"] == (
            vector_space_unavailable_description
        )

    for path in (
        "/datasets/{dataset_id}/document/create-by-file",
        "/datasets/{dataset_id}/document/create-by-text",
        "/datasets/{dataset_id}/document/create_by_text",
        "/datasets/{dataset_id}/metadata/built-in",
        "/datasets/{dataset_id}/tags",
    ):
        operation = next(
            operation
            for operation in payload["paths"][path].values()
            if isinstance(operation, dict) and "responses" in operation
        )
        assert operation["responses"]["404"]["description"] == "`not_found` : Knowledge base not found."

    assert "503" not in payload["paths"]["/datasets/{dataset_id}"]["patch"]["responses"]

    text_to_audio_content = payload["paths"]["/text-to-audio"]["post"]["responses"]["200"]["content"]
    assert text_to_audio_content == {
        media_type: {"schema": {"format": "binary", "type": "string"}}
        for media_type in (
            "audio/aac",
            "audio/flac",
            "audio/mp4",
            "audio/mpeg",
            "audio/ogg",
            "audio/wav",
            "audio/webm",
        )
    }

    tag_binding_schema = payload["components"]["schemas"]["TagBindingPayload"]
    assert tag_binding_schema["properties"]["tag_ids"]["minItems"] == 1

    file_item_schema = payload["components"]["schemas"]["CompletionRequestPayloadWithUser"]["properties"]["files"][
        "anyOf"
    ][0]["items"]
    file_validator = Draft202012Validator(file_item_schema)
    valid_file_values = [
        {"type": "image", "transfer_method": "remote_url", "url": "https://example.com/image.png"},
        {"type": "image", "transfer_method": "remote_url", "remote_url": "https://example.com/image.png"},
        {
            "type": "image",
            "transfer_method": "remote_url",
            "upload_file_id": "00000000-0000-0000-0000-000000000001",
        },
        {
            "type": "image",
            "transfer_method": "local_file",
            "upload_file_id": "00000000-0000-0000-0000-000000000001",
            "url": "https://example.com/signed-preview",
        },
    ]
    for value in valid_file_values:
        assert not list(file_validator.iter_errors(value)), value

    invalid_file_values = [
        {"type": "image", "transfer_method": "remote_url"},
        {"type": "image", "transfer_method": "local_file", "url": "https://example.com/image.png"},
    ]
    for value in invalid_file_values:
        assert list(file_validator.iter_errors(value)), value

    user_input_form_schema = payload["components"]["schemas"]["Parameters"]["properties"]["user_input_form"]
    validator = Draft202012Validator(user_input_form_schema)
    form_values = {
        "text-input": "hello",
        "select": "alpha",
        "paragraph": "long text",
        "number": 3.5,
        "external_data_tool": None,
        "file": {"upload_file_id": "file-id"},
        "file-list": [{"upload_file_id": "file-id"}],
        "checkbox": True,
        "json_object": {"key": "value"},
    }
    for form_type, default in form_values.items():
        value = [{form_type: {"label": "Input", "variable": "input", "required": False, "default": default}}]
        assert not list(validator.iter_errors(value)), form_type

    invalid_values = [
        [{"unknown": {"label": "Input", "variable": "input"}}],
        [
            {
                "text-input": {"label": "Text", "variable": "text"},
                "number": {"label": "Number", "variable": "number"},
            }
        ],
    ]
    for value in invalid_values:
        assert list(validator.iter_errors(value)), value

    file_upload_schema = payload["components"]["schemas"]["Parameters"]["properties"]["file_upload"]
    file_upload_properties = file_upload_schema["properties"]
    assert {
        "enabled",
        "number_limits",
        "allowed_file_types",
        "allowed_file_extensions",
        "allowed_file_upload_methods",
        "image",
    } <= set(file_upload_properties)
    assert set(file_upload_properties["allowed_file_types"]["items"]["enum"]) == {
        "document",
        "image",
        "audio",
        "video",
        "custom",
    }
    assert set(file_upload_properties["allowed_file_upload_methods"]["items"]["enum"]) == {
        "remote_url",
        "local_file",
    }


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


def test_generate_specs_is_idempotent(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    first_paths = module.generate_specs(tmp_path / "first")
    second_paths = module.generate_specs(tmp_path / "second")

    assert [path.name for path in first_paths] == [path.name for path in second_paths]
    for first_path, second_path in zip(first_paths, second_paths):
        assert first_path.read_text(encoding="utf-8") == second_path.read_text(encoding="utf-8")


def test_generate_specs_include_agent_v2_knowledge_set_schema_and_query_enums(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)
    console_path = next(path for path in written_paths if path.name == "console-openapi.json")
    payload = json.loads(console_path.read_text(encoding="utf-8"))
    schemas = payload["components"]["schemas"]

    assert "AgentKnowledgeSetConfig" in schemas
    assert schemas["AgentSoulKnowledgeConfig"]["properties"]["sets"]["items"]["$ref"] == (
        "#/components/schemas/AgentKnowledgeSetConfig"
    )
    assert schemas["AgentKnowledgeQueryMode"]["enum"] == ["generated_query", "user_query"]


def test_generate_specs_include_console_contract_shapes_for_schema_migration(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)
    console_path = next(path for path in written_paths if path.name == "console-openapi.json")
    payload = json.loads(console_path.read_text(encoding="utf-8"))
    schemas = payload["components"]["schemas"]
    paths = payload["paths"]

    file_upload_schema = _request_schema(paths["/files/upload"]["post"], "multipart/form-data")
    assert file_upload_schema["required"] == ["file"]
    assert file_upload_schema["properties"]["file"]["format"] == "binary"
    assert file_upload_schema["properties"]["file"]["type"] == "string"
    assert file_upload_schema["properties"]["source"]["enum"] == ["datasets"]

    api_key_auth_binding_schema = _request_schema(paths["/api-key-auth/data-source/binding"]["post"])
    assert api_key_auth_binding_schema["$ref"] == "#/components/schemas/ApiKeyAuthBindingPayload"
    assert schemas["ApiKeyAuthBindingPayload"]["properties"]["credentials"]["$ref"] == (
        "#/components/schemas/ApiKeyAuthCredentialsPayload"
    )
    assert schemas["ApiKeyAuthCredentialsPayload"]["properties"]["config"]["$ref"] == (
        "#/components/schemas/ApiKeyAuthConfigPayload"
    )
    assert schemas["ApiKeyAuthConfigPayload"]["properties"]["api_key"]["minLength"] == 1

    invoices_schema_ref = _response_schema(paths["/billing/invoices"]["get"])["$ref"].removeprefix(
        "#/components/schemas/"
    )
    assert schemas[invoices_schema_ref]["properties"]["url"]["type"] == "string"

    app_detail_schema = schemas["RecommendedAppDetailResponse"]
    assert app_detail_schema["properties"]["id"]["type"] == "string"
    assert app_detail_schema["properties"]["export_data"]["type"] == "string"
    assert app_detail_schema["properties"]["can_trial"]["type"] == "boolean"
    assert "anyOf" not in app_detail_schema["properties"]["can_trial"]
    assert "can_trial" in app_detail_schema["required"]
    app_list_item_schema = schemas["RecommendedAppResponse"]
    assert app_list_item_schema["properties"]["can_trial"]["type"] == "boolean"
    assert "anyOf" not in app_list_item_schema["properties"]["can_trial"]
    assert "can_trial" in app_list_item_schema["required"]
    assert _response_schema(paths["/explore/apps/{app_id}"]["get"])["$ref"] == (
        "#/components/schemas/RecommendedAppDetailResponse"
    )
    assert "404" in paths["/explore/apps/{app_id}"]["get"]["responses"]
    assert "RecommendedAppDetailNullableResponse" not in schemas
    assert schemas["RecommendedAppInfoResponse"]["properties"]["icon_url"]["readOnly"] is True
    assert schemas["InstalledAppInfoResponse"]["properties"]["icon_url"]["readOnly"] is True
    assert _response_schema(paths["/apps/{app_id}"]["get"])["$ref"] == "#/components/schemas/AppDetailWithSite"
    app_model_config = schemas["AppDetailWithSite"]["properties"]["model_config"]
    assert {"$ref": "#/components/schemas/AppModelConfigResponse"} in app_model_config["anyOf"]
    app_detail = schemas["AppDetail"]
    assert "mode" in app_detail["properties"]
    assert "mode_compatible_with_agent" not in app_detail["properties"]
    sync_draft_workflow = schemas["SyncDraftWorkflowResponse"]
    assert _response_schema(paths["/apps/{app_id}/workflows/draft"]["post"])["$ref"] == (
        "#/components/schemas/SyncDraftWorkflowResponse"
    )
    assert sync_draft_workflow["properties"]["updated_at"]["type"] == "integer"
    tool_icon_schema = schemas["ExploreAppMetaResponse"]["properties"]["tool_icons"]["additionalProperties"]
    assert {"type": "string"} in tool_icon_schema["anyOf"]
    assert {"additionalProperties": True, "type": "object"} in tool_icon_schema["anyOf"]
    assert "ToolIconResponse" not in schemas

    plugin_versions = schemas["PluginVersionsResponse"]["properties"]["versions"]
    assert plugin_versions["additionalProperties"]["anyOf"][0]["$ref"] == "#/components/schemas/LatestPluginCache"
    assert plugin_versions["additionalProperties"]["anyOf"][1]["type"] == "null"
    plugin_installations = schemas["PluginInstallationsResponse"]["properties"]["plugins"]
    assert plugin_installations["items"]["$ref"] == "#/components/schemas/PluginInstallationItemResponse"

    rbac_whitelist_request = _request_schema(paths["/workspaces/current/rbac/apps/{app_id}/whitelist"]["put"])
    assert rbac_whitelist_request["$ref"] == "#/components/schemas/_ResourceAccessScopeRequest"
    app_access_policy_params = paths["/workspaces/current/rbac/apps/{app_id}/access-policy"]["get"]["parameters"]
    language_param = next(param for param in app_access_policy_params if param["name"] == "language")
    assert language_param["schema"]["enum"] == ["en", "ja", "zh"]

    trigger_list_schema = _response_schema(paths["/workspaces/current/triggers"]["get"])
    assert trigger_list_schema["$ref"] == "#/components/schemas/TriggerProviderListResponse"
    trigger_builder_create_schema = _response_schema(
        paths["/workspaces/current/trigger-provider/{provider}/subscriptions/builder/create"]["post"]
    )
    assert trigger_builder_create_schema["$ref"] == "#/components/schemas/TriggerSubscriptionBuilderCreateResponse"
    assert (
        schemas["TriggerSubscriptionBuilderCreateResponse"]["properties"]["subscription_builder"]["$ref"]
        == "#/components/schemas/SubscriptionBuilderApiEntity"
    )

    conversation_variables = schemas["ConversationVariableUpdatePayload"]["properties"]["conversation_variables"]
    assert conversation_variables["items"]["$ref"] == "#/components/schemas/ConversationVariableItemPayload"
    workflow_features = schemas["WorkflowFeaturesPayload"]["properties"]["features"]
    assert workflow_features["$ref"] == "#/components/schemas/WorkflowFeaturesConfigPayload"
    workflow_feature_properties = schemas["WorkflowFeaturesConfigPayload"]["properties"]
    assert _nullable_schema_ref(workflow_feature_properties["suggested_questions_after_answer"]) == (
        "#/components/schemas/WorkflowSuggestedQuestionsAfterAnswerPayload"
    )
    assert _nullable_schema_ref(workflow_feature_properties["text_to_speech"]) == (
        "#/components/schemas/WorkflowTextToSpeechPayload"
    )
    assert _nullable_schema_ref(workflow_feature_properties["sensitive_word_avoidance"]) == (
        "#/components/schemas/WorkflowSensitiveWordAvoidancePayload"
    )
    assert {"enabled", "model", "prompt"} <= set(schemas["WorkflowSuggestedQuestionsAfterAnswerPayload"]["properties"])
    assert {"enabled", "language", "voice", "autoPlay"} <= set(schemas["WorkflowTextToSpeechPayload"]["properties"])
    assert {"enabled", "type", "config"} <= set(schemas["WorkflowSensitiveWordAvoidancePayload"]["properties"])
    file_upload = schemas["WorkflowFileUploadPayload"]["properties"]
    assert {"document", "audio", "video", "custom", "preview_config"} <= set(file_upload)
    assert "detail" in schemas["WorkflowFileUploadImagePayload"]["properties"]
    assert {"mode", "file_type_list"} <= set(schemas["WorkflowFileUploadPreviewConfigPayload"]["properties"])
    assert schemas["AccountWithRoleResponse"]["properties"]["avatar_url"]["readOnly"] is True


def test_checked_in_agent_v2_knowledge_openapi_and_generated_contracts_are_in_sync():
    api_dir = Path(__file__).resolve().parents[3]
    repo_root = api_dir.parent

    markdown = (api_dir / "openapi" / "markdown" / "console-openapi.md").read_text(encoding="utf-8")
    agent_types = (
        repo_root / "packages" / "contracts" / "generated" / "api" / "console" / "agent" / "types.gen.ts"
    ).read_text(encoding="utf-8")
    apps_types = (
        repo_root / "packages" / "contracts" / "generated" / "api" / "console" / "apps" / "types.gen.ts"
    ).read_text(encoding="utf-8")
    agent_zod = (
        repo_root / "packages" / "contracts" / "generated" / "api" / "console" / "agent" / "zod.gen.ts"
    ).read_text(encoding="utf-8")
    apps_zod = (
        repo_root / "packages" / "contracts" / "generated" / "api" / "console" / "apps" / "zod.gen.ts"
    ).read_text(encoding="utf-8")

    assert "#### AgentKnowledgeSetConfig" in markdown
    assert "#### AgentSoulKnowledgeConfig" in markdown
    assert "#### AgentKnowledgeQueryMode" in markdown

    for content in (agent_types, apps_types):
        assert "export type AgentKnowledgeSetConfig = {" in content
        assert "export type AgentSoulKnowledgeConfig = {" in content
        assert "AgentKnowledgeQueryMode" in content
        assert "generated_query" in content
        assert "user_query" in content

    for content in (agent_zod, apps_zod):
        assert "export const zAgentKnowledgeSetConfig = z.object({" in content
        assert "export const zAgentSoulKnowledgeConfig = z.object({" in content
        assert "zAgentKnowledgeQueryMode = z.enum([" in content
        assert "generated_query" in content
        assert "user_query" in content
