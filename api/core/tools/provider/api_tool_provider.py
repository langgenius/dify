from typing import Any, Dict, List
from core.tools.entities.assistant_entities import AssistantAppMessage, AssistantAppType
from core.tools.entities.assistant_bundle import AssistantApiBasedToolBundle
from core.tools.provider.assistant_tool import AssistantTool
from core.tools.provider.tool_provider import AssistantToolProvider
from core.model_runtime.entities.message_entities import PromptMessage

from extensions.ext_database import db

from models.tools import AssistantApiProvider, AssistantApiProviderSchemaType

class ApiBasedToolProvider(AssistantToolProvider):
    @property
    def app_type(self) -> AssistantAppType:
        return AssistantAppType.API_BASED
    
    def invoke(self, 
               tool_id: int, tool_name: str, 
               tool_paramters: Dict[str, Any], 
               credentials: Dict[str, Any],
               prompt_messages: List[PromptMessage]
        ) -> List[AssistantAppMessage]:
        """
            invoke app based assistant

            tool_name: the name of the tool, defined in `get_tools`
            tool_paramters: the parameters of the tool
            credentials: the credentials of the tool
            prompt_messages: the prompt messages that the tool can use

            :return: the messages that the tool wants to send to the user
        """
        return []

    def _validate_credentials(self, tool_name: str, credentials: Dict[str, Any]) -> None:
        pass

    def validate_parameters(self, tool_name: str, tool_parameters: Dict[str, Any]) -> None:
        pass

    def _parse_tool_bundle(self, tool_bundle: AssistantApiBasedToolBundle) -> AssistantTool:
        """
            parse tool bundle to tool

            :param tool_bundle: the tool bundle
            :return: the tool
        """
        return AssistantTool(**{
            'identity' : {
                'author': tool_bundle.author,
                'name': tool_bundle.operation_id,
                'label': {
                    'en_US': tool_bundle.operation_id,
                    'zh_Hans': tool_bundle.operation_id
                },
                'description': {
                    'en_US': tool_bundle.summary,
                    'zh_Hans': tool_bundle.summary
                },
                'icon': tool_bundle.icon
            },
            'description': {
                'human': {
                    'en_US': tool_bundle.summary,
                    'zh_Hans': tool_bundle.summary
                },
                'llm': tool_bundle.summary
            },
            'parameters' : tool_bundle.parameters if tool_bundle.parameters else [],
        })

    def get_tools(self, user_id: str, tanent_id: str) -> List[AssistantTool]:
        """
            fetch tools from database

            :param user_id: the user id
            :param tanent_id: the tanent id
            :return: the tools
        """
        tools: List[AssistantTool] = []

        # get tanent api providers
        db_providers: List[AssistantApiProvider] = db.session.query(AssistantApiProvider).filter(
            AssistantApiProvider.tenant_id == tanent_id,
        ).all()

        if db_providers and len(db_providers) != 0:
            for db_provider in db_providers:
                for tool in db_provider.tools:
                    assistant_tool = self._parse_tool_bundle(tool)
                    assistant_tool.is_team_authorization = True
                    tools.append(assistant_tool)

        # get user api providers
        db_providers: List[AssistantApiProvider] = db.session.query(AssistantApiProvider).filter(
            AssistantApiProvider.user_id == user_id,
            AssistantApiProvider.tenant_id == None
        ).all()

        if db_providers and len(db_providers) != 0:
            for db_provider in db_providers:
                for tool in db_provider.tools:
                    assistant_tool = self._parse_tool_bundle(tool)
                    assistant_tool.is_team_authorization = False
                    tools.append(assistant_tool)

        return tools