import json
import logging
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from core.model_runtime.utils.encoders import jsonable_encoder
from core.tools.__base.tool_provider import ToolProviderController
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.tool_label_manager import ToolLabelManager
from core.tools.utils.workflow_configuration_sync import WorkflowToolConfigurationUtils
from core.tools.workflow_as_tool.provider import WorkflowToolProviderController
from core.tools.workflow_as_tool.tool import WorkflowTool
from extensions.ext_database import db
from models.model import App
from models.tools import WorkflowToolProvider
from models.workflow import Workflow
from services.tools.tools_transform_service import ToolTransformService

logger = logging.getLogger(__name__)


class WorkflowToolManageService:
    """
    Service class for managing workflow tools.
    """

    @staticmethod
    def create_workflow_tool(
        *,
        user_id: str,
        tenant_id: str,
        workflow_app_id: str,
        name: str,
        label: str,
        icon: dict,
        description: str,
        parameters: list[Mapping[str, Any]],
        privacy_policy: str = "",
        labels: list[str] | None = None,
    ):
        WorkflowToolConfigurationUtils.check_parameter_configurations(parameters)

        # check if the name is unique
        existing_workflow_tool_provider = (
            db.session.query(WorkflowToolProvider)
            .where(
                WorkflowToolProvider.tenant_id == tenant_id,
                # name or app_id
                or_(WorkflowToolProvider.name == name, WorkflowToolProvider.app_id == workflow_app_id),
            )
            .first()
        )

        if existing_workflow_tool_provider is not None:
            raise ValueError(f"Tool with name {name} or app_id {workflow_app_id} already exists")

        app: App | None = db.session.query(App).where(App.id == workflow_app_id, App.tenant_id == tenant_id).first()

        if app is None:
            raise ValueError(f"App {workflow_app_id} not found")

        workflow: Workflow | None = app.workflow
        if workflow is None:
            raise ValueError(f"Workflow not found for app {workflow_app_id}")

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

        with Session(db.engine, expire_on_commit=False) as session, session.begin():
            session.add(workflow_tool_provider)

        if labels is not None:
            ToolLabelManager.update_tool_labels(
                ToolTransformService.workflow_provider_to_controller(workflow_tool_provider), labels
            )
        return {"result": "success"}

    @classmethod
    def update_workflow_tool(
        cls,
        user_id: str,
        tenant_id: str,
        workflow_tool_id: str,
        name: str,
        label: str,
        icon: dict,
        description: str,
        parameters: list[Mapping[str, Any]],
        privacy_policy: str = "",
        labels: list[str] | None = None,
    ):
        """
        Update a workflow tool.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_tool_id: workflow tool id
        :param name: name
        :param label: label
        :param icon: icon
        :param description: description
        :param parameters: parameters
        :param privacy_policy: privacy policy
        :param labels: labels
        :return: the updated tool
        """
        WorkflowToolConfigurationUtils.check_parameter_configurations(parameters)

        # check if the name is unique
        existing_workflow_tool_provider = (
            db.session.query(WorkflowToolProvider)
            .where(
                WorkflowToolProvider.tenant_id == tenant_id,
                WorkflowToolProvider.name == name,
                WorkflowToolProvider.id != workflow_tool_id,
            )
            .first()
        )

        if existing_workflow_tool_provider is not None:
            raise ValueError(f"Tool with name {name} already exists")

        workflow_tool_provider: WorkflowToolProvider | None = (
            db.session.query(WorkflowToolProvider)
            .where(WorkflowToolProvider.tenant_id == tenant_id, WorkflowToolProvider.id == workflow_tool_id)
            .first()
        )

        if workflow_tool_provider is None:
            raise ValueError(f"Tool {workflow_tool_id} not found")

        app: App | None = (
            db.session.query(App).where(App.id == workflow_tool_provider.app_id, App.tenant_id == tenant_id).first()
        )

        if app is None:
            raise ValueError(f"App {workflow_tool_provider.app_id} not found")

        workflow: Workflow | None = app.workflow
        if workflow is None:
            raise ValueError(f"Workflow not found for app {workflow_tool_provider.app_id}")

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

        db.session.commit()

        if labels is not None:
            ToolLabelManager.update_tool_labels(
                ToolTransformService.workflow_provider_to_controller(workflow_tool_provider), labels
            )

        return {"result": "success"}

    @classmethod
    def list_tenant_workflow_tools(cls, user_id: str, tenant_id: str) -> list[ToolProviderApiEntity]:
        """
        List workflow tools.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :return: the list of tools
        """
        db_tools = db.session.scalars(
            select(WorkflowToolProvider).where(WorkflowToolProvider.tenant_id == tenant_id)
        ).all()

        # Create a mapping from provider_id to app_id
        provider_id_to_app_id = {provider.id: provider.app_id for provider in db_tools}

        tools: list[WorkflowToolProviderController] = []
        for provider in db_tools:
            try:
                tools.append(ToolTransformService.workflow_provider_to_controller(provider))
            except Exception:
                # skip deleted tools
                logger.exception("Failed to load workflow tool provider %s", provider.id)

        labels = ToolLabelManager.get_tools_labels([t for t in tools if isinstance(t, ToolProviderController)])

        result = []

        for tool in tools:
            workflow_app_id = provider_id_to_app_id.get(tool.provider_id)
            user_tool_provider = ToolTransformService.workflow_provider_to_user_provider(
                provider_controller=tool,
                labels=labels.get(tool.provider_id, []),
                workflow_app_id=workflow_app_id,
            )
            ToolTransformService.repack_provider(tenant_id=tenant_id, provider=user_tool_provider)
            user_tool_provider.tools = [
                ToolTransformService.convert_tool_entity_to_api_entity(
                    tool=tool.get_tools(tenant_id)[0],
                    labels=labels.get(tool.provider_id, []),
                    tenant_id=tenant_id,
                )
            ]
            result.append(user_tool_provider)

        return result

    @classmethod
    def delete_workflow_tool(cls, user_id: str, tenant_id: str, workflow_tool_id: str):
        """
        Delete a workflow tool.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_tool_id: the workflow tool id
        """
        db.session.query(WorkflowToolProvider).where(
            WorkflowToolProvider.tenant_id == tenant_id, WorkflowToolProvider.id == workflow_tool_id
        ).delete()

        db.session.commit()

        return {"result": "success"}

    @classmethod
    def get_workflow_tool_by_tool_id(cls, user_id: str, tenant_id: str, workflow_tool_id: str):
        """
        Get a workflow tool.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_tool_id: the workflow tool id
        :return: the tool
        """
        db_tool: WorkflowToolProvider | None = (
            db.session.query(WorkflowToolProvider)
            .where(WorkflowToolProvider.tenant_id == tenant_id, WorkflowToolProvider.id == workflow_tool_id)
            .first()
        )
        return cls._get_workflow_tool(tenant_id, db_tool)

    @classmethod
    def get_workflow_tool_by_app_id(cls, user_id: str, tenant_id: str, workflow_app_id: str):
        """
        Get a workflow tool.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_app_id: the workflow app id
        :return: the tool
        """
        db_tool: WorkflowToolProvider | None = (
            db.session.query(WorkflowToolProvider)
            .where(WorkflowToolProvider.tenant_id == tenant_id, WorkflowToolProvider.app_id == workflow_app_id)
            .first()
        )
        return cls._get_workflow_tool(tenant_id, db_tool)

    @classmethod
    def _get_workflow_tool(cls, tenant_id: str, db_tool: WorkflowToolProvider | None):
        """
        Get a workflow tool.
        :db_tool: the database tool
        :return: the tool
        """
        if db_tool is None:
            raise ValueError("Tool not found")

        workflow_app: App | None = (
            db.session.query(App).where(App.id == db_tool.app_id, App.tenant_id == db_tool.tenant_id).first()
        )

        if workflow_app is None:
            raise ValueError(f"App {db_tool.app_id} not found")

        workflow = workflow_app.workflow
        if not workflow:
            raise ValueError("Workflow not found")

        tool = ToolTransformService.workflow_provider_to_controller(db_tool)
        workflow_tools: list[WorkflowTool] = tool.get_tools(tenant_id)
        if len(workflow_tools) == 0:
            raise ValueError(f"Tool {db_tool.id} not found")

        tool_entity = workflow_tools[0].entity
        # get output schema from workflow tool entity
        output_schema = tool_entity.output_schema

        return {
            "name": db_tool.name,
            "label": db_tool.label,
            "workflow_tool_id": db_tool.id,
            "workflow_app_id": db_tool.app_id,
            "icon": json.loads(db_tool.icon),
            "description": db_tool.description,
            "parameters": jsonable_encoder(db_tool.parameter_configurations),
            "output_schema": output_schema,
            "tool": ToolTransformService.convert_tool_entity_to_api_entity(
                tool=tool.get_tools(db_tool.tenant_id)[0],
                labels=ToolLabelManager.get_tool_labels(tool),
                tenant_id=tenant_id,
            ),
            "synced": workflow.version == db_tool.version,
            "privacy_policy": db_tool.privacy_policy,
        }

    @classmethod
    def list_single_workflow_tools(cls, user_id: str, tenant_id: str, workflow_tool_id: str) -> list[ToolApiEntity]:
        """
        List workflow tool provider tools.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_tool_id: the workflow tool id
        :return: the list of tools
        """
        db_tool: WorkflowToolProvider | None = (
            db.session.query(WorkflowToolProvider)
            .where(WorkflowToolProvider.tenant_id == tenant_id, WorkflowToolProvider.id == workflow_tool_id)
            .first()
        )

        if db_tool is None:
            raise ValueError(f"Tool {workflow_tool_id} not found")

        tool = ToolTransformService.workflow_provider_to_controller(db_tool)
        workflow_tools: list[WorkflowTool] = tool.get_tools(tenant_id)
        if len(workflow_tools) == 0:
            raise ValueError(f"Tool {workflow_tool_id} not found")

        return [
            ToolTransformService.convert_tool_entity_to_api_entity(
                tool=tool.get_tools(db_tool.tenant_id)[0],
                labels=ToolLabelManager.get_tool_labels(tool),
                tenant_id=tenant_id,
            )
        ]
