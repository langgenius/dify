import json
from copy import deepcopy
from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.tool.tool import Tool
from extensions.ext_database import db
from models.account import Account
from models.model import App, EndUser


class WorkflowTool(Tool):
    workflow_app_id: str
    workflow_entities: dict[str, Any]
    workflow_call_depth: int

    """
    Workflow tool.
    """
    def tool_provider_type(self) -> ToolProviderType:
        """
            get the tool provider type

            :return: the tool provider type
        """
        return ToolProviderType.WORKFLOW
    
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) \
        -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke the tool
        """
        workflow = self.workflow_entities.get('workflow')
        app = self.workflow_entities.get('app')
        if not workflow or not app:
            raise ValueError('workflow not found')
        
        from core.app.apps.workflow.app_generator import WorkflowAppGenerator

        generator = WorkflowAppGenerator()
        app = db.session.query(App).filter(App.id == self.workflow_app_id).first()
        if not app:
            raise ValueError('app not found')
        workflow = app.workflow

        result = generator.generate(
            app_model=app, 
            workflow=workflow, 
            user=self._get_user(user_id), 
            args={
                'inputs': tool_parameters,
            }, 
            invoke_from=self.runtime.invoke_from,
            stream=False,
            call_depth=self.workflow_call_depth
        )

        return self.create_text_message(json.dumps(result))

    def _get_user(self, user_id: str) -> Union[EndUser, Account]:
        """
            get the user by user id
        """

        user = db.session.query(EndUser).filter(EndUser.id == user_id).first()
        if not user:
            user = db.session.query(Account).filter(Account.id == user_id).first()

        if not user:
            raise ValueError('user not found')

        return user

    def fork_tool_runtime(self, meta: dict[str, Any]) -> 'WorkflowTool':
        """
            fork a new tool with meta data

            :param meta: the meta data of a tool call processing, tenant_id is required
            :return: the new tool
        """
        return self.__class__(
            identity=deepcopy(self.identity),
            parameters=deepcopy(self.parameters),
            description=deepcopy(self.description),
            runtime=Tool.Runtime(**meta),
            workflow_app_id=self.workflow_app_id,
            workflow_entities=self.workflow_entities,
            workflow_call_depth=self.workflow_call_depth
        )