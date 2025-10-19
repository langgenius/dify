from pydantic import Field
from sqlalchemy import select

from core.entities.provider_entities import ProviderConfig
from core.tools.__base.tool_provider import ToolProviderController
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.custom_tool.tool import ApiTool
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import (
    ApiProviderAuthType,
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolProviderEntity,
    ToolProviderIdentity,
    ToolProviderType,
)
from extensions.ext_database import db
from models.tools import ApiToolProvider


class ApiToolProviderController(ToolProviderController):
    provider_id: str
    tenant_id: str
    tools: list[ApiTool] = Field(default_factory=list)

    def __init__(self, entity: ToolProviderEntity, provider_id: str, tenant_id: str):
        super().__init__(entity)
        self.provider_id = provider_id
        self.tenant_id = tenant_id
        self.tools = []

    @classmethod
    def from_db(cls, db_provider: ApiToolProvider, auth_type: ApiProviderAuthType) -> "ApiToolProviderController":
        credentials_schema = [
            ProviderConfig(
                name="auth_type",
                required=True,
                type=ProviderConfig.Type.SELECT,
                options=[
                    ProviderConfig.Option(value="none", label=I18nObject(en_US="None", zh_Hans="无")),
                    ProviderConfig.Option(value="api_key_header", label=I18nObject(en_US="Header", zh_Hans="请求头")),
                    ProviderConfig.Option(
                        value="api_key_query", label=I18nObject(en_US="Query Param", zh_Hans="查询参数")
                    ),
                ],
                default="none",
                help=I18nObject(en_US="The auth type of the api provider", zh_Hans="api provider 的认证类型"),
            )
        ]
        if auth_type == ApiProviderAuthType.API_KEY_HEADER:
            credentials_schema = [
                *credentials_schema,
                ProviderConfig(
                    name="api_key_header",
                    required=False,
                    default="Authorization",
                    type=ProviderConfig.Type.TEXT_INPUT,
                    help=I18nObject(en_US="The header name of the api key", zh_Hans="携带 api key 的 header 名称"),
                ),
                ProviderConfig(
                    name="api_key_value",
                    required=True,
                    type=ProviderConfig.Type.SECRET_INPUT,
                    help=I18nObject(en_US="The api key", zh_Hans="api key 的值"),
                ),
                ProviderConfig(
                    name="api_key_header_prefix",
                    required=False,
                    default="basic",
                    type=ProviderConfig.Type.SELECT,
                    help=I18nObject(en_US="The prefix of the api key header", zh_Hans="api key header 的前缀"),
                    options=[
                        ProviderConfig.Option(value="basic", label=I18nObject(en_US="Basic", zh_Hans="Basic")),
                        ProviderConfig.Option(value="bearer", label=I18nObject(en_US="Bearer", zh_Hans="Bearer")),
                        ProviderConfig.Option(value="custom", label=I18nObject(en_US="Custom", zh_Hans="Custom")),
                    ],
                ),
            ]
        elif auth_type == ApiProviderAuthType.API_KEY_QUERY:
            credentials_schema = [
                *credentials_schema,
                ProviderConfig(
                    name="api_key_query_param",
                    required=False,
                    default="key",
                    type=ProviderConfig.Type.TEXT_INPUT,
                    help=I18nObject(
                        en_US="The query parameter name of the api key", zh_Hans="携带 api key 的查询参数名称"
                    ),
                ),
                ProviderConfig(
                    name="api_key_value",
                    required=True,
                    type=ProviderConfig.Type.SECRET_INPUT,
                    help=I18nObject(en_US="The api key", zh_Hans="api key 的值"),
                ),
            ]
        elif auth_type == ApiProviderAuthType.NONE:
            pass

        user = db_provider.user
        user_name = user.name if user else ""

        return ApiToolProviderController(
            entity=ToolProviderEntity(
                identity=ToolProviderIdentity(
                    author=user_name,
                    name=db_provider.name,
                    label=I18nObject(en_US=db_provider.name, zh_Hans=db_provider.name),
                    description=I18nObject(en_US=db_provider.description, zh_Hans=db_provider.description),
                    icon=db_provider.icon,
                ),
                credentials_schema=credentials_schema,
                plugin_id=None,
            ),
            provider_id=db_provider.id or "",
            tenant_id=db_provider.tenant_id or "",
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
            api_bundle=tool_bundle,
            provider_id=self.provider_id,
            entity=ToolEntity(
                identity=ToolIdentity(
                    author=tool_bundle.author,
                    name=tool_bundle.operation_id or "default_tool",
                    label=I18nObject(
                        en_US=tool_bundle.operation_id or "default_tool",
                        zh_Hans=tool_bundle.operation_id or "default_tool",
                    ),
                    icon=self.entity.identity.icon,
                    provider=self.provider_id,
                ),
                description=ToolDescription(
                    human=I18nObject(en_US=tool_bundle.summary or "", zh_Hans=tool_bundle.summary or ""),
                    llm=tool_bundle.summary or "",
                ),
                parameters=tool_bundle.parameters or [],
            ),
            runtime=ToolRuntime(tenant_id=self.tenant_id),
        )

    def load_bundled_tools(self, tools: list[ApiToolBundle]):
        """
        load bundled tools

        :param tools: the bundled tools
        :return: the tools
        """
        self.tools = [self._parse_tool_bundle(tool) for tool in tools]

        return self.tools

    def get_tools(self, tenant_id: str) -> list[ApiTool]:
        """
        fetch tools from database

        :param tenant_id: the tenant id
        :return: the tools
        """
        if len(self.tools) > 0:
            return self.tools

        tools: list[ApiTool] = []

        # get tenant api providers
        db_providers = db.session.scalars(
            select(ApiToolProvider).where(
                ApiToolProvider.tenant_id == tenant_id, ApiToolProvider.name == self.entity.identity.name
            )
        ).all()

        if db_providers and len(db_providers) != 0:
            for db_provider in db_providers:
                for tool in db_provider.tools:
                    assistant_tool = self._parse_tool_bundle(tool)
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
            self.get_tools(self.tenant_id)

        for tool in self.tools:
            if tool.entity.identity.name == tool_name:
                return tool

        raise ValueError(f"tool {tool_name} not found")
