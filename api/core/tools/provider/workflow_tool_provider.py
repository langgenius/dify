import json

from core.app.app_config.entities import VariableEntity
from core.tools.entities.tool_entities import (
    ToolProviderType,
)
from core.tools.provider.tool_provider import ToolProviderController
from core.tools.tool.api_tool import ApiTool
from core.tools.tool.tool import Tool
from core.workflow.entities.node_entities import NodeType
from models.model import App
from models.tools import WorkflowToolProvider
from models.workflow import Workflow


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
    
    def _get_db_provider_tool(self, db_provider: WorkflowToolProvider, app: App) -> Tool:
        """
            get db provider tool
            :param db_provider: the db provider
            :param app: the app
            :return: the tool
        """
        workflow: Workflow = app.workflow
        if not workflow:
            raise ValueError('workflow not found')

        # fetch start node
        graph: dict = workflow.graph

        nodes = graph.get('nodes', [])
        start_node = next(filter(lambda x: x.get('data', {}).get('type') == NodeType.START.value, nodes), None)

        if not start_node:
            raise ValueError('start node not found')
        
        variables = [
            VariableEntity(**variable) for variable in start_node.get('data', {}).get('variables', [])
        ]

        

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