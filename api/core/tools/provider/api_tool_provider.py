from typing import Any, Dict, List

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiBasedToolBundle
from core.tools.entities.tool_entities import (ApiProviderAuthType, ToolCredentialsOption, ToolProviderCredentials,
                                               ToolProviderType)
from core.tools.provider.tool_provider import ToolProviderController
from core.tools.tool.api_tool import ApiTool
from core.tools.tool.tool import Tool
from extensions.ext_database import db
from models.tools import ApiToolProvider


class ApiBasedToolProviderController(ToolProviderController):
    @staticmethod
    def from_db(db_provider: ApiToolProvider, auth_type: ApiProviderAuthType) -> 'ApiBasedToolProviderController':
        credentials_schema = {
            'auth_type': ToolProviderCredentials(
                name='auth_type',
                required=True,
                type=ToolProviderCredentials.CredentialsType.SELECT,
                options=[
                    ToolCredentialsOption(value='none', label=I18nObject(en_US='None', zh_Hans='无')),
                    ToolCredentialsOption(value='api_key', label=I18nObject(en_US='api_key', zh_Hans='api_key'))
                ],
                default='none',
                help=I18nObject(
                    en_US='The auth type of the api provider',
                    zh_Hans='api provider 的认证类型'
                )
            )
        }
        if auth_type == ApiProviderAuthType.API_KEY:
            credentials_schema = {
                **credentials_schema,
                'api_key_header': ToolProviderCredentials(
                    name='api_key_header',
                    required=False,
                    default='api_key',
                    type=ToolProviderCredentials.CredentialsType.TEXT_INPUT,
                    help=I18nObject(
                        en_US='The header name of the api key',
                        zh_Hans='携带 api key 的 header 名称'
                    )
                ),
                'api_key_value': ToolProviderCredentials(
                    name='api_key_value',
                    required=True,
                    type=ToolProviderCredentials.CredentialsType.SECRET_INPUT,
                    help=I18nObject(
                        en_US='The api key',
                        zh_Hans='api key的值'
                    )
                )
            }
        elif auth_type == ApiProviderAuthType.NONE:
            pass
        else:
            raise ValueError(f'invalid auth type {auth_type}')

        return ApiBasedToolProviderController(**{
            'identity': {
                'author': db_provider.user.name if db_provider.user_id and db_provider.user else '',
                'name': db_provider.name,
                'label': {
                    'en_US': db_provider.name,
                    'zh_Hans': db_provider.name
                },
                'description': {
                    'en_US': db_provider.description,
                    'zh_Hans': db_provider.description
                },
                'icon': db_provider.icon
            },
            'credentials_schema': credentials_schema
        })

    @property
    def app_type(self) -> ToolProviderType:
        return ToolProviderType.API_BASED
    
    def _validate_credentials(self, tool_name: str, credentials: Dict[str, Any]) -> None:
        pass

    def validate_parameters(self, tool_name: str, tool_parameters: Dict[str, Any]) -> None:
        pass

    def _parse_tool_bundle(self, tool_bundle: ApiBasedToolBundle) -> ApiTool:
        """
            parse tool bundle to tool

            :param tool_bundle: the tool bundle
            :return: the tool
        """
        return ApiTool(**{
            'api_bundle': tool_bundle,
            'identity' : {
                'author': tool_bundle.author,
                'name': tool_bundle.operation_id,
                'label': {
                    'en_US': tool_bundle.operation_id,
                    'zh_Hans': tool_bundle.operation_id
                },
                'icon': tool_bundle.icon if tool_bundle.icon else ''
            },
            'description': {
                'human': {
                    'en_US': tool_bundle.summary or '',
                    'zh_Hans': tool_bundle.summary or ''
                },
                'llm': tool_bundle.summary or ''
            },
            'parameters' : tool_bundle.parameters if tool_bundle.parameters else [],
        })

    def load_bundled_tools(self, tools: List[ApiBasedToolBundle]) -> List[ApiTool]:
        """
            load bundled tools

            :param tools: the bundled tools
            :return: the tools
        """
        self.tools = [self._parse_tool_bundle(tool) for tool in tools]

        return self.tools

    def get_tools(self, user_id: str, tenant_id: str) -> List[ApiTool]:
        """
            fetch tools from database

            :param user_id: the user id
            :param tenant_id: the tenant id
            :return: the tools
        """
        if self.tools is not None:
            return self.tools
        
        tools: List[Tool] = []

        # get tenant api providers
        db_providers: List[ApiToolProvider] = db.session.query(ApiToolProvider).filter(
            ApiToolProvider.tenant_id == tenant_id,
            ApiToolProvider.name == self.identity.name
        ).all()

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

        raise ValueError(f'tool {tool_name} not found')