import json
from copy import deepcopy
from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter, ToolProviderType
from core.tools.tool.tool import Tool
from extensions.ext_database import db
from models.account import Account
from models.model import App, EndUser
from models.workflow import Workflow


class WorkflowTool(Tool):
    workflow_app_id: str
    version: str
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
        app = self._get_app(app_id=self.workflow_app_id)
        workflow = self._get_workflow(app_id=self.workflow_app_id, version=self.version)

        # transform the tool parameters
        tool_parameters, files = self._transform_args(tool_parameters)

        from core.app.apps.workflow.app_generator import WorkflowAppGenerator
        generator = WorkflowAppGenerator()
        result = generator.generate(
            app_model=app, 
            workflow=workflow, 
            user=self._get_user(user_id), 
            args={
                'inputs': tool_parameters,
                'files': files
            }, 
            invoke_from=self.runtime.invoke_from,
            stream=False,
            call_depth=self.workflow_call_depth + 1,
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

    def fork_tool_runtime(self, runtime: dict[str, Any]) -> 'WorkflowTool':
        """
            fork a new tool with meta data

            :param meta: the meta data of a tool call processing, tenant_id is required
            :return: the new tool
        """
        return self.__class__(
            identity=deepcopy(self.identity),
            parameters=deepcopy(self.parameters),
            description=deepcopy(self.description),
            runtime=Tool.Runtime(**runtime),
            workflow_app_id=self.workflow_app_id,
            workflow_entities=self.workflow_entities,
            workflow_call_depth=self.workflow_call_depth,
            version=self.version
        )
    
    def _get_workflow(self, app_id: str, version: str) -> Workflow:
        """
            get the workflow by app id and version
        """
        if not version:
            workflow = db.session.query(Workflow).filter(
                Workflow.app_id == app_id, 
                Workflow.version != 'draft'
            ).order_by(Workflow.created_at.desc()).first()
        else:
            workflow = db.session.query(Workflow).filter(
                Workflow.app_id == app_id, 
                Workflow.version == version
            ).first()

        if not workflow:
            raise ValueError('workflow not found or not published')

        return workflow
    
    def _get_app(self, app_id: str) -> App:
        """
            get the app by app id
        """
        app = db.session.query(App).filter(App.id == app_id).first()
        if not app:
            raise ValueError('app not found')

        return app
    
    def _transform_args(self, tool_parameters: dict) -> tuple[dict, list[dict]]:
        """
            transform the tool parameters

            :param tool_parameters: the tool parameters
            :return: tool_parameters, files
        """
        parameter_rules = self.get_all_runtime_parameters()
        parameters_result = {}
        files = []
        for parameter in parameter_rules:
            if parameter.type == ToolParameter.ToolParameterType.FILE:
                files = tool_parameters.get(parameter.name)
                if files:
                    files.extend(files)
            else:
                parameters_result[parameter.name] = tool_parameters.get(parameter.name)

        return parameters_result, files