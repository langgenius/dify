import json
from datetime import datetime

from core.tools.entities.user_entities import UserToolProvider
from core.tools.provider.workflow_tool_provider import WorkflowToolProviderController
from extensions.ext_database import db
from models.model import App
from models.tools import WorkflowToolProvider
from services.tools.tools_transform_service import ToolTransformService


class WorkflowToolManageService:
    """
    Service class for managing workflow tools.
    """

    @classmethod
    def update_workflow_tool(cls, user_id: str, tenant_id: str, workflow_app_id: str, 
                             name: str, icon: dict, description: str, 
                             parameters: list[dict]) -> dict:
        """
        Update a workflow tool.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param tool: the tool
        :return: the updated tool
        """
        # check if the name is unique
        existing_workflow_tool_provider = db.session.query(WorkflowToolProvider).filter(
            WorkflowToolProvider.tenant_id == tenant_id,
            WorkflowToolProvider.name == name,
            WorkflowToolProvider.app_id != workflow_app_id
        ).first()

        if existing_workflow_tool_provider is not None:
            raise ValueError(f'Tool with name {name} already exists')
        
        app: App = db.session.query(App).filter(
            App.id == workflow_app_id,
            App.tenant_id == tenant_id
        ).first()

        if app is None:
            raise ValueError(f'App {workflow_app_id} not found')

        workflow_tool_provider: WorkflowToolProvider = db.session.query(WorkflowToolProvider).filter(
            WorkflowToolProvider.tenant_id == tenant_id,
            WorkflowToolProvider.app_id == workflow_app_id
        ).first()

        if workflow_tool_provider is None:
            workflow_tool_provider = WorkflowToolProvider(
                tenant_id=tenant_id,
                user_id=user_id,
                app_id=workflow_app_id,
                name=name,
                icon=json.dumps(icon),
                description=description,
                parameter_configuration=json.dumps(parameters)
            )
        else:
            workflow_tool_provider.name = name
            workflow_tool_provider.icon = json.dumps(icon)
            workflow_tool_provider.description = description
            workflow_tool_provider.parameter_configuration = json.dumps(parameters)

            workflow_tool_provider.updated_at = datetime.now()

        try:
            WorkflowToolProviderController.from_db(workflow_tool_provider)
        except Exception as e:
            raise ValueError(str(e))

        db.session.add(workflow_tool_provider)
        db.session.commit()

        return {
            'result': 'success'
        }

    @classmethod
    def list_tenant_workflow_tools(cls, user_id: str, tenant_id: str) -> list[UserToolProvider]:
        """
        List workflow tools.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :return: the list of tools
        """
        db_tools = db.session.query(WorkflowToolProvider).filter(
            WorkflowToolProvider.tenant_id == tenant_id
        ).all()

        tools = [
            ToolTransformService.workflow_provider_to_controller(provider)
            for provider in db_tools
        ]

        result = []

        for tool in tools:
            user_tool_provider = ToolTransformService.workflow_provider_to_user_provider(tool)
            ToolTransformService.repack_provider(user_tool_provider)
            user_tool_provider.tools = [
                ToolTransformService.tool_to_user_tool(tool.get_tools(user_id, tenant_id)[0])
            ]
            result.append(user_tool_provider)

        return result

    @classmethod
    def delete_workflow_tool(cls, user_id: str, tenant_id: str, workflow_app_id: str) -> dict:
        """
        Delete a workflow tool.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_app_id: the workflow app id
        """
        db.session.query(WorkflowToolProvider).filter(
            WorkflowToolProvider.tenant_id == tenant_id,
            WorkflowToolProvider.app_id == workflow_app_id
        ).delete()

        db.session.commit()

        return {
            'result': 'success'
        }

    @classmethod
    def get_workflow_tool(cls, user_id: str, tenant_id: str, workflow_app_id: str) -> dict:
        """
        Get a workflow tool.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_app_id: the workflow app id
        :return: the tool
        """
        db_tool: WorkflowToolProvider = db.session.query(WorkflowToolProvider).filter(
            WorkflowToolProvider.tenant_id == tenant_id,
            WorkflowToolProvider.app_id == workflow_app_id
        ).first()

        if db_tool is None:
            raise ValueError(f'Tool {workflow_app_id} not found')

        tool = ToolTransformService.workflow_provider_to_controller(db_tool)

        return {
            'name': db_tool.name,
            'icon': json.loads(db_tool.icon),
            'description': db_tool.description,
            'parameters': db_tool.parameter_configurations,
            'tool': ToolTransformService.tool_to_user_tool(tool.get_tools(user_id, tenant_id)[0])
        }
    
    @classmethod
    def list_single_workflow_tools(cls, user_id: str, tenant_id: str, workflow_app_id: str) -> list[dict]:
        """
        List workflow tool provider tools.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_app_id: the workflow app id
        :return: the list of tools
        """
        db_tool: WorkflowToolProvider = db.session.query(WorkflowToolProvider).filter(
            WorkflowToolProvider.tenant_id == tenant_id,
            WorkflowToolProvider.app_id == workflow_app_id
        ).first()

        if db_tool is None:
            raise ValueError(f'Tool {workflow_app_id} not found')

        tool = ToolTransformService.workflow_provider_to_controller(db_tool)

        return [
            ToolTransformService.tool_to_user_tool(tool.get_tools(user_id, tenant_id)[0])
        ]