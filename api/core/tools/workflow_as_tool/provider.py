from collections.abc import Mapping
from typing import Optional

from pydantic import Field

from core.app.app_config.entities import VariableEntity, VariableEntityType
from core.app.apps.workflow.app_config_manager import WorkflowAppConfigManager
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
from core.tools.workflow_as_tool.tool import WorkflowTool
from extensions.ext_database import db
from models.model import App, AppMode
from models.tools import WorkflowToolProvider
from models.workflow import Workflow

VARIABLE_TO_PARAMETER_TYPE_MAPPING = {
    VariableEntityType.TEXT_INPUT: ToolParameter.ToolParameterType.STRING,
    VariableEntityType.PARAGRAPH: ToolParameter.ToolParameterType.STRING,
    VariableEntityType.SELECT: ToolParameter.ToolParameterType.SELECT,
    VariableEntityType.NUMBER: ToolParameter.ToolParameterType.NUMBER,
    VariableEntityType.FILE: ToolParameter.ToolParameterType.FILE,
    VariableEntityType.FILE_LIST: ToolParameter.ToolParameterType.FILES,
}


class WorkflowToolProviderController(ToolProviderController):
    provider_id: str
    tools: list[WorkflowTool] = Field(default_factory=list)

    def __init__(self, entity: ToolProviderEntity, provider_id: str):
        super().__init__(entity=entity)
        self.provider_id = provider_id

    @classmethod
    def from_db(cls, db_provider: WorkflowToolProvider) -> "WorkflowToolProviderController":
        app = db_provider.app

        if not app:
            raise ValueError("app not found")

        controller = WorkflowToolProviderController(
            entity=ToolProviderEntity(
                identity=ToolProviderIdentity(
                    author=db_provider.user.name if db_provider.user_id and db_provider.user else "",
                    name=db_provider.label,
                    label=I18nObject(en_US=db_provider.label, zh_Hans=db_provider.label),
                    description=I18nObject(en_US=db_provider.description, zh_Hans=db_provider.description),
                    icon=db_provider.icon,
                ),
                credentials_schema=[],
                plugin_id=None,
            ),
            provider_id=db_provider.id or "",
        )

        # init tools

        controller.tools = [controller._get_db_provider_tool(db_provider, app)]

        return controller

    @property
    def provider_type(self) -> ToolProviderType:
        return ToolProviderType.WORKFLOW

    def _get_db_provider_tool(self, db_provider: WorkflowToolProvider, app: App) -> WorkflowTool:
        """
        get db provider tool
        :param db_provider: the db provider
        :param app: the app
        :return: the tool
        """
        workflow: Workflow | None = (
            db.session.query(Workflow)
            .filter(Workflow.app_id == db_provider.app_id, Workflow.version == db_provider.version)
            .first()
        )

        if not workflow:
            raise ValueError("workflow not found")

        # fetch start node
        graph: Mapping = workflow.graph_dict
        features_dict: Mapping = workflow.features_dict
        features = WorkflowAppConfigManager.convert_features(config_dict=features_dict, app_mode=AppMode.WORKFLOW)

        parameters = db_provider.parameter_configurations
        variables = WorkflowToolConfigurationUtils.get_workflow_graph_variables(graph)

        def fetch_workflow_variable(variable_name: str) -> VariableEntity | None:
            return next(filter(lambda x: x.variable == variable_name, variables), None)  # type: ignore

        user = db_provider.user

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

        return WorkflowTool(
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
            return self.tools

        db_providers: WorkflowToolProvider | None = (
            db.session.query(WorkflowToolProvider)
            .filter(
                WorkflowToolProvider.tenant_id == tenant_id,
                WorkflowToolProvider.app_id == self.provider_id,
            )
            .first()
        )

        if not db_providers:
            return []
        if not db_providers.app:
            raise ValueError("app not found")

        app = db_providers.app
        if not app:
            raise ValueError("can not read app of workflow")

        self.tools = [self._get_db_provider_tool(db_providers, app)]

        return self.tools

    def get_tool(self, tool_name: str) -> Optional[WorkflowTool]:  # type: ignore
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
