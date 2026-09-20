"""generate swagger specs service tests."""

import json
from pathlib import Path

from jsonschema import Draft202012Validator

from tests.unit_tests.commands._swagger_spec_helpers import _load_generate_swagger_specs_module, _request_schema


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

    upload_bad_request = payload["paths"]["/files/upload"]["post"]["responses"]["400"]["description"]
    assert "`file_extension_blocked`" in upload_bad_request

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
