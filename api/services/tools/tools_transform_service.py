import json
import logging
from typing import Any, Optional, Union, cast

from yarl import URL

from configs import dify_config
from core.helper.provider_cache import ToolProviderCredentialsCache
from core.mcp.types import Tool as MCPTool
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.custom_tool.provider import ApiToolProviderController
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity, ToolProviderCredentialApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import (
    ApiProviderAuthType,
    CredentialType,
    ToolParameter,
    ToolProviderType,
)
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.utils.encryption import create_provider_encrypter, create_tool_provider_encrypter
from core.tools.workflow_as_tool.provider import WorkflowToolProviderController
from core.tools.workflow_as_tool.tool import WorkflowTool
from models.tools import ApiToolProvider, BuiltinToolProvider, MCPToolProvider, WorkflowToolProvider

logger = logging.getLogger(__name__)


class ToolTransformService:
    @classmethod
    def get_plugin_icon_url(cls, tenant_id: str, filename: str) -> str:
        url_prefix = (
            URL(dify_config.CONSOLE_API_URL or "/") / "console" / "api" / "workspaces" / "current" / "plugin" / "icon"
        )
        return str(url_prefix % {"tenant_id": tenant_id, "filename": filename})

    @classmethod
    def get_tool_provider_icon_url(cls, provider_type: str, provider_name: str, icon: str | dict) -> Union[str, dict]:
        """
        get tool provider icon url
        """
        url_prefix = (
            URL(dify_config.CONSOLE_API_URL or "/") / "console" / "api" / "workspaces" / "current" / "tool-provider"
        )

        if provider_type == ToolProviderType.BUILT_IN.value:
            return str(url_prefix / "builtin" / provider_name / "icon")
        elif provider_type in {ToolProviderType.API.value, ToolProviderType.WORKFLOW.value}:
            try:
                if isinstance(icon, str):
                    return cast(dict, json.loads(icon))
                return icon
            except Exception:
                return {"background": "#252525", "content": "\ud83d\ude01"}
        elif provider_type == ToolProviderType.MCP.value:
            return icon
        return ""

    @staticmethod
    def repack_provider(tenant_id: str, provider: Union[dict, ToolProviderApiEntity]):
        """
        repack provider

        :param tenant_id: the tenant id
        :param provider: the provider dict
        """
        if isinstance(provider, dict) and "icon" in provider:
            provider["icon"] = ToolTransformService.get_tool_provider_icon_url(
                provider_type=provider["type"], provider_name=provider["name"], icon=provider["icon"]
            )
        elif isinstance(provider, ToolProviderApiEntity):
            if provider.plugin_id:
                if isinstance(provider.icon, str):
                    provider.icon = ToolTransformService.get_plugin_icon_url(
                        tenant_id=tenant_id, filename=provider.icon
                    )
                if isinstance(provider.icon_dark, str) and provider.icon_dark:
                    provider.icon_dark = ToolTransformService.get_plugin_icon_url(
                        tenant_id=tenant_id, filename=provider.icon_dark
                    )
            else:
                provider.icon = ToolTransformService.get_tool_provider_icon_url(
                    provider_type=provider.type.value, provider_name=provider.name, icon=provider.icon
                )
                if provider.icon_dark:
                    provider.icon_dark = ToolTransformService.get_tool_provider_icon_url(
                        provider_type=provider.type.value, provider_name=provider.name, icon=provider.icon_dark
                    )

    @classmethod
    def builtin_provider_to_user_provider(
        cls,
        provider_controller: BuiltinToolProviderController | PluginToolProviderController,
        db_provider: Optional[BuiltinToolProvider],
        decrypt_credentials: bool = True,
    ) -> ToolProviderApiEntity:
        """
        convert provider controller to user provider
        """
        result = ToolProviderApiEntity(
            id=provider_controller.entity.identity.name,
            author=provider_controller.entity.identity.author,
            name=provider_controller.entity.identity.name,
            description=provider_controller.entity.identity.description,
            icon=provider_controller.entity.identity.icon,
            icon_dark=provider_controller.entity.identity.icon_dark,
            label=provider_controller.entity.identity.label,
            type=ToolProviderType.BUILT_IN,
            masked_credentials={},
            is_team_authorization=False,
            plugin_id=None,
            tools=[],
            labels=provider_controller.tool_labels,
        )

        if isinstance(provider_controller, PluginToolProviderController):
            result.plugin_id = provider_controller.plugin_id
            result.plugin_unique_identifier = provider_controller.plugin_unique_identifier

        # get credentials schema
        schema = {
            x.to_basic_provider_config().name: x
            for x in provider_controller.get_credentials_schema_by_type(
                CredentialType.of(db_provider.credential_type) if db_provider else CredentialType.API_KEY
            )
        }

        for name, value in schema.items():
            if result.masked_credentials:
                result.masked_credentials[name] = ""

        # check if the provider need credentials
        if not provider_controller.need_credentials:
            result.is_team_authorization = True
            result.allow_delete = False
        elif db_provider:
            result.is_team_authorization = True

            if decrypt_credentials:
                credentials = db_provider.credentials

                # init tool configuration
                encrypter, _ = create_provider_encrypter(
                    tenant_id=db_provider.tenant_id,
                    config=[
                        x.to_basic_provider_config()
                        for x in provider_controller.get_credentials_schema_by_type(
                            CredentialType.of(db_provider.credential_type)
                        )
                    ],
                    cache=ToolProviderCredentialsCache(
                        tenant_id=db_provider.tenant_id,
                        provider=db_provider.provider,
                        credential_id=db_provider.id,
                    ),
                )
                # decrypt the credentials and mask the credentials
                decrypted_credentials = encrypter.decrypt(data=credentials)
                masked_credentials = encrypter.mask_tool_credentials(data=decrypted_credentials)

                result.masked_credentials = masked_credentials
                result.original_credentials = decrypted_credentials

        return result

    @staticmethod
    def api_provider_to_controller(
        db_provider: ApiToolProvider,
    ) -> ApiToolProviderController:
        """
        convert provider controller to user provider
        """
        # package tool provider controller
        auth_type = ApiProviderAuthType.NONE
        credentials_auth_type = db_provider.credentials.get("auth_type")
        if credentials_auth_type in ("api_key_header", "api_key"):  # backward compatibility
            auth_type = ApiProviderAuthType.API_KEY_HEADER
        elif credentials_auth_type == "api_key_query":
            auth_type = ApiProviderAuthType.API_KEY_QUERY

        controller = ApiToolProviderController.from_db(
            db_provider=db_provider,
            auth_type=auth_type,
        )

        return controller

    @staticmethod
    def workflow_provider_to_controller(db_provider: WorkflowToolProvider) -> WorkflowToolProviderController:
        """
        convert provider controller to provider
        """
        return WorkflowToolProviderController.from_db(db_provider)

    @staticmethod
    def workflow_provider_to_user_provider(
        provider_controller: WorkflowToolProviderController, labels: list[str] | None = None
    ):
        """
        convert provider controller to user provider
        """
        return ToolProviderApiEntity(
            id=provider_controller.provider_id,
            author=provider_controller.entity.identity.author,
            name=provider_controller.entity.identity.name,
            description=provider_controller.entity.identity.description,
            icon=provider_controller.entity.identity.icon,
            icon_dark=provider_controller.entity.identity.icon_dark,
            label=provider_controller.entity.identity.label,
            type=ToolProviderType.WORKFLOW,
            masked_credentials={},
            is_team_authorization=True,
            plugin_id=None,
            plugin_unique_identifier=None,
            tools=[],
            labels=labels or [],
        )

    @staticmethod
    def mcp_provider_to_user_provider(db_provider: MCPToolProvider, for_list: bool = False) -> ToolProviderApiEntity:
        user = db_provider.load_user()
        return ToolProviderApiEntity(
            id=db_provider.server_identifier if not for_list else db_provider.id,
            author=user.name if user else "Anonymous",
            name=db_provider.name,
            icon=db_provider.provider_icon,
            type=ToolProviderType.MCP,
            is_team_authorization=db_provider.authed,
            server_url=db_provider.masked_server_url,
            tools=ToolTransformService.mcp_tool_to_user_tool(
                db_provider, [MCPTool(**tool) for tool in json.loads(db_provider.tools)]
            ),
            updated_at=int(db_provider.updated_at.timestamp()),
            label=I18nObject(en_US=db_provider.name, zh_Hans=db_provider.name),
            description=I18nObject(en_US="", zh_Hans=""),
            server_identifier=db_provider.server_identifier,
        )

    @staticmethod
    def mcp_tool_to_user_tool(mcp_provider: MCPToolProvider, tools: list[MCPTool]) -> list[ToolApiEntity]:
        user = mcp_provider.load_user()
        return [
            ToolApiEntity(
                author=user.name if user else "Anonymous",
                name=tool.name,
                label=I18nObject(en_US=tool.name, zh_Hans=tool.name),
                description=I18nObject(en_US=tool.description, zh_Hans=tool.description),
                parameters=ToolTransformService.convert_mcp_schema_to_parameter(tool.inputSchema),
                labels=[],
            )
            for tool in tools
        ]

    @classmethod
    def api_provider_to_user_provider(
        cls,
        provider_controller: ApiToolProviderController,
        db_provider: ApiToolProvider,
        decrypt_credentials: bool = True,
        labels: list[str] | None = None,
    ) -> ToolProviderApiEntity:
        """
        convert provider controller to user provider
        """
        username = "Anonymous"
        if db_provider.user is None:
            raise ValueError(f"user is None for api provider {db_provider.id}")
        try:
            user = db_provider.user
            if not user:
                raise ValueError("user not found")

            username = user.name
        except Exception:
            logger.exception(f"failed to get user name for api provider {db_provider.id}")
        # add provider into providers
        credentials = db_provider.credentials
        result = ToolProviderApiEntity(
            id=db_provider.id,
            author=username,
            name=db_provider.name,
            description=I18nObject(
                en_US=db_provider.description,
                zh_Hans=db_provider.description,
            ),
            icon=db_provider.icon,
            label=I18nObject(
                en_US=db_provider.name,
                zh_Hans=db_provider.name,
            ),
            type=ToolProviderType.API,
            plugin_id=None,
            plugin_unique_identifier=None,
            masked_credentials={},
            is_team_authorization=True,
            tools=[],
            labels=labels or [],
        )

        if decrypt_credentials:
            # init tool configuration
            encrypter, _ = create_tool_provider_encrypter(
                tenant_id=db_provider.tenant_id,
                controller=provider_controller,
            )

            # decrypt the credentials and mask the credentials
            decrypted_credentials = encrypter.decrypt(data=credentials)
            masked_credentials = encrypter.mask_tool_credentials(data=decrypted_credentials)

            result.masked_credentials = masked_credentials

        return result

    @staticmethod
    def convert_tool_entity_to_api_entity(
        tool: Union[ApiToolBundle, WorkflowTool, Tool],
        tenant_id: str,
        labels: list[str] | None = None,
    ) -> ToolApiEntity:
        """
        convert tool to user tool
        """
        if isinstance(tool, Tool):
            # fork tool runtime
            tool = tool.fork_tool_runtime(
                runtime=ToolRuntime(
                    credentials={},
                    tenant_id=tenant_id,
                )
            )

            # get tool parameters
            parameters = tool.entity.parameters or []
            # get tool runtime parameters
            runtime_parameters = tool.get_runtime_parameters()
            # override parameters
            current_parameters = parameters.copy()
            for runtime_parameter in runtime_parameters:
                found = False
                for index, parameter in enumerate(current_parameters):
                    if parameter.name == runtime_parameter.name and parameter.form == runtime_parameter.form:
                        current_parameters[index] = runtime_parameter
                        found = True
                        break

                if not found and runtime_parameter.form == ToolParameter.ToolParameterForm.FORM:
                    current_parameters.append(runtime_parameter)

            return ToolApiEntity(
                author=tool.entity.identity.author,
                name=tool.entity.identity.name,
                label=tool.entity.identity.label,
                description=tool.entity.description.human if tool.entity.description else I18nObject(en_US=""),
                output_schema=tool.entity.output_schema,
                parameters=current_parameters,
                labels=labels or [],
            )
        if isinstance(tool, ApiToolBundle):
            return ToolApiEntity(
                author=tool.author,
                name=tool.operation_id or "",
                label=I18nObject(en_US=tool.operation_id, zh_Hans=tool.operation_id),
                description=I18nObject(en_US=tool.summary or "", zh_Hans=tool.summary or ""),
                parameters=tool.parameters,
                labels=labels or [],
            )

    @staticmethod
    def convert_builtin_provider_to_credential_entity(
        provider: BuiltinToolProvider, credentials: dict
    ) -> ToolProviderCredentialApiEntity:
        return ToolProviderCredentialApiEntity(
            id=provider.id,
            name=provider.name,
            provider=provider.provider,
            credential_type=CredentialType.of(provider.credential_type),
            is_default=provider.is_default,
            credentials=credentials,
        )

    @staticmethod
    def convert_mcp_schema_to_parameter(schema: dict) -> list["ToolParameter"]:
        """
        Convert MCP JSON schema to tool parameters

        :param schema: JSON schema dictionary
        :return: list of ToolParameter instances
        """

        def create_parameter(
            name: str, description: str, param_type: str, required: bool, input_schema: dict | None = None
        ) -> ToolParameter:
            """Create a ToolParameter instance with given attributes"""
            input_schema_dict: dict[str, Any] = {"input_schema": input_schema} if input_schema else {}
            return ToolParameter(
                name=name,
                llm_description=description,
                label=I18nObject(en_US=name),
                form=ToolParameter.ToolParameterForm.LLM,
                required=required,
                type=ToolParameter.ToolParameterType(param_type),
                human_description=I18nObject(en_US=description),
                **input_schema_dict,
            )

        def process_properties(props: dict, required: list, prefix: str = "") -> list[ToolParameter]:
            """Process properties recursively"""
            TYPE_MAPPING = {"integer": "number", "float": "number"}
            COMPLEX_TYPES = ["array", "object"]

            parameters = []
            for name, prop in props.items():
                current_description = prop.get("description", "")
                prop_type = prop.get("type", "string")

                if isinstance(prop_type, list):
                    prop_type = prop_type[0]
                if prop_type in TYPE_MAPPING:
                    prop_type = TYPE_MAPPING[prop_type]
                input_schema = prop if prop_type in COMPLEX_TYPES else None
                parameters.append(
                    create_parameter(name, current_description, prop_type, name in required, input_schema)
                )

            return parameters

        if schema.get("type") == "object" and "properties" in schema:
            return process_properties(schema["properties"], schema.get("required", []))
        return []
