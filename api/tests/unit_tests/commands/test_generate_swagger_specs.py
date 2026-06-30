"""Unit tests for the standalone OpenAPI export helper."""

import importlib.util
import json
import sys
from pathlib import Path


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


def test_generate_specs_writes_console_web_and_service_openapi_files(tmp_path):
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
        assert payload["openapi"].startswith("3.")
        assert "paths" in payload


def test_generate_specs_writes_openapi_with_resolvable_references_and_no_nulls(tmp_path):
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
        assert all(value is not None for value in _walk_values(payload))


def test_generate_specs_writes_unique_operation_ids(tmp_path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)

    for path in written_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        operation_ids = list(_operation_ids(payload))

        assert len(operation_ids) == len(set(operation_ids))


def test_generate_specs_writes_get_operations_without_request_bodies(tmp_path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)

    for path in written_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))

        assert all("requestBody" not in operation for operation in _get_operations(payload))


def test_generate_specs_writes_service_api_reference_descriptions(tmp_path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)
    service_path = next(path for path in written_paths if path.name == "service-openapi.json")
    payload = json.loads(service_path.read_text(encoding="utf-8"))

    chat_operation = payload["paths"]["/chat-messages"]["post"]
    assert chat_operation["summary"] == "Send Chat Message"
    assert chat_operation["description"] == "Send a request to the chat application."
    assert chat_operation["tags"] == ["Chatflows", "Chats"]

    rename_operation = payload["paths"]["/conversations/{c_id}/name"]["post"]
    assert rename_operation["summary"] == "Rename Conversation"


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


def test_generate_specs_is_idempotent(tmp_path):
    module = _load_generate_swagger_specs_module()

    first_paths = module.generate_specs(tmp_path / "first")
    second_paths = module.generate_specs(tmp_path / "second")

    assert [path.name for path in first_paths] == [path.name for path in second_paths]
    for first_path, second_path in zip(first_paths, second_paths):
        assert first_path.read_text(encoding="utf-8") == second_path.read_text(encoding="utf-8")


def test_generate_specs_include_agent_v2_knowledge_set_schema_and_query_enums(tmp_path):
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


def test_generate_specs_include_console_contract_shapes_for_schema_migration(tmp_path):
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

    invoices_schema_ref = _response_schema(paths["/billing/invoices"]["get"])["$ref"].removeprefix(
        "#/components/schemas/"
    )
    assert schemas[invoices_schema_ref]["properties"]["url"]["type"] == "string"

    app_detail_schema = schemas["RecommendedAppDetailResponse"]
    assert app_detail_schema["properties"]["id"]["type"] == "string"
    assert app_detail_schema["properties"]["export_data"]["type"] == "string"
    assert {"type": "boolean"} in app_detail_schema["properties"]["can_trial"]["anyOf"]

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
    assert schemas["AccountWithRole"]["properties"]["avatar_url"]["readOnly"] is True


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
