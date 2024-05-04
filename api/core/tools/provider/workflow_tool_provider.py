import json

from core.tools.entities.tool_entities import (
    ToolProviderType,
)
from core.tools.provider.tool_provider import ToolProviderController
from core.tools.tool.api_tool import ApiTool
from core.tools.tool.tool import Tool
from models.tools import WorkflowToolProvider


class WorkflowToolProviderController(ToolProviderController):
    provider_id: str

    @classmethod
    def from_db(cls, db_provider: WorkflowToolProvider) -> 'WorkflowToolProviderController':
        app = db_provider.app

        if not app:
            raise ValueError('app not found')

        return WorkflowToolProviderController(**{
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
                'icon': json.dumps({
                    'content': app.icon,
                    'background': app.icon_background
                })
            },
            'credentials_schema': {},
            'provider_id': db_provider.id or '',
        })

    @property
    def app_type(self) -> ToolProviderType:
        return ToolProviderType.WORKFLOW_BASED
    
    def _get_db_provider_tool(self, db_provider: WorkflowToolProvider) -> Tool:
        """
            get db provider tool

            :return: the tool
        """

    def get_tools(self, user_id: str, tenant_id: str) -> list[ApiTool]:
        """
            fetch tools from database

            :param user_id: the user id
            :param tenant_id: the tenant id
            :return: the tools
        """
    
    def get_tool(self, tool_name: str) -> ApiTool:
        """
            get tool by name

            :param tool_name: the name of the tool
            :return: the tool
        """