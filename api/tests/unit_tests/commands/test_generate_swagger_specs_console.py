"""generate swagger specs console tests."""

import json
from pathlib import Path

from tests.unit_tests.commands._swagger_spec_helpers import (
    _load_generate_swagger_specs_module,
    _nullable_schema_ref,
    _request_schema,
    _response_schema,
)


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

    package_import = paths["/apps/imports"]["post"]
    assert _request_schema(package_import, "multipart/form-data")["required"] == ["file"]
    assert _request_schema(package_import, "multipart/form-data")["properties"]["app_id"]["type"] == "string"
    assert _request_schema(package_import, "application/json")["$ref"] == "#/components/schemas/AppImportPayload"
    assert "mode" in schemas["AppImportPayload"]["required"]
    conflict = package_import["responses"]["409"]["content"]["application/json"]["schema"]
    assert conflict["$ref"] == "#/components/schemas/RosterAgentPackageConflictResponse"
    assert "leaked_dependencies" in schemas["RosterAgentPackageConflictResponse"]["properties"]
    assert "403" in package_import["responses"]
    export = paths["/apps/{app_id}/export"]["get"]
    assert export["responses"]["200"]["content"]["application/zip"]["schema"] == {"type": "string", "format": "binary"}
    assert export["responses"]["200"]["content"]["application/json"]["schema"]["$ref"] == (
        "#/components/schemas/AppExportResponse"
    )
    export_format = next(param for param in export["parameters"] if param["name"] == "format")
    assert set(export_format["schema"]["enum"]) == {"yaml", "ifpkg"}
    assert export_format["schema"].get("default") is None
    assert "defaults to ifpkg for all Apps" in export_format["description"]

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
    trigger_run_request = _request_schema(paths["/apps/{app_id}/workflows/draft/trigger/run"]["post"])
    assert trigger_run_request["$ref"] == "#/components/schemas/DraftWorkflowTriggerRunPayload"
    assert "DraftWorkflowTriggerRunRequest" not in schemas

    draft_variable_list_ref = "#/components/schemas/WorkflowDraftVariableListWithoutValueResponse"
    for path in (
        "/apps/{app_id}/workflows/draft/variables",
        "/snippets/{snippet_id}/workflows/draft/variables",
        "/rag/pipelines/{pipeline_id}/workflows/draft/variables",
    ):
        assert _response_schema(paths[path]["get"])["$ref"] == draft_variable_list_ref
    assert schemas["WorkflowDraftVariableListResponse"]["properties"]["items"]["items"]["$ref"] == (
        "#/components/schemas/WorkflowDraftVariableResponse"
    )
    full_content = schemas["WorkflowDraftVariableFullContentResponse"]
    assert set(full_content["properties"]) == {"size_bytes", "value_type", "length", "download_url"}
    assert "WorkflowDraftVariable" not in schemas
    assert "WorkflowDraftVariableList" not in schemas
    assert "WorkflowDraftVariableWithoutValue" not in schemas
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
