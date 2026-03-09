import json
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest

from core.mcp.types import Tool as MCPTool
from core.plugin.entities.plugin_daemon import CredentialType, PluginDatasourceProviderEntity
from core.tools.__base.tool import Tool
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import ApiProviderAuthType, ToolParameter, ToolProviderType
from core.tools.plugin_tool.provider import PluginToolProviderController
from models.tools import ApiToolProvider
from services.tools import tools_transform_service
from services.tools.tools_transform_service import ToolTransformService


def _build_tool_parameter(
    name: str,
    form: ToolParameter.ToolParameterForm = ToolParameter.ToolParameterForm.FORM,
) -> ToolParameter:
    return ToolParameter(
        name=name,
        label=I18nObject(en_US=name, zh_Hans=name),
        required=False,
        type=ToolParameter.ToolParameterType.STRING,
        form=form,
        llm_description=f"{name} desc",
        human_description=I18nObject(en_US=f"{name} desc", zh_Hans=f"{name} desc"),
    )


def _build_tool_provider_api_entity(**overrides: Any):
    default_payload = {
        "id": "provider-1",
        "author": "author-1",
        "name": "provider-name",
        "description": I18nObject(en_US="desc", zh_Hans="desc"),
        "icon": "icon.png",
        "icon_dark": "icon-dark.png",
        "label": I18nObject(en_US="label", zh_Hans="label"),
        "type": ToolProviderType.BUILT_IN,
        "masked_credentials": {},
        "is_team_authorization": False,
        "plugin_id": None,
        "plugin_unique_identifier": None,
        "tools": [],
        "labels": [],
    }
    default_payload.update(overrides)
    return tools_transform_service.ToolProviderApiEntity(**default_payload)


def test_get_tool_provider_icon_url_should_return_builtin_url_for_builtin_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    monkeypatch.setattr(tools_transform_service.dify_config, "CONSOLE_API_URL", "https://console.example.com")

    # Act
    result = ToolTransformService.get_tool_provider_icon_url(ToolProviderType.BUILT_IN, "search", "ignored")

    # Assert
    assert result == "https://console.example.com/console/api/workspaces/current/tool-provider/builtin/search/icon"


@pytest.mark.parametrize(
    ("provider_type", "icon", "expected"),
    [
        (ToolProviderType.API, '{"background":"#fff","content":"S"}', {"background": "#fff", "content": "S"}),
        (ToolProviderType.WORKFLOW, {"background": "#111", "content": "W"}, {"background": "#111", "content": "W"}),
        (ToolProviderType.MCP, "mcp-icon", "mcp-icon"),
        ("unknown", "whatever", ""),
    ],
)
def test_get_tool_provider_icon_url_should_handle_non_builtin_provider_types(
    provider_type: str,
    icon: str | dict[str, str],
    expected: Any,
) -> None:
    # Arrange
    provider_name = "provider"

    # Act
    result = ToolTransformService.get_tool_provider_icon_url(provider_type, provider_name, icon)

    # Assert
    assert result == expected


def test_get_tool_provider_icon_url_should_return_default_icon_when_api_icon_json_is_invalid() -> None:
    # Arrange
    invalid_json_icon = "{invalid-json"

    # Act
    result = ToolTransformService.get_tool_provider_icon_url(ToolProviderType.API, "provider", invalid_json_icon)

    # Assert
    assert result == {"background": "#252525", "content": "\ud83d\ude01"}


def test_repack_provider_should_repack_dict_icon_using_provider_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    provider = {"type": ToolProviderType.BUILT_IN, "name": "weather", "icon": "raw"}
    monkeypatch.setattr(
        ToolTransformService,
        "get_tool_provider_icon_url",
        MagicMock(return_value="repacked-icon-url"),
    )

    # Act
    ToolTransformService.repack_provider(
        tenant_id="tenant-1",
        provider=cast(PluginDatasourceProviderEntity, provider),
    )

    # Assert
    assert provider["icon"] == "repacked-icon-url"


def test_repack_provider_should_use_plugin_icon_urls_for_plugin_tool_provider_entity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    provider = _build_tool_provider_api_entity(plugin_id="plugin-1", icon="icon.png", icon_dark="icon-dark.png")
    get_icon_url_mock = MagicMock(side_effect=lambda tenant_id, filename: f"https://cdn/{tenant_id}/{filename}")
    monkeypatch.setattr(tools_transform_service.PluginService, "get_plugin_icon_url", get_icon_url_mock)

    # Act
    ToolTransformService.repack_provider(tenant_id="tenant-xyz", provider=provider)

    # Assert
    assert provider.icon == "https://cdn/tenant-xyz/icon.png"
    assert provider.icon_dark == "https://cdn/tenant-xyz/icon-dark.png"


def test_repack_provider_should_repack_non_plugin_tool_provider_entity(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    provider = _build_tool_provider_api_entity(
        plugin_id=None,
        type=ToolProviderType.WORKFLOW,
        icon={"content": "A", "background": "#000"},
        icon_dark={"content": "B", "background": "#222"},
    )
    repack_mock = MagicMock(side_effect=lambda **kwargs: f"repacked-{kwargs['provider_name']}")
    monkeypatch.setattr(ToolTransformService, "get_tool_provider_icon_url", repack_mock)

    # Act
    ToolTransformService.repack_provider(
        tenant_id="tenant-1",
        provider=cast(PluginDatasourceProviderEntity, provider),
    )

    # Assert
    assert provider.icon == "repacked-provider-name"
    assert provider.icon_dark == "repacked-provider-name"


def test_repack_provider_should_update_plugin_datasource_provider_icon(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    class _PluginDatasourceProviderEntity:
        def __init__(self) -> None:
            self.plugin_id = "plugin-1"
            self.declaration = SimpleNamespace(identity=SimpleNamespace(icon="db-icon.png"))

    monkeypatch.setattr(tools_transform_service, "PluginDatasourceProviderEntity", _PluginDatasourceProviderEntity)
    provider = _PluginDatasourceProviderEntity()
    monkeypatch.setattr(
        tools_transform_service.PluginService,
        "get_plugin_icon_url",
        MagicMock(return_value="https://cdn/tenant-1/db-icon.png"),
    )

    # Act
    ToolTransformService.repack_provider(
        tenant_id="tenant-1",
        provider=cast(PluginDatasourceProviderEntity, provider),
    )

    # Assert
    assert provider.declaration.identity.icon == "https://cdn/tenant-1/db-icon.png"


def test_builtin_provider_to_user_provider_should_include_plugin_identity_for_plugin_controller(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    schema_item = MagicMock()
    schema_item.to_basic_provider_config.return_value.name = "api_key"

    class _PluginController:
        def __init__(self) -> None:
            self.entity = SimpleNamespace(
                identity=SimpleNamespace(
                    name="builtin-plugin",
                    author="author",
                    description=I18nObject(en_US="desc", zh_Hans="desc"),
                    icon="icon",
                    icon_dark="",
                    label=I18nObject(en_US="label", zh_Hans="label"),
                )
            )
            self.tool_labels = []
            self.need_credentials = False
            self.plugin_id = "plugin-1"
            self.plugin_unique_identifier = "plugin-unique"

        def get_credentials_schema_by_type(self, _credential_type: CredentialType) -> list[Any]:
            return [schema_item]

    monkeypatch.setattr(tools_transform_service, "PluginToolProviderController", _PluginController)
    provider_controller = _PluginController()

    # Act
    result = ToolTransformService.builtin_provider_to_user_provider(
        provider_controller=cast(PluginToolProviderController, provider_controller),
        db_provider=None,
    )

    # Assert
    assert result.plugin_id == "plugin-1"
    assert result.plugin_unique_identifier == "plugin-unique"


def test_builtin_provider_to_user_provider_should_mark_team_authorization_when_provider_does_not_need_credentials(
) -> None:
    # Arrange
    schema_item = MagicMock()
    schema_item.to_basic_provider_config.return_value.name = "api_key"

    provider_controller = MagicMock()
    provider_controller.entity.identity.name = "builtin"
    provider_controller.entity.identity.author = "author"
    provider_controller.entity.identity.description = I18nObject(en_US="desc", zh_Hans="desc")
    provider_controller.entity.identity.icon = "icon"
    provider_controller.entity.identity.icon_dark = ""
    provider_controller.entity.identity.label = I18nObject(en_US="label", zh_Hans="label")
    provider_controller.tool_labels = ["search"]
    provider_controller.need_credentials = False
    provider_controller.get_credentials_schema_by_type.return_value = [schema_item]

    # Act
    result = ToolTransformService.builtin_provider_to_user_provider(
        provider_controller=cast(BuiltinToolProviderController, provider_controller),
        db_provider=None,
    )

    # Assert
    assert result.is_team_authorization is True
    assert result.allow_delete is False
    assert result.masked_credentials == {"api_key": ""}


def test_builtin_provider_to_user_provider_should_raise_when_tenant_id_missing_for_decryption() -> None:
    # Arrange
    schema_item = MagicMock()
    schema_item.to_basic_provider_config.return_value.name = "api_key"

    provider_controller = MagicMock()
    provider_controller.entity.identity.name = "builtin"
    provider_controller.entity.identity.author = "author"
    provider_controller.entity.identity.description = I18nObject(en_US="desc", zh_Hans="desc")
    provider_controller.entity.identity.icon = "icon"
    provider_controller.entity.identity.icon_dark = ""
    provider_controller.entity.identity.label = I18nObject(en_US="label", zh_Hans="label")
    provider_controller.tool_labels = []
    provider_controller.need_credentials = True
    provider_controller.get_credentials_schema_by_type.return_value = [schema_item]

    db_provider = MagicMock()
    db_provider.credentials = {"api_key": "encrypted"}
    db_provider.tenant_id = None
    db_provider.id = "cred-1"
    db_provider.credential_type = CredentialType.API_KEY

    # Act / Assert
    with pytest.raises(ValueError, match="Required tenant_id is missing"):
        ToolTransformService.builtin_provider_to_user_provider(
            provider_controller=provider_controller,
            db_provider=db_provider,
        )


def test_builtin_provider_to_user_provider_should_decrypt_and_mask_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    schema_item = MagicMock()
    schema_item.to_basic_provider_config.return_value.name = "api_key"

    provider_controller = MagicMock()
    provider_controller.entity.identity.name = "builtin"
    provider_controller.entity.identity.author = "author"
    provider_controller.entity.identity.description = I18nObject(en_US="desc", zh_Hans="desc")
    provider_controller.entity.identity.icon = "icon"
    provider_controller.entity.identity.icon_dark = ""
    provider_controller.entity.identity.label = I18nObject(en_US="label", zh_Hans="label")
    provider_controller.tool_labels = []
    provider_controller.need_credentials = True
    provider_controller.get_credentials_schema_by_type.return_value = [schema_item]

    db_provider = MagicMock()
    db_provider.credentials = {"api_key": "encrypted"}
    db_provider.tenant_id = "tenant-1"
    db_provider.id = "cred-1"
    db_provider.provider = "builtin"
    db_provider.credential_type = "api-key"

    encrypter = MagicMock()
    encrypter.decrypt.return_value = {"api_key": "plain"}
    encrypter.mask_plugin_credentials.return_value = {"api_key": "****"}

    monkeypatch.setattr(tools_transform_service, "create_provider_encrypter", MagicMock(return_value=(encrypter, None)))

    # Act
    result = ToolTransformService.builtin_provider_to_user_provider(
        provider_controller=provider_controller,
        db_provider=db_provider,
    )

    # Assert
    assert result.is_team_authorization is True
    assert result.masked_credentials == {"api_key": "****"}
    assert result.original_credentials == {"api_key": "plain"}


@pytest.mark.parametrize(
    ("credentials", "expected_auth_type"),
    [
        ({"auth_type": "api_key_header"}, ApiProviderAuthType.API_KEY_HEADER),
        ({"auth_type": "api_key"}, ApiProviderAuthType.API_KEY_HEADER),
        ({"auth_type": "api_key_query"}, ApiProviderAuthType.API_KEY_QUERY),
        ({}, ApiProviderAuthType.NONE),
    ],
)
def test_api_provider_to_controller_should_map_auth_type_correctly(
    monkeypatch: pytest.MonkeyPatch,
    credentials: dict[str, str],
    expected_auth_type: ApiProviderAuthType,
) -> None:
    # Arrange
    db_provider = MagicMock()
    db_provider.credentials = credentials
    from_db_mock = MagicMock(return_value="controller")
    monkeypatch.setattr(tools_transform_service.ApiToolProviderController, "from_db", from_db_mock)

    # Act
    result = ToolTransformService.api_provider_to_controller(db_provider)

    # Assert
    assert result == "controller"
    from_db_mock.assert_called_once_with(db_provider=db_provider, auth_type=expected_auth_type)


def test_workflow_provider_to_controller_should_delegate_to_controller_factory(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    db_provider = MagicMock()
    from_db_mock = MagicMock(return_value="workflow-controller")
    monkeypatch.setattr(tools_transform_service.WorkflowToolProviderController, "from_db", from_db_mock)

    # Act
    result = ToolTransformService.workflow_provider_to_controller(db_provider)

    # Assert
    assert result == "workflow-controller"
    from_db_mock.assert_called_once_with(db_provider)


def test_workflow_provider_to_user_provider_should_include_labels_and_workflow_app_id() -> None:
    # Arrange
    provider_controller = MagicMock()
    provider_controller.provider_id = "provider-1"
    provider_controller.entity.identity.author = "author"
    provider_controller.entity.identity.name = "workflow-tool"
    provider_controller.entity.identity.description = I18nObject(en_US="desc", zh_Hans="desc")
    provider_controller.entity.identity.icon = {"content": "W", "background": "#111"}
    provider_controller.entity.identity.icon_dark = ""
    provider_controller.entity.identity.label = I18nObject(en_US="label", zh_Hans="label")

    # Act
    result = ToolTransformService.workflow_provider_to_user_provider(
        provider_controller=provider_controller,
        labels=["automation"],
        workflow_app_id="app-1",
    )

    # Assert
    assert result.id == "provider-1"
    assert result.type == ToolProviderType.WORKFLOW
    assert result.labels == ["automation"]
    assert result.workflow_app_id == "app-1"


def test_mcp_provider_to_user_provider_should_build_entity_and_convert_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    db_provider = MagicMock()
    db_provider.server_identifier = "server-1"
    db_provider.id = "db-id-1"
    db_provider.tools = json.dumps(
        [
            {
                "name": "get_weather",
                "inputSchema": {"type": "object", "properties": {}},
                "description": "desc",
            }
        ]
    )

    provider_entity = MagicMock()
    provider_entity.to_api_response.return_value = {
        "author": "owner",
        "name": "mcp-provider",
        "description": {"en_US": "desc"},
        "icon": "icon",
        "icon_dark": "",
        "label": {"en_US": "label"},
        "type": "mcp",
        "masked_credentials": {},
        "is_team_authorization": True,
        "plugin_id": None,
        "plugin_unique_identifier": None,
        "tools": [],
        "server_url": "https://mcp.example.com",
        "configuration": {"timeout": "30", "sse_read_timeout": "60"},
    }
    db_provider.to_entity.return_value = provider_entity

    mcp_tools = [MCPTool(name="get_weather", inputSchema={"type": "object", "properties": {}})]
    monkeypatch.setattr(
        tools_transform_service,
        "MCPTool",
        MagicMock(side_effect=lambda **kwargs: MCPTool(**kwargs)),
    )
    monkeypatch.setattr(
        ToolTransformService,
        "mcp_tool_to_user_tool",
        MagicMock(return_value=[]),
    )

    # Act
    result = ToolTransformService.mcp_provider_to_user_provider(
        db_provider=db_provider,
        for_list=False,
        user_name="owner",
    )

    # Assert
    assert result.id == "server-1"
    assert result.server_identifier == "server-1"
    assert result.configuration is not None
    assert result.configuration.timeout == 30.0
    assert result.configuration.sse_read_timeout == 60.0
    assert isinstance(mcp_tools[0], MCPTool)


def test_mcp_provider_to_user_provider_should_use_db_id_for_list_and_handle_invalid_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    db_provider = MagicMock()
    db_provider.server_identifier = "server-1"
    db_provider.id = "db-id-1"
    db_provider.tools = "{invalid-json"

    provider_entity = MagicMock()
    provider_entity.to_api_response.return_value = {
        "author": "owner",
        "name": "mcp-provider",
        "description": {"en_US": "desc"},
        "icon": "icon",
        "icon_dark": "",
        "label": {"en_US": "label"},
        "type": "mcp",
        "masked_credentials": {},
        "is_team_authorization": True,
        "plugin_id": None,
        "plugin_unique_identifier": None,
        "tools": [],
        "server_url": "https://mcp.example.com",
        "configuration": {"timeout": "30", "sse_read_timeout": "60"},
    }
    db_provider.to_entity.return_value = provider_entity

    mcp_tool_to_user_tool_mock = MagicMock(return_value=[])
    monkeypatch.setattr(ToolTransformService, "mcp_tool_to_user_tool", mcp_tool_to_user_tool_mock)

    # Act
    result = ToolTransformService.mcp_provider_to_user_provider(
        db_provider=db_provider,
        for_list=True,
        user_name="owner",
    )

    # Assert
    assert result.id == "db-id-1"
    called_tools = mcp_tool_to_user_tool_mock.call_args.args[1]
    assert called_tools == []


def test_mcp_provider_to_user_provider_should_load_user_when_user_name_not_provided(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    db_provider = MagicMock()
    db_provider.server_identifier = "server-1"
    db_provider.id = "db-id-1"
    db_provider.tools = "[]"
    db_provider.load_user.return_value = SimpleNamespace(name="Owner User")
    provider_entity = MagicMock()
    provider_entity.to_api_response.return_value = {
        "author": "owner",
        "name": "mcp-provider",
        "description": {"en_US": "desc"},
        "icon": "icon",
        "icon_dark": "",
        "label": {"en_US": "label"},
        "type": "mcp",
        "masked_credentials": {},
        "is_team_authorization": True,
        "plugin_id": None,
        "plugin_unique_identifier": None,
        "tools": [],
        "server_url": "https://mcp.example.com",
        "configuration": {"timeout": "30", "sse_read_timeout": "60"},
    }
    db_provider.to_entity.return_value = provider_entity
    monkeypatch.setattr(ToolTransformService, "mcp_tool_to_user_tool", MagicMock(return_value=[]))

    # Act
    ToolTransformService.mcp_provider_to_user_provider(db_provider=db_provider, user_name=None)

    # Assert
    db_provider.load_user.assert_called_once()
    provider_entity.to_api_response.assert_called_once_with(user_name="Owner User", include_sensitive=True)


def test_mcp_tool_to_user_tool_should_fallback_to_anonymous_when_user_missing() -> None:
    # Arrange
    mcp_provider = MagicMock()
    mcp_provider.load_user.return_value = None
    tools = [MCPTool(name="search", description="desc", inputSchema={"type": "object", "properties": {}})]

    # Act
    result = ToolTransformService.mcp_tool_to_user_tool(mcp_provider=mcp_provider, tools=tools)

    # Assert
    assert len(result) == 1
    assert result[0].author == "Anonymous"
    assert result[0].name == "search"


def test_api_provider_to_user_provider_should_raise_when_user_is_none() -> None:
    # Arrange
    db_provider = MagicMock()
    db_provider.id = "api-provider-1"
    db_provider.user = None

    # Act / Assert
    with pytest.raises(ValueError, match="user is None"):
        ToolTransformService.api_provider_to_user_provider(provider_controller=MagicMock(), db_provider=db_provider)


def test_api_provider_to_user_provider_should_return_anonymous_on_user_lookup_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    class _ApiProvider:
        def __init__(self) -> None:
            self.id = "api-provider-1"
            self.name = "api-provider"
            self.description = "desc"
            self.icon = "icon"
            self.tenant_id = "tenant-1"
            self.credentials = {"auth": "encrypted"}
            self._calls = 0

        @property
        def user(self) -> Any:
            self._calls += 1
            if self._calls == 1:
                return object()
            raise RuntimeError("db error")

    db_provider = _ApiProvider()

    logger_exception_mock = MagicMock()
    monkeypatch.setattr(tools_transform_service.logger, "exception", logger_exception_mock)

    # Act
    result = ToolTransformService.api_provider_to_user_provider(
        provider_controller=MagicMock(),
        db_provider=cast(ApiToolProvider, db_provider),
        decrypt_credentials=False,
    )

    # Assert
    assert result.author == "Anonymous"
    assert result.masked_credentials == {}
    logger_exception_mock.assert_called_once()


def test_api_provider_to_user_provider_should_decrypt_and_mask_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    db_provider = MagicMock()
    db_provider.id = "api-provider-1"
    db_provider.name = "api-provider"
    db_provider.description = "desc"
    db_provider.icon = "icon"
    db_provider.tenant_id = "tenant-1"
    db_provider.credentials = {"auth": "encrypted"}
    db_provider.user = SimpleNamespace(name="Jane")

    encrypter = MagicMock()
    encrypter.decrypt.return_value = {"auth": "decrypted"}
    encrypter.mask_plugin_credentials.return_value = {"auth": "****"}
    monkeypatch.setattr(
        tools_transform_service,
        "create_tool_provider_encrypter",
        MagicMock(return_value=(encrypter, None)),
    )

    # Act
    result = ToolTransformService.api_provider_to_user_provider(
        provider_controller=MagicMock(),
        db_provider=db_provider,
        decrypt_credentials=True,
        labels=["integration"],
    )

    # Assert
    assert result.author == "Jane"
    assert result.masked_credentials == {"auth": "****"}
    assert result.labels == ["integration"]


def test_convert_tool_entity_to_api_entity_should_merge_runtime_parameters_without_duplicates() -> None:
    # Arrange
    base_param = _build_tool_parameter("q")
    base_param_2 = _build_tool_parameter("limit")
    runtime_override = _build_tool_parameter("q")
    runtime_new_form = _build_tool_parameter("region")
    runtime_new_llm = _build_tool_parameter("hidden", form=ToolParameter.ToolParameterForm.LLM)

    class _Tool:
        def __init__(self) -> None:
            self.entity = SimpleNamespace(
                parameters=[base_param, base_param_2],
                identity=SimpleNamespace(
                    author="author",
                    name="tool-name",
                    label=I18nObject(en_US="Tool"),
                ),
                description=SimpleNamespace(human=I18nObject(en_US="desc")),
                output_schema={"type": "object"},
            )

        def get_runtime_parameters(self) -> list[ToolParameter]:
            return [runtime_override, runtime_new_form, runtime_new_llm]

        def fork_tool_runtime(self, runtime: Any) -> "_Tool":
            assert runtime.tenant_id == "tenant-1"
            return self

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(tools_transform_service, "Tool", _Tool)
    tool = _Tool()

    # Act
    result = ToolTransformService.convert_tool_entity_to_api_entity(
        tool=cast(Tool, tool),
        tenant_id="tenant-1",
        labels=["l1"],
    )
    monkeypatch.undo()

    # Assert
    assert result.name == "tool-name"
    assert [p.name for p in result.parameters or []] == ["q", "limit", "region"]
    assert result.labels == ["l1"]


def test_convert_tool_entity_to_api_entity_should_convert_non_tool_bundle_shape() -> None:
    # Arrange
    tool = SimpleNamespace(
        operation_id="operation-x",
        author="author",
        summary="summary",
        output_schema={"type": "object"},
        parameters=[_build_tool_parameter("x", ToolParameter.ToolParameterForm.LLM)],
    )

    # Act
    result = ToolTransformService.convert_tool_entity_to_api_entity(
        tool=cast(ApiToolBundle, tool),
        tenant_id="tenant-1",
    )

    # Assert
    assert result.name == "operation-x"
    assert result.author == "author"


def test_convert_builtin_provider_to_credential_entity_should_build_api_entity() -> None:
    # Arrange
    provider = MagicMock()
    provider.id = "cred-1"
    provider.name = "Credential 1"
    provider.provider = "openai"
    provider.credential_type = "api-key"
    provider.is_default = True

    # Act
    result = ToolTransformService.convert_builtin_provider_to_credential_entity(provider, credentials={"k": "v"})

    # Assert
    assert result.id == "cred-1"
    assert result.credential_type == CredentialType.API_KEY
    assert result.credentials == {"k": "v"}


def test_convert_mcp_schema_to_parameter_should_convert_supported_types_and_required_flags() -> None:
    # Arrange
    schema = {
        "type": "object",
        "required": ["count", "payload"],
        "properties": {
            "count": {"type": "integer", "description": "how many"},
            "ratio": {"type": "float", "description": "ratio"},
            "payload": {"type": "object", "description": "payload", "properties": {"a": {"type": "string"}}},
            "tags": {"type": "array", "description": "tags", "items": {"type": "string"}},
            "mixed": {"type": ["string", "null"], "description": "mixed"},
        },
    }

    # Act
    result = ToolTransformService.convert_mcp_schema_to_parameter(schema)

    # Assert
    assert [p.name for p in result] == ["count", "ratio", "payload", "tags", "mixed"]
    assert result[0].type == ToolParameter.ToolParameterType.NUMBER
    assert result[1].type == ToolParameter.ToolParameterType.NUMBER
    assert result[2].input_schema is not None
    assert result[3].input_schema is not None
    assert result[0].required is True
    assert result[2].required is True


def test_convert_mcp_schema_to_parameter_should_return_empty_for_non_object_schema() -> None:
    # Arrange
    schema = {"type": "string"}

    # Act
    result = ToolTransformService.convert_mcp_schema_to_parameter(schema)

    # Assert
    assert result == []
