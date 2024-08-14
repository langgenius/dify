import json
from datetime import datetime

from sqlalchemy import or_

from core.model_runtime.utils.encoders import jsonable_encoder
from core.tools.entities.api_entities import UserToolProvider
from core.tools.provider.workflow_tool_provider import WorkflowToolProviderController
from core.tools.tool_label_manager import ToolLabelManager
from core.tools.utils.workflow_configuration_sync import WorkflowToolConfigurationUtils
from extensions.ext_database import db
from models.model import App
from models.tools import WorkflowToolProvider
from models.workflow import Workflow
from services.tools.tools_transform_service import ToolTransformService


class WorkflowToolManageService:
    """
    Service class for managing workflow tools.
    """
    @classmethod
    def create_workflow_tool(cls, user_id: str, tenant_id: str, workflow_app_id: str, name: str, 
                                label: str, icon: dict, description: str,
                                parameters: list[dict], privacy_policy: str = '', labels: list[str] = None) -> dict:
        """
        Create a workflow tool.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param name: the name
        :param icon: the icon
        :param description: the description
        :param parameters: the parameters
        :param privacy_policy: the privacy policy
        :return: the created tool
        """
        WorkflowToolConfigurationUtils.check_parameter_configurations(parameters)

        # check if the name is unique
        existing_workflow_tool_provider = db.session.query(WorkflowToolProvider).filter(
            WorkflowToolProvider.tenant_id == tenant_id,
            # name or app_id
            or_(WorkflowToolProvider.name == name, WorkflowToolProvider.app_id == workflow_app_id)
        ).first()

        if existing_workflow_tool_provider is not None:
            raise ValueError(f'Tool with name {name} or app_id {workflow_app_id} already exists')
        
        app: App = db.session.query(App).filter(
            App.id == workflow_app_id,
            App.tenant_id == tenant_id
        ).first()

        if app is None:
            raise ValueError(f'App {workflow_app_id} not found')
        
        workflow: Workflow = app.workflow
        if workflow is None:
            raise ValueError(f'Workflow not found for app {workflow_app_id}')
        
        workflow_tool_provider = WorkflowToolProvider(
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=workflow_app_id,
            name=name,
            label=label,
            icon=json.dumps(icon),
            description=description,
            parameter_configuration=json.dumps(parameters),
            privacy_policy=privacy_policy,
            version=workflow.version,
        )

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
    def update_workflow_tool(cls, user_id: str, tenant_id: str, workflow_tool_id: str, 
                             name: str, label: str, icon: dict, description: str, 
                             parameters: list[dict], privacy_policy: str = '', labels: list[str] = None) -> dict:
        """
        Update a workflow tool.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param tool: the tool
        :return: the updated tool
        """
        WorkflowToolConfigurationUtils.check_parameter_configurations(parameters)

        # check if the name is unique
        existing_workflow_tool_provider = db.session.query(WorkflowToolProvider).filter(
            WorkflowToolProvider.tenant_id == tenant_id,
            WorkflowToolProvider.name == name,
            WorkflowToolProvider.id != workflow_tool_id
        ).first()

        if existing_workflow_tool_provider is not None:
            raise ValueError(f'Tool with name {name} already exists')
        
        workflow_tool_provider: WorkflowToolProvider = db.session.query(WorkflowToolProvider).filter(
            WorkflowToolProvider.tenant_id == tenant_id,
            WorkflowToolProvider.id == workflow_tool_id
        ).first()

        if workflow_tool_provider is None:
            raise ValueError(f'Tool {workflow_tool_id} not found')
        
        app: App = db.session.query(App).filter(
            App.id == workflow_tool_provider.app_id,
            App.tenant_id == tenant_id
        ).first()

        if app is None:
            raise ValueError(f'App {workflow_tool_provider.app_id} not found')
        
        workflow: Workflow = app.workflow
        if workflow is None:
            raise ValueError(f'Workflow not found for app {workflow_tool_provider.app_id}')
        
        workflow_tool_provider.name = name
        workflow_tool_provider.label = label
        workflow_tool_provider.icon = json.dumps(icon)
        workflow_tool_provider.description = description
        workflow_tool_provider.parameter_configuration = json.dumps(parameters)
        workflow_tool_provider.privacy_policy = privacy_policy
        workflow_tool_provider.version = workflow.version
        workflow_tool_provider.updated_at = datetime.now()

        try:
            WorkflowToolProviderController.from_db(workflow_tool_provider)
        except Exception as e:
            raise ValueError(str(e))

        db.session.add(workflow_tool_provider)
        db.session.commit()

        if labels is not None:
            ToolLabelManager.update_tool_labels(
                ToolTransformService.workflow_provider_to_controller(workflow_tool_provider),
                labels
            )

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

        tools = []
        for provider in db_tools:
            try:
                tools.append(ToolTransformService.workflow_provider_to_controller(provider))
            except:
                # skip deleted tools
                pass

        labels = ToolLabelManager.get_tools_labels(tools)

        result = []

        for tool in tools:
            user_tool_provider = ToolTransformService.workflow_provider_to_user_provider(
                provider_controller=tool,
                labels=labels.get(tool.provider_id, [])
            )
            ToolTransformService.repack_provider(user_tool_provider)
            user_tool_provider.tools = [
                ToolTransformService.tool_to_user_tool(
                    tool.get_tools(user_id, tenant_id)[0],
                    labels=labels.get(tool.provider_id, [])
                )
            ]
            result.append(user_tool_provider)

        return result

    @classmethod
    def delete_workflow_tool(cls, user_id: str, tenant_id: str, workflow_tool_id: str) -> dict:
        """
        Delete a workflow tool.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_app_id: the workflow app id
        """
        db.session.query(WorkflowToolProvider).filter(
            WorkflowToolProvider.tenant_id == tenant_id,
            WorkflowToolProvider.id == workflow_tool_id
        ).delete()

        db.session.commit()

        return {
            'result': 'success'
        }

    @classmethod
    def get_workflow_tool_by_tool_id(cls, user_id: str, tenant_id: str, workflow_tool_id: str) -> dict:
        """
        Get a workflow tool.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_app_id: the workflow app id
        :return: the tool
        """
        db_tool: WorkflowToolProvider = db.session.query(WorkflowToolProvider).filter(
            WorkflowToolProvider.tenant_id == tenant_id,
            WorkflowToolProvider.id == workflow_tool_id
        ).first()

        if db_tool is None:
            raise ValueError(f'Tool {workflow_tool_id} not found')
        
        workflow_app: App = db.session.query(App).filter(
            App.id == db_tool.app_id,
            App.tenant_id == tenant_id
        ).first()

        if workflow_app is None:
            raise ValueError(f'App {db_tool.app_id} not found')

        tool = ToolTransformService.workflow_provider_to_controller(db_tool)

        return {
            'name': db_tool.name,
            'label': db_tool.label,
            'workflow_tool_id': db_tool.id,
            'workflow_app_id': db_tool.app_id,
            'icon': json.loads(db_tool.icon),
            'description': db_tool.description,
            'parameters': jsonable_encoder(db_tool.parameter_configurations),
            'tool': ToolTransformService.tool_to_user_tool(
                tool.get_tools(user_id, tenant_id)[0],
                labels=ToolLabelManager.get_tool_labels(tool)
            ),
            'synced': workflow_app.workflow.version == db_tool.version,
            'privacy_policy': db_tool.privacy_policy,
        }
    
    @classmethod
    def get_workflow_tool_by_app_id(cls, user_id: str, tenant_id: str, workflow_app_id: str) -> dict:
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
        
        workflow_app: App = db.session.query(App).filter(
            App.id == db_tool.app_id,
            App.tenant_id == tenant_id
        ).first()

        if workflow_app is None:
            raise ValueError(f'App {db_tool.app_id} not found')

        tool = ToolTransformService.workflow_provider_to_controller(db_tool)

        return {
            'name': db_tool.name,
            'label': db_tool.label,
            'workflow_tool_id': db_tool.id,
            'workflow_app_id': db_tool.app_id,
            'icon': json.loads(db_tool.icon),
            'description': db_tool.description,
            'parameters': jsonable_encoder(db_tool.parameter_configurations),
            'tool': ToolTransformService.tool_to_user_tool(
                tool.get_tools(user_id, tenant_id)[0],
                labels=ToolLabelManager.get_tool_labels(tool)
            ),
            'synced': workflow_app.workflow.version == db_tool.version,
            'privacy_policy': db_tool.privacy_policy
        }
    
    @classmethod
    def list_single_workflow_tools(cls, user_id: str, tenant_id: str, workflow_tool_id: str) -> list[dict]:
        """
        List workflow tool provider tools.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_app_id: the workflow app id
        :return: the list of tools
        """
        db_tool: WorkflowToolProvider = db.session.query(WorkflowToolProvider).filter(
            WorkflowToolProvider.tenant_id == tenant_id,
            WorkflowToolProvider.id == workflow_tool_id
        ).first()

        if db_tool is None:
            raise ValueError(f'Tool {workflow_tool_id} not found')

        tool = ToolTransformService.workflow_provider_to_controller(db_tool)

        return [
            ToolTransformService.tool_to_user_tool(
                tool.get_tools(user_id, tenant_id)[0],
                labels=ToolLabelManager.get_tool_labels(tool)
            )
        ]