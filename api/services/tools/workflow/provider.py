from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import override

from core.app.app_config.base_app_config_manager import BaseAppConfigManager
from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.plugin.entities.parameters import PluginParameterOption
from core.tools.__base.tool_provider import ToolProviderController
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolParameter,
    ToolProviderEntity,
    ToolProviderIdentity,
    ToolProviderType,
)
from core.tools.utils.workflow_configuration_sync import WorkflowToolConfigurationUtils
from graphon.variables.input_entities import VariableEntity, VariableEntityType
from models.account import Account
from models.model import App, AppMode
from models.tool_runtime_contracts import WorkflowToolDefinition, WorkflowToolQueries
from models.tools import WorkflowToolProvider
from models.workflow import Workflow
from services.tools.workflow.tool import WorkflowTool
from services.workflow.execution.ports import WorkflowRuntime

VARIABLE_TO_PARAMETER_TYPE_MAPPING = {
    VariableEntityType.TEXT_INPUT: ToolParameter.ToolParameterType.STRING,
    VariableEntityType.PARAGRAPH: ToolParameter.ToolParameterType.STRING,
    VariableEntityType.SELECT: ToolParameter.ToolParameterType.SELECT,
    VariableEntityType.NUMBER: ToolParameter.ToolParameterType.NUMBER,
    VariableEntityType.CHECKBOX: ToolParameter.ToolParameterType.BOOLEAN,
    VariableEntityType.FILE: ToolParameter.ToolParameterType.FILE,
    VariableEntityType.FILE_LIST: ToolParameter.ToolParameterType.FILES,
    VariableEntityType.JSON_OBJECT: ToolParameter.ToolParameterType.OBJECT,
}


class WorkflowToolProviderController(ToolProviderController[ToolProviderEntity, WorkflowTool | None]):
    provider_id: str
    tools: list[WorkflowTool] | None

    def __init__(
        self,
        entity: ToolProviderEntity,
        provider_id: str,
        *,
        queries: WorkflowToolQueries,
        draft_variable_saver: Callable[[str, Account], DraftVariableSaverFactory] | None,
        workflow_runtime: WorkflowRuntime | None = None,
    ):
        super().__init__(entity=entity)
        self.provider_id = provider_id
        self.tools = None
        self._queries = queries
        self._draft_variable_saver = draft_variable_saver
        self._workflow_runtime = workflow_runtime

    @classmethod
    def from_db(
        cls,
        db_provider: WorkflowToolProvider | WorkflowToolDefinition,
        *,
        queries: WorkflowToolQueries,
        draft_variable_saver: Callable[[str, Account], DraftVariableSaverFactory] | None,
        workflow_runtime: WorkflowRuntime | None = None,
    ) -> WorkflowToolProviderController:
        app = queries.app(tenant_id=db_provider.tenant_id, app_id=db_provider.app_id)
        workflow = queries.workflow(tenant_id=db_provider.tenant_id, app_id=app.id, version=db_provider.version)
        actor = (
            queries.actor(tenant_id=db_provider.tenant_id, user_id=db_provider.user_id) if db_provider.user_id else None
        )
        author = actor if isinstance(actor, Account) else None
        controller = cls(
            entity=ToolProviderEntity(
                identity=ToolProviderIdentity(
                    author=author.name if author else "",
                    name=db_provider.label,
                    label=I18nObject(en_US=db_provider.label, zh_Hans=db_provider.label),
                    description=I18nObject(en_US=db_provider.description, zh_Hans=db_provider.description),
                    icon=db_provider.icon,
                ),
                credentials_schema=[],
                plugin_id=None,
            ),
            provider_id=db_provider.id,
            draft_variable_saver=draft_variable_saver,
            workflow_runtime=workflow_runtime,
            queries=queries,
        )
        controller.tools = [controller._build_tool(db_provider, app, workflow=workflow, user=author)]
        return controller

    @property
    @override
    def provider_type(self) -> ToolProviderType:
        return ToolProviderType.WORKFLOW

    def _build_tool(
        self,
        db_provider: WorkflowToolProvider | WorkflowToolDefinition,
        app: App,
        *,
        workflow: Workflow,
        user: Account | None,
    ) -> WorkflowTool:
        # fetch start node
        graph: Mapping = workflow.graph_dict
        features_dict: Mapping = workflow.features_dict
        features = BaseAppConfigManager.convert_features(config_dict=features_dict, app_mode=AppMode.WORKFLOW)

        parameters = db_provider.parameter_configurations
        variables = WorkflowToolConfigurationUtils.get_workflow_graph_variables(graph)

        def fetch_workflow_variable(variable_name: str) -> VariableEntity | None:
            return next(filter(lambda x: x.variable == variable_name, variables), None)

        workflow_tool_parameters = []
        for parameter in parameters:
            variable = fetch_workflow_variable(parameter.name)
            if variable:
                parameter_type = None
                options = []
                if variable.type not in VARIABLE_TO_PARAMETER_TYPE_MAPPING:
                    raise ValueError(f"unsupported variable type {variable.type}")
                parameter_type = VARIABLE_TO_PARAMETER_TYPE_MAPPING[variable.type]

                if variable.type == VariableEntityType.SELECT and variable.options:
                    options = [
                        PluginParameterOption(value=option, label=I18nObject(en_US=option, zh_Hans=option))
                        for option in variable.options
                    ]

                workflow_tool_parameters.append(
                    ToolParameter(
                        name=parameter.name,
                        label=I18nObject(en_US=variable.label, zh_Hans=variable.label),
                        human_description=I18nObject(en_US=parameter.description, zh_Hans=parameter.description),
                        type=parameter_type,
                        form=parameter.form,
                        llm_description=parameter.description,
                        required=variable.required,
                        default=variable.default,
                        options=options,
                        placeholder=I18nObject(en_US="", zh_Hans=""),
                    )
                )
            elif features.file_upload:
                workflow_tool_parameters.append(
                    ToolParameter(
                        name=parameter.name,
                        label=I18nObject(en_US=parameter.name, zh_Hans=parameter.name),
                        human_description=I18nObject(en_US=parameter.description, zh_Hans=parameter.description),
                        type=ToolParameter.ToolParameterType.SYSTEM_FILES,
                        llm_description=parameter.description,
                        required=False,
                        form=parameter.form,
                        placeholder=I18nObject(en_US="", zh_Hans=""),
                    )
                )
            else:
                raise ValueError("variable not found")

        # get output schema from workflow
        outputs = WorkflowToolConfigurationUtils.get_workflow_graph_output(graph)

        reserved_keys = {"json", "text", "files"}

        properties = {}
        for output in outputs:
            if output.variable not in reserved_keys:
                properties[output.variable] = {
                    "type": output.value_type,
                    "description": "",
                }
        output_schema = {"type": "object", "properties": properties}

        return WorkflowTool(
            queries=self._queries,
            draft_variable_saver=self._draft_variable_saver,
            workflow_runtime=self._workflow_runtime,
            workflow_as_tool_id=db_provider.id,
            entity=ToolEntity(
                identity=ToolIdentity(
                    author=user.name if user else "",
                    name=db_provider.name,
                    label=I18nObject(en_US=db_provider.label, zh_Hans=db_provider.label),
                    provider=self.provider_id,
                    icon=db_provider.icon,
                ),
                description=ToolDescription(
                    human=I18nObject(en_US=db_provider.description, zh_Hans=db_provider.description),
                    llm=db_provider.description,
                ),
                parameters=workflow_tool_parameters,
                output_schema=output_schema,
            ),
            runtime=ToolRuntime(
                tenant_id=db_provider.tenant_id,
            ),
            workflow_app_id=app.id,
            workflow_entities={
                "app": app,
                "workflow": workflow,
            },
            version=db_provider.version,
            workflow_call_depth=0,
            label=db_provider.label,
        )

    def get_tools(self, tenant_id: str) -> list[WorkflowTool]:
        """
        fetch tools from database

        :param tenant_id: the tenant id
        :return: the tools
        """
        if self.tools is not None:
            return [tool for tool in self.tools if tool.runtime.tenant_id == tenant_id]

        provider = self._queries.provider(tenant_id=tenant_id, provider_id=self.provider_id)
        if provider is None:
            return []
        app = self._queries.app(tenant_id=tenant_id, app_id=provider.app_id)
        workflow = self._queries.workflow(tenant_id=tenant_id, app_id=provider.app_id, version=provider.version)
        actor = self._queries.actor(tenant_id=tenant_id, user_id=provider.user_id) if provider.user_id else None
        self.tools = [
            self._build_tool(provider, app, workflow=workflow, user=actor if isinstance(actor, Account) else None)
        ]

        return self.tools

    @override
    def get_tool(self, tool_name: str) -> WorkflowTool | None:
        """
        get tool by name

        :param tool_name: the name of the tool
        :return: the tool
        """
        if self.tools is None:
            return None

        for tool in self.tools:
            if tool.entity.identity.name == tool_name:
                return tool

        return None
