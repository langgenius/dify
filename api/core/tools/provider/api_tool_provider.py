from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import (
    ApiProviderAuthType,
    ToolCredentialsOption,
    ToolProviderCredentials,
    ToolProviderType,
)
from core.tools.provider.tool_provider import ToolProviderController
from core.tools.tool.api_tool import ApiTool
from core.tools.tool.tool import Tool
from extensions.ext_database import db
from models.tools import ApiToolProvider


class ApiToolProviderController(ToolProviderController):
    provider_id: str

    @staticmethod
    def from_db(db_provider: ApiToolProvider, auth_type: ApiProviderAuthType) -> "ApiToolProviderController":
        credentials_schema = {
            "auth_type": ToolProviderCredentials(
                name="auth_type",
                required=True,
                type=ToolProviderCredentials.CredentialsType.SELECT,
                options=[
                    ToolCredentialsOption(value="none", label=I18nObject(en_US="None", zh_Hans="无")),
                    ToolCredentialsOption(value="api_key", label=I18nObject(en_US="api_key", zh_Hans="api_key")),
                ],
                default="none",
                help=I18nObject(en_US="The auth type of the api provider", zh_Hans="api provider 的认证类型"),
            )
        }
        if auth_type == ApiProviderAuthType.API_KEY:
            credentials_schema = {
                **credentials_schema,
                "api_key_header": ToolProviderCredentials(
                    name="api_key_header",
                    required=False,
                    default="api_key",
                    type=ToolProviderCredentials.CredentialsType.TEXT_INPUT,
                    help=I18nObject(en_US="The header name of the api key", zh_Hans="携带 api key 的 header 名称"),
                ),
                "api_key_value": ToolProviderCredentials(
                    name="api_key_value",
                    required=True,
                    type=ToolProviderCredentials.CredentialsType.SECRET_INPUT,
                    help=I18nObject(en_US="The api key", zh_Hans="api key的值"),
                ),
                "api_key_header_prefix": ToolProviderCredentials(
                    name="api_key_header_prefix",
                    required=False,
                    default="basic",
                    type=ToolProviderCredentials.CredentialsType.SELECT,
                    help=I18nObject(en_US="The prefix of the api key header", zh_Hans="api key header 的前缀"),
                    options=[
                        ToolCredentialsOption(value="basic", label=I18nObject(en_US="Basic", zh_Hans="Basic")),
                        ToolCredentialsOption(value="bearer", label=I18nObject(en_US="Bearer", zh_Hans="Bearer")),
                        ToolCredentialsOption(value="custom", label=I18nObject(en_US="Custom", zh_Hans="Custom")),
                    ],
                ),
            }
        elif auth_type == ApiProviderAuthType.NONE:
            pass
        else:
            raise ValueError(f"invalid auth type {auth_type}")

        user_name = db_provider.user.name if db_provider.user_id else ""

        return ApiToolProviderController(
            **{
                "identity": {
                    "author": user_name,
                    "name": db_provider.name,
                    "label": {"en_US": db_provider.name, "zh_Hans": db_provider.name},
                    "description": {"en_US": db_provider.description, "zh_Hans": db_provider.description},
                    "icon": db_provider.icon,
                },
                "credentials_schema": credentials_schema,
                "provider_id": db_provider.id or "",
            }
        )

    @property
    def provider_type(self) -> ToolProviderType:
        return ToolProviderType.API

    def _parse_tool_bundle(self, tool_bundle: ApiToolBundle) -> ApiTool:
        """
        parse tool bundle to tool

        :param tool_bundle: the tool bundle
        :return: the tool
        """
        return ApiTool(
            **{
                "api_bundle": tool_bundle,
                "identity": {
                    "author": tool_bundle.author,
                    "name": tool_bundle.operation_id,
                    "label": {"en_US": tool_bundle.operation_id, "zh_Hans": tool_bundle.operation_id},
                    "icon": self.identity.icon,
                    "provider": self.provider_id,
                },
                "description": {
                    "human": {"en_US": tool_bundle.summary or "", "zh_Hans": tool_bundle.summary or ""},
                    "llm": tool_bundle.summary or "",
                },
                "parameters": tool_bundle.parameters or [],
            }
        )

    def load_bundled_tools(self, tools: list[ApiToolBundle]) -> list[ApiTool]:
        """
        load bundled tools

        :param tools: the bundled tools
        :return: the tools
        """
        self.tools = [self._parse_tool_bundle(tool) for tool in tools]

        return self.tools

    def get_tools(self, user_id: str, tenant_id: str) -> list[ApiTool]:
        """
        fetch tools from database

        :param user_id: the user id
        :param tenant_id: the tenant id
        :return: the tools
        """
        if self.tools is not None:
            return self.tools

        tools: list[Tool] = []

        # get tenant api providers
        db_providers: list[ApiToolProvider] = (
            db.session.query(ApiToolProvider)
            .filter(ApiToolProvider.tenant_id == tenant_id, ApiToolProvider.name == self.identity.name)
            .all()
        )

        if db_providers and len(db_providers) != 0:
            for db_provider in db_providers:
                for tool in db_provider.tools:
                    assistant_tool = self._parse_tool_bundle(tool)
                    assistant_tool.is_team_authorization = True
                    tools.append(assistant_tool)

        self.tools = tools
        return tools

    def get_tool(self, tool_name: str) -> ApiTool:
        """
        get tool by name

        :param tool_name: the name of the tool
        :return: the tool
        """
        if self.tools is None:
            self.get_tools()

        for tool in self.tools:
            if tool.identity.name == tool_name:
                return tool

        raise ValueError(f"tool {tool_name} not found")
