import json
import logging
from typing import Any
from uuid import uuid4

from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.entities.tool_entities import WorkflowToolParameterConfiguration, emoji_icon_adapter
from core.tools.utils.workflow_configuration_sync import WorkflowToolConfigurationUtils
from graphon.model_runtime.utils.encoders import jsonable_encoder
from models.tool_runtime_contracts import WorkflowToolDefinition, WorkflowToolStore
from models.tools import WorkflowToolProvider
from services.tools.tool_label_manager import ToolLabelManager
from services.tools.tools_transform_service import ToolTransformService
from services.tools.workflow.provider import WorkflowToolProviderController
from services.tools.workflow.tool import WorkflowTool

logger = logging.getLogger(__name__)


class WorkflowToolManageService:
    """
    Service class for managing workflow tools.
    """

    def __init__(self, queries: WorkflowToolStore) -> None:
        self._queries = queries

    def create_workflow_tool(
        self,
        *,
        user_id: str,
        tenant_id: str,
        workflow_app_id: str,
        name: str,
        label: str,
        icon: dict[str, Any],
        description: str,
        parameters: list[WorkflowToolParameterConfiguration],
        privacy_policy: str = "",
        labels: list[str] | None = None,
        import_id: str = "",
    ):
        workflow = self._queries.current_workflow(tenant_id=tenant_id, app_id=workflow_app_id)

        # check if workflow configuration is synced
        WorkflowToolConfigurationUtils.ensure_no_human_input_nodes(workflow.graph_dict)

        # create workflow tool provider
        workflow_tool_provider = WorkflowToolDefinition(
            id=import_id or str(uuid4()),
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=workflow_app_id,
            name=name,
            label=label,
            icon=json.dumps(icon),
            description=description,
            parameter_configurations=parameters,
            privacy_policy=privacy_policy,
            version=workflow.version,
        )
        ToolTransformService.workflow_provider_to_controller(workflow_tool_provider, queries=self._queries)
        self._queries.save(
            workflow_tool_provider,
            labels=ToolLabelManager.filter_tool_labels(labels) if labels is not None else None,
            create=True,
        )

        return {"result": "success"}

    def update_workflow_tool(
        self,
        user_id: str,
        tenant_id: str,
        workflow_tool_id: str,
        name: str,
        label: str,
        icon: dict[str, Any],
        description: str,
        parameters: list[WorkflowToolParameterConfiguration],
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

        provider = self._queries.provider(tenant_id=tenant_id, provider_id=workflow_tool_id)
        if provider is None:
            raise ValueError(f"Tool {workflow_tool_id} not found")
        workflow = self._queries.current_workflow(tenant_id=tenant_id, app_id=provider.app_id)
        WorkflowToolConfigurationUtils.ensure_no_human_input_nodes(workflow.graph_dict)
        definition = WorkflowToolDefinition(
            id=provider.id,
            tenant_id=tenant_id,
            user_id=provider.user_id,
            app_id=provider.app_id,
            name=name,
            label=label,
            icon=json.dumps(icon),
            description=description,
            parameter_configurations=parameters,
            privacy_policy=privacy_policy,
            version=workflow.version,
        )
        ToolTransformService.workflow_provider_to_controller(definition, queries=self._queries)
        self._queries.save(
            definition,
            labels=ToolLabelManager.filter_tool_labels(labels) if labels is not None else None,
            create=False,
        )

        return {"result": "success"}

    def list_tenant_workflow_tools(self, user_id: str, tenant_id: str) -> list[ToolProviderApiEntity]:
        """
        List workflow tools.

        :param user_id: the user id
        :param tenant_id: the tenant id
        :return: the list of tools
        """

        providers = self._queries.providers(tenant_id=tenant_id)

        # Create a mapping from provider_id to app_id
        provider_id_to_app_id = {provider.id: provider.app_id for provider in providers}

        tools: list[WorkflowToolProviderController] = []
        for provider in providers:
            try:
                tools.append(ToolTransformService.workflow_provider_to_controller(provider, queries=self._queries))
            except Exception:
                # skip deleted tools
                logger.exception("Failed to load workflow tool provider %s", provider.id)

        labels = self._queries.labels(tenant_id=tenant_id, provider_ids=[tool.provider_id for tool in tools])

        result: list[ToolProviderApiEntity] = []

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

    def delete_workflow_tool(self, user_id: str, tenant_id: str, workflow_tool_id: str):
        """
        Delete a workflow tool.

        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_tool_id: the workflow tool id
        """

        self._queries.delete(tenant_id=tenant_id, provider_id=workflow_tool_id)

        return {"result": "success"}

    def get_workflow_tool_by_tool_id(self, user_id: str, tenant_id: str, workflow_tool_id: str):
        """
        Get a workflow tool.

        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_tool_id: the workflow tool id
        :return: the tool
        """

        tool_provider = self._queries.provider(tenant_id=tenant_id, provider_id=workflow_tool_id)

        return self._get_workflow_tool(tenant_id, tool_provider)

    def get_workflow_tool_by_app_id(self, user_id: str, tenant_id: str, workflow_app_id: str):
        """
        Get a workflow tool.

        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_app_id: the workflow app id
        :return: the tool
        """

        tool_provider = self._queries.provider_for_app(tenant_id=tenant_id, app_id=workflow_app_id)

        return self._get_workflow_tool(tenant_id, tool_provider)

    def _get_workflow_tool(self, tenant_id: str, db_tool: WorkflowToolProvider | None):
        """
        Get a workflow tool.

        :db_tool: the database tool
        :return: the tool
        """
        if db_tool is None:
            raise ValueError("Tool not found")

        workflow = self._queries.current_workflow(tenant_id=tenant_id, app_id=db_tool.app_id)

        tool = ToolTransformService.workflow_provider_to_controller(db_tool, queries=self._queries)
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
            "icon": emoji_icon_adapter.validate_json(db_tool.icon),
            "description": db_tool.description,
            "parameters": jsonable_encoder(db_tool.parameter_configurations),
            "output_schema": output_schema,
            "tool": ToolTransformService.convert_tool_entity_to_api_entity(
                tool=tool.get_tools(db_tool.tenant_id)[0],
                labels=self._queries.labels(tenant_id=tenant_id, provider_ids=[tool.provider_id]).get(
                    tool.provider_id, []
                ),
                tenant_id=tenant_id,
            ),
            "synced": workflow.version == db_tool.version,
            "privacy_policy": db_tool.privacy_policy,
        }

    def list_single_workflow_tools(self, user_id: str, tenant_id: str, workflow_tool_id: str) -> list[ToolApiEntity]:
        """
        List workflow tool provider tools.

        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_tool_id: the workflow tool id
        :return: the list of tools
        """

        provider = self._queries.provider(tenant_id=tenant_id, provider_id=workflow_tool_id)

        if provider is None:
            raise ValueError(f"Tool {workflow_tool_id} not found")

        tool = ToolTransformService.workflow_provider_to_controller(provider, queries=self._queries)
        workflow_tools: list[WorkflowTool] = tool.get_tools(tenant_id)
        if len(workflow_tools) == 0:
            raise ValueError(f"Tool {workflow_tool_id} not found")

        return [
            ToolTransformService.convert_tool_entity_to_api_entity(
                tool=tool.get_tools(provider.tenant_id)[0],
                labels=self._queries.labels(tenant_id=tenant_id, provider_ids=[tool.provider_id]).get(
                    tool.provider_id, []
                ),
                tenant_id=tenant_id,
            )
        ]
