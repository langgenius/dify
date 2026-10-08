import logging
import mimetypes
from collections.abc import Callable, Generator, Mapping
from os import listdir, path
from threading import Lock
from typing import TYPE_CHECKING, Any, Literal, Protocol, cast

from typing_extensions import TypedDict
from yarl import URL

import contexts
import core.tools.builtin_tool.provider as builtin_provider_module
from configs import dify_config
from core.agent.entities import AgentToolEntity
from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.app.entities.app_invoke_entities import InvokeFrom
from core.helper.module_import_helper import load_single_subclass_from_source
from core.helper.position_helper import is_filtered
from core.plugin.impl.exc import PluginDaemonNotFoundError, PluginNotFoundError
from core.plugin.impl.tool import PluginToolManager
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.builtin_tool.providers._positions import BuiltinToolProviderSort
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.custom_tool.tool import ApiTool
from core.tools.entities.api_entities import ToolProviderApiEntity, ToolProviderTypeApiLiteral
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ApiProviderSchemaType,
    EmojiIconDict,
    ToolInvokeFrom,
    ToolParameter,
    ToolProviderType,
    emoji_icon_adapter,
)
from core.tools.errors import ToolProviderNotFoundError
from core.tools.mcp_tool.provider import MCPToolProviderController
from core.tools.mcp_tool.tool import MCPTool
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.plugin_tool.tool import PluginTool
from core.tools.utils.configuration import ToolParameterConfigurationManager
from core.tools.utils.encryption import create_tool_provider_encrypter
from graphon.runtime import VariablePool
from graphon.variables.template_resolution import convert_template
from models import Account
from models.provider_ids import ToolProviderID
from models.tool_runtime_contracts import WorkflowToolQueries
from services.files.signature import sign_upload_file_url
from services.tools.api.contracts import ApiToolProviderRecord
from services.tools.api.provider import ApiToolProviderController
from services.tools.builtin.credentials import resolve_builtin_credentials
from services.tools.provider_queries import ToolProviderIcons, ToolProviders
from services.tools.tools_transform_service import ToolTransformService
from services.tools.workflow.provider import WorkflowToolProviderController
from services.tools.workflow.tool import WorkflowTool
from services.workflow.execution.ports import WorkflowRuntime

if TYPE_CHECKING:
    pass


logger = logging.getLogger(__name__)


class ApiProviderControllerItem(TypedDict):
    provider: ApiToolProviderRecord
    controller: ApiToolProviderController


class WorkflowToolRuntimeSpec(Protocol):
    @property
    def provider_type(self) -> ToolProviderType: ...

    @property
    def provider_id(self) -> str: ...

    @property
    def tool_name(self) -> str: ...

    @property
    def tool_configurations(self) -> Mapping[str, Any]: ...

    @property
    def credential_id(self) -> str | None: ...


class ToolManager:
    _builtin_provider_lock = Lock()
    _hardcoded_providers: dict[str, BuiltinToolProviderController] = {}
    _builtin_providers_loaded = False
    _builtin_tools_labels: dict[str, I18nObject | None] = {}

    @classmethod
    def get_hardcoded_provider(cls, provider: str) -> BuiltinToolProviderController:
        """

        get the hardcoded provider

        """

        if len(cls._hardcoded_providers) == 0:
            # init the builtin providers
            cls.load_hardcoded_providers_cache()

        return cls._hardcoded_providers[provider]

    @classmethod
    def get_builtin_provider(
        cls, provider: str, tenant_id: str
    ) -> BuiltinToolProviderController | PluginToolProviderController:
        """
        get the builtin provider

        :param provider: the name of the provider
        :param tenant_id: the id of the tenant
        :return: the provider
        """
        # split provider to

        if len(cls._hardcoded_providers) == 0:
            # init the builtin providers
            cls.load_hardcoded_providers_cache()

        if provider not in cls._hardcoded_providers:
            # get plugin provider
            plugin_provider = cls.get_plugin_provider(provider, tenant_id)
            if plugin_provider:
                return plugin_provider

        return cls._hardcoded_providers[provider]

    @classmethod
    def get_plugin_provider(cls, provider: str, tenant_id: str) -> PluginToolProviderController:
        """
        get the plugin provider
        """
        # check if context is set

        try:
            contexts.plugin_tool_providers.get()
        except LookupError:
            contexts.plugin_tool_providers.set({})
            contexts.plugin_tool_providers_lock.set(Lock())

        plugin_tool_providers = contexts.plugin_tool_providers.get()
        if provider in plugin_tool_providers:
            return plugin_tool_providers[provider]

        with contexts.plugin_tool_providers_lock.get():
            # double check
            plugin_tool_providers = contexts.plugin_tool_providers.get()
            if provider in plugin_tool_providers:
                return plugin_tool_providers[provider]

            manager = PluginToolManager()
            try:
                provider_entity = manager.fetch_tool_provider(tenant_id, provider)
            except (PluginNotFoundError, PluginDaemonNotFoundError) as exc:
                # The plugin daemon rejected the provider name (probably an
                # unknown or non-builtin identifier). Translate to the
                # console's domain error so the API returns a 4xx instead
                # of leaking the daemon's ``PluginNotFoundError`` as a 500.
                raise ToolProviderNotFoundError(f"plugin provider {provider} not found") from exc
            if not provider_entity:
                raise ToolProviderNotFoundError(f"plugin provider {provider} not found")

            controller = PluginToolProviderController(
                entity=provider_entity.declaration,
                plugin_id=provider_entity.plugin_id,
                plugin_unique_identifier=provider_entity.plugin_unique_identifier,
                tenant_id=tenant_id,
            )

            plugin_tool_providers[provider] = controller
            return controller

    @classmethod
    def get_tool_runtime(
        cls,
        provider_type: ToolProviderType,
        provider_id: str,
        tool_name: str,
        tenant_id: str,
        user_id: str | None = None,
        invoke_from: InvokeFrom = InvokeFrom.DEBUGGER,
        tool_invoke_from: ToolInvokeFrom = ToolInvokeFrom.AGENT,
        credential_id: str | None = None,
        *,
        tool_providers: ToolProviders,
        workflow_queries: WorkflowToolQueries,
        draft_variable_saver: Callable[[str, Account], DraftVariableSaverFactory] | None = None,
        workflow_runtime: WorkflowRuntime | None = None,
    ) -> BuiltinTool | PluginTool | ApiTool | WorkflowTool | MCPTool:
        """
        get the tool runtime

        :param provider_type: the type of the provider
        :param provider_id: the id of the provider
        :param tool_name: the name of the tool
        :param tenant_id: the tenant id
        :param user_id: the caller id bound to runtime-scoped model/tool lookups
        :param invoke_from: invoke from
        :param tool_invoke_from: the tool invoke from
        :param credential_id: the credential id

        :return: the tool
        """
        match provider_type:
            case ToolProviderType.BUILT_IN:
                provider_controller = cls.get_builtin_provider(provider_id, tenant_id)

                builtin_tool = provider_controller.get_tool(tool_name)
                if not builtin_tool:
                    raise ToolProviderNotFoundError(f"builtin tool {tool_name} not found")

                if not provider_controller.need_credentials:
                    return builtin_tool.fork_tool_runtime(
                        runtime=ToolRuntime(
                            tenant_id=tenant_id,
                            user_id=user_id,
                            credentials={},
                            invoke_from=invoke_from,
                            tool_invoke_from=tool_invoke_from,
                        )
                    )
                credentials, credential_type = resolve_builtin_credentials(
                    providers=tool_providers,
                    controller=provider_controller,
                    tenant_id=tenant_id,
                    provider_id=provider_id,
                    credential_id=credential_id,
                )

                return builtin_tool.fork_tool_runtime(
                    runtime=ToolRuntime(
                        tenant_id=tenant_id,
                        user_id=user_id,
                        credentials=credentials,
                        credential_type=credential_type,
                        runtime_parameters={},
                        invoke_from=invoke_from,
                        tool_invoke_from=tool_invoke_from,
                    )
                )

            case ToolProviderType.API:
                api_provider, credentials = cls.get_api_provider_controller(
                    tenant_id, provider_id, tool_providers=tool_providers
                )
                encrypter, _ = create_tool_provider_encrypter(
                    tenant_id=tenant_id,
                    controller=api_provider,
                )
                return api_provider.get_tool(tool_name).fork_tool_runtime(
                    runtime=ToolRuntime(
                        tenant_id=tenant_id,
                        user_id=user_id,
                        credentials=dict(encrypter.decrypt(credentials)),
                        invoke_from=invoke_from,
                        tool_invoke_from=tool_invoke_from,
                    )
                )
            case ToolProviderType.WORKFLOW:
                workflow_provider = workflow_queries.provider(tenant_id=tenant_id, provider_id=provider_id)

                if workflow_provider is None:
                    raise ToolProviderNotFoundError(f"workflow provider {provider_id} not found")

                controller = ToolTransformService.workflow_provider_to_controller(
                    db_provider=workflow_provider,
                    queries=workflow_queries,
                    draft_variable_saver=draft_variable_saver,
                    workflow_runtime=workflow_runtime,
                )
                controller_tools: list[WorkflowTool] = controller.get_tools(tenant_id=workflow_provider.tenant_id)
                if controller_tools is None or len(controller_tools) == 0:
                    raise ToolProviderNotFoundError(f"workflow provider {provider_id} not found")

                return controller.get_tools(tenant_id=workflow_provider.tenant_id)[0].fork_tool_runtime(
                    runtime=ToolRuntime(
                        tenant_id=tenant_id,
                        user_id=user_id,
                        credentials={},
                        invoke_from=invoke_from,
                        tool_invoke_from=tool_invoke_from,
                    )
                )
            case ToolProviderType.APP:
                raise NotImplementedError("app provider not implemented")
            case ToolProviderType.PLUGIN:
                plugin_tool = cls.get_plugin_provider(provider_id, tenant_id).get_tool(tool_name)
                plugin_tool.runtime.user_id = user_id
                plugin_tool.runtime.invoke_from = invoke_from
                plugin_tool.runtime.tool_invoke_from = tool_invoke_from
                return plugin_tool
            case ToolProviderType.MCP:
                mcp_tool = cls.get_mcp_provider_controller(
                    tenant_id, provider_id, tool_providers=tool_providers
                ).get_tool(tool_name)
                mcp_tool.runtime.user_id = user_id
                mcp_tool.runtime.invoke_from = invoke_from
                mcp_tool.runtime.tool_invoke_from = tool_invoke_from
                return mcp_tool
            case ToolProviderType.DATASET_RETRIEVAL:
                raise ToolProviderNotFoundError(f"provider type {provider_type.value} not found")
            case _:
                raise ToolProviderNotFoundError(f"provider type {provider_type} not found")

    @classmethod
    def get_agent_tool_runtime(
        cls,
        tenant_id: str,
        app_id: str,
        agent_tool: AgentToolEntity,
        user_id: str | None = None,
        invoke_from: InvokeFrom = InvokeFrom.DEBUGGER,
        variable_pool: "VariablePool | None" = None,
        allow_file_parameters: bool = False,
        use_default_for_missing_form_parameters: bool = False,
        *,
        tool_providers: ToolProviders,
        workflow_queries: WorkflowToolQueries,
        draft_variable_saver: Callable[[str, Account], DraftVariableSaverFactory] | None = None,
        workflow_runtime: WorkflowRuntime | None = None,
    ) -> Tool:
        """
        get the agent tool runtime
        """
        tool_entity = cls.get_tool_runtime(
            provider_type=agent_tool.provider_type,
            provider_id=agent_tool.provider_id,
            tool_name=agent_tool.tool_name,
            tenant_id=tenant_id,
            user_id=user_id,
            invoke_from=invoke_from,
            tool_invoke_from=ToolInvokeFrom.AGENT,
            credential_id=agent_tool.credential_id,
            draft_variable_saver=draft_variable_saver,
            workflow_runtime=workflow_runtime,
            tool_providers=tool_providers,
            workflow_queries=workflow_queries,
        )
        runtime_parameters: dict[str, Any] = {}
        parameters = tool_entity.get_merged_runtime_parameters()
        runtime_parameters = cls._convert_tool_parameters_type(
            parameters,
            variable_pool,
            agent_tool.tool_parameters,
            typ="agent",
            allow_file_parameters=allow_file_parameters,
            use_default_for_missing_form_parameters=use_default_for_missing_form_parameters,
        )
        # decrypt runtime parameters
        encryption_manager = ToolParameterConfigurationManager(
            tenant_id=tenant_id,
            tool_runtime=tool_entity,
            provider_name=agent_tool.provider_id,
            provider_type=agent_tool.provider_type,
            identity_id=f"AGENT.{app_id}",
        )
        runtime_parameters = encryption_manager.decrypt_tool_parameters(runtime_parameters)
        if tool_entity.runtime is None or tool_entity.runtime.runtime_parameters is None:
            raise ValueError("runtime not found or runtime parameters not found")

        tool_entity.runtime.runtime_parameters.update(runtime_parameters)
        return tool_entity

    @classmethod
    def get_workflow_tool_runtime(
        cls,
        tenant_id: str,
        app_id: str,
        node_id: str,
        workflow_tool: WorkflowToolRuntimeSpec,
        user_id: str | None = None,
        invoke_from: InvokeFrom = InvokeFrom.DEBUGGER,
        variable_pool: "VariablePool | None" = None,
        *,
        tool_providers: ToolProviders,
        workflow_queries: WorkflowToolQueries,
        draft_variable_saver: Callable[[str, Account], DraftVariableSaverFactory] | None = None,
        workflow_runtime: WorkflowRuntime | None = None,
    ) -> Tool:
        """
        get the workflow tool runtime
        """

        tool_runtime = cls.get_tool_runtime(
            provider_type=workflow_tool.provider_type,
            provider_id=workflow_tool.provider_id,
            tool_name=workflow_tool.tool_name,
            tenant_id=tenant_id,
            user_id=user_id,
            invoke_from=invoke_from,
            tool_invoke_from=ToolInvokeFrom.WORKFLOW,
            credential_id=workflow_tool.credential_id,
            draft_variable_saver=draft_variable_saver,
            workflow_runtime=workflow_runtime,
            tool_providers=tool_providers,
            workflow_queries=workflow_queries,
        )

        parameters = tool_runtime.get_merged_runtime_parameters()
        runtime_parameters = cls._convert_tool_parameters_type(
            parameters, variable_pool, workflow_tool.tool_configurations, typ="workflow"
        )
        # decrypt runtime parameters
        encryption_manager = ToolParameterConfigurationManager(
            tenant_id=tenant_id,
            tool_runtime=tool_runtime,
            provider_name=workflow_tool.provider_id,
            provider_type=workflow_tool.provider_type,
            identity_id=f"WORKFLOW.{app_id}.{node_id}",
        )

        if runtime_parameters:
            runtime_parameters = encryption_manager.decrypt_tool_parameters(runtime_parameters)

        tool_runtime.runtime.runtime_parameters.update(runtime_parameters)
        return tool_runtime

    @classmethod
    def get_tool_runtime_from_plugin(
        cls,
        tool_type: ToolProviderType,
        tenant_id: str,
        provider: str,
        tool_name: str,
        tool_parameters: dict[str, Any],
        user_id: str | None = None,
        credential_id: str | None = None,
        *,
        workflow_runtime: WorkflowRuntime,
        draft_variable_saver: Callable[[str, Account], DraftVariableSaverFactory],
    ) -> Tool:
        """
        get tool runtime from plugin
        """
        tool_entity = cls.get_tool_runtime(
            provider_type=tool_type,
            provider_id=provider,
            tool_name=tool_name,
            tenant_id=tenant_id,
            user_id=user_id,
            invoke_from=InvokeFrom.SERVICE_API,
            tool_invoke_from=ToolInvokeFrom.PLUGIN,
            credential_id=credential_id,
            workflow_runtime=workflow_runtime,
            tool_providers=workflow_runtime.tool_providers,
            workflow_queries=workflow_runtime.tools,
            draft_variable_saver=draft_variable_saver,
        )
        runtime_parameters: dict[str, Any] = {}
        parameters = tool_entity.get_merged_runtime_parameters()
        for parameter in parameters:
            if parameter.form == ToolParameter.ToolParameterForm.FORM:
                # save tool parameter to tool entity memory
                value = parameter.init_frontend_parameter(tool_parameters.get(parameter.name))
                runtime_parameters[parameter.name] = value

        tool_entity.runtime.runtime_parameters.update(runtime_parameters)
        return tool_entity

    @classmethod
    def get_hardcoded_provider_icon(cls, provider: str) -> tuple[str, str]:
        """
        get the absolute path of the icon of the hardcoded provider

        :param provider: the name of the provider
        :return: the absolute path of the icon, the mime type of the icon
        """
        # get provider
        provider_controller = cls.get_hardcoded_provider(provider)

        absolute_path = path.join(
            path.dirname(path.dirname(path.realpath(builtin_provider_module.__file__))),
            "builtin_tool",
            "providers",
            provider,
            "_assets",
            provider_controller.entity.identity.icon,
        )
        # check if the icon exists
        if not path.exists(absolute_path):
            raise ToolProviderNotFoundError(f"builtin provider {provider} icon not found")

        # get the mime type
        mime_type, _ = mimetypes.guess_type(absolute_path)
        mime_type = mime_type or "application/octet-stream"

        return absolute_path, mime_type

    @classmethod
    def list_hardcoded_providers(cls):
        # use cache first
        if cls._builtin_providers_loaded:
            yield from list(cls._hardcoded_providers.values())
            return

        with cls._builtin_provider_lock:
            if cls._builtin_providers_loaded:
                yield from list(cls._hardcoded_providers.values())
                return

            yield from cls._list_hardcoded_providers()

    @classmethod
    def list_plugin_providers(cls, tenant_id: str) -> list[PluginToolProviderController]:
        """
        list all the plugin providers
        """

        manager = PluginToolManager()
        provider_entities = manager.fetch_tool_providers(tenant_id)
        return [
            PluginToolProviderController(
                entity=provider.declaration,
                plugin_id=provider.plugin_id,
                plugin_unique_identifier=provider.plugin_unique_identifier,
                tenant_id=tenant_id,
            )
            for provider in provider_entities
        ]

    @classmethod
    def list_builtin_providers(
        cls, tenant_id: str
    ) -> Generator[BuiltinToolProviderController | PluginToolProviderController, None, None]:
        """
        list all the builtin providers
        """
        yield from cls.list_hardcoded_providers()
        # get plugin providers
        yield from cls.list_plugin_providers(tenant_id)

    @classmethod
    def _list_hardcoded_providers(cls) -> Generator[BuiltinToolProviderController, None, None]:
        """
        list all the builtin providers
        """
        for provider_path in listdir(
            path.join(
                path.dirname(path.dirname(path.realpath(builtin_provider_module.__file__))), "builtin_tool", "providers"
            )
        ):
            if provider_path.startswith("__"):
                continue

            if path.isdir(
                path.join(
                    path.dirname(path.dirname(path.realpath(builtin_provider_module.__file__))),
                    "builtin_tool",
                    "providers",
                    provider_path,
                )
            ):
                if provider_path.startswith("__"):
                    continue

                # init provider
                try:
                    provider_class = load_single_subclass_from_source(
                        module_name=f"core.tools.builtin_tool.providers.{provider_path}.{provider_path}",
                        script_path=path.join(
                            path.dirname(path.dirname(path.realpath(builtin_provider_module.__file__))),
                            "builtin_tool",
                            "providers",
                            provider_path,
                            f"{provider_path}.py",
                        ),
                        parent_type=BuiltinToolProviderController,
                    )
                    provider: BuiltinToolProviderController = provider_class()
                    cls._hardcoded_providers[provider.entity.identity.name] = provider
                    for tool in provider.get_tools():
                        cls._builtin_tools_labels[tool.entity.identity.name] = tool.entity.identity.label
                    yield provider

                except Exception:
                    logger.exception("load builtin provider %s", provider_path)
                    continue
        # set builtin providers loaded
        cls._builtin_providers_loaded = True

    @classmethod
    def load_hardcoded_providers_cache(cls):
        for _ in cls.list_hardcoded_providers():
            pass

    @classmethod
    def clear_hardcoded_providers_cache(cls):
        cls._hardcoded_providers = {}
        cls._builtin_providers_loaded = False

    @classmethod
    def get_tool_label(cls, tool_name: str) -> I18nObject | None:
        """
        get the tool label

        :param tool_name: the name of the tool

        :return: the label of the tool
        """
        if len(cls._builtin_tools_labels) == 0:
            # init the builtin providers
            cls.load_hardcoded_providers_cache()

        if tool_name not in cls._builtin_tools_labels:
            return None

        return cls._builtin_tools_labels[tool_name]

    @classmethod
    def list_providers_from_api(
        cls,
        user_id: str,
        tenant_id: str,
        typ: ToolProviderTypeApiLiteral | None,
        *,
        workflow_queries: WorkflowToolQueries,
        tool_providers: ToolProviders,
    ) -> list[ToolProviderApiEntity]:
        result_providers: dict[str, ToolProviderApiEntity] = {}

        filters = []
        if not typ:
            filters.extend(["builtin", "api", "workflow", "mcp"])
        else:
            filters.append(typ)

        if "builtin" in filters:
            builtin_providers = list(cls.list_builtin_providers(tenant_id))

            # key: provider name, value: provider
            db_builtin_providers = {
                str(ToolProviderID(provider.provider)): provider
                for provider in tool_providers.default_builtin(tenant_id=tenant_id)
            }

            # append builtin providers
            for provider in builtin_providers:
                # handle include, exclude
                if is_filtered(
                    include_set=dify_config.POSITION_TOOL_INCLUDES_SET,
                    exclude_set=dify_config.POSITION_TOOL_EXCLUDES_SET,
                    data=provider,
                    name_func=lambda x: x.entity.identity.name,
                ):
                    continue
                user_provider = ToolTransformService.builtin_provider_to_user_provider(
                    provider_controller=provider,
                    db_provider=db_builtin_providers.get(provider.entity.identity.name),
                    decrypt_credentials=False,
                )

                if isinstance(provider, PluginToolProviderController):
                    result_providers[f"plugin_provider.{user_provider.name}"] = user_provider
                else:
                    result_providers[f"builtin_provider.{user_provider.name}"] = user_provider

        # get db api providers
        if "api" in filters:
            db_tool_providers = tool_providers.api_providers(tenant_id=tenant_id)

            # Batch create controllers
            api_provider_controllers: list[ApiProviderControllerItem] = []
            for api_provider in db_tool_providers:
                try:
                    controller = ToolTransformService.api_provider_to_controller(api_provider)
                    api_provider_controllers.append({"provider": api_provider, "controller": controller})
                except Exception:
                    # Skip invalid providers but continue processing others
                    logger.warning("Failed to create controller for API provider %s", api_provider.id)

            # Batch get labels for all API providers
            if api_provider_controllers:
                labels = tool_providers.api_labels(
                    tenant_id=tenant_id, provider_ids=[item["provider"].id for item in api_provider_controllers]
                )

                for item in api_provider_controllers:
                    provider_controller = item["controller"]
                    db_provider = item["provider"]
                    provider_labels = labels.get(provider_controller.provider_id, [])
                    user_provider = ToolTransformService.api_provider_to_user_provider(
                        provider_controller=provider_controller,
                        db_provider=db_provider,
                        decrypt_credentials=False,
                        labels=provider_labels,
                    )
                    result_providers[f"api_provider.{user_provider.name}"] = user_provider

        if "workflow" in filters:
            # get workflow providers
            workflow_providers = workflow_queries.providers(tenant_id=tenant_id)

            workflow_provider_controllers: list[WorkflowToolProviderController] = []
            for workflow_provider in workflow_providers:
                try:
                    workflow_controller: WorkflowToolProviderController = (
                        ToolTransformService.workflow_provider_to_controller(
                            db_provider=workflow_provider, queries=workflow_queries
                        )
                    )
                    workflow_provider_controllers.append(workflow_controller)
                except Exception:
                    # app has been deleted
                    logger.exception("Failed to transform workflow provider %s to controller", workflow_provider.id)
                    continue
            # Batch get labels for workflow providers
            if workflow_provider_controllers:
                labels = workflow_queries.labels(
                    tenant_id=tenant_id, provider_ids=[c.provider_id for c in workflow_provider_controllers]
                )

                for workflow_provider_controller in workflow_provider_controllers:
                    provider_labels = labels.get(workflow_provider_controller.provider_id, [])
                    user_provider = ToolTransformService.workflow_provider_to_user_provider(
                        provider_controller=workflow_provider_controller,
                        labels=provider_labels,
                    )
                    result_providers[f"workflow_provider.{user_provider.name}"] = user_provider

        if "mcp" in filters:
            for record in tool_providers.mcp_providers(tenant_id=tenant_id):
                mcp_provider = ToolTransformService.mcp_provider_to_user_provider(record)
                result_providers[f"mcp_provider.{mcp_provider.name}"] = mcp_provider

        return BuiltinToolProviderSort.sort(list(result_providers.values()))

    @classmethod
    def get_api_provider_controller(
        cls, tenant_id: str, provider_id: str, *, tool_providers: ToolProviders
    ) -> tuple[ApiToolProviderController, dict[str, Any]]:
        """
        get the api provider

        :param tenant_id: the id of the tenant
        :param provider_id: the id of the provider

        :return: the provider controller, the credentials
        """
        provider = tool_providers.get(tenant_id=tenant_id, provider_id=provider_id)

        if provider is None:
            raise ToolProviderNotFoundError(f"api provider {provider_id} not found")

        controller = ToolTransformService.api_provider_to_controller(provider)

        return controller, provider.credentials

    @classmethod
    def get_mcp_provider_controller(
        cls, tenant_id: str, provider_id: str, *, tool_providers: ToolProviders
    ) -> MCPToolProviderController:
        """
        get the api provider

        :param tenant_id: the id of the tenant
        :param provider_id: the persisted reference of the provider, normally its
            server identifier, or the primary key for graphs written before that
            convention

        :return: the provider controller, the credentials
        """
        provider = tool_providers.mcp(tenant_id=tenant_id, provider_id=provider_id)
        if provider is None:
            raise ToolProviderNotFoundError(f"mcp provider {provider_id} not found")

        controller = MCPToolProviderController.from_db(provider)

        return controller

    @classmethod
    def user_get_api_provider(cls, provider: str, tenant_id: str, mask: bool = True, *, tool_providers: ToolProviders):
        """
        get api provider
        """
        provider_obj = tool_providers.api_by_name(tenant_id=tenant_id, name=provider)
        if provider_obj is None:
            raise ToolProviderNotFoundError(f"you have not added provider {provider}")
        credentials = provider_obj.credentials
        controller = ToolTransformService.api_provider_to_controller(provider_obj)
        # init tool configuration
        encrypter, _ = create_tool_provider_encrypter(
            tenant_id=tenant_id,
            controller=controller,
        )
        if mask:
            masked_credentials = encrypter.mask_plugin_credentials(encrypter.decrypt(credentials))
        else:
            masked_credentials = encrypter.decrypt(credentials)

        try:
            icon = emoji_icon_adapter.validate_json(provider_obj.icon)
        except Exception:
            icon = {"background": "#252525", "content": "\ud83d\ude01"}

        # add tool labels
        labels = tool_providers.api_labels(tenant_id=tenant_id, provider_ids=[provider_obj.id]).get(provider_obj.id, [])
        schema_type = provider_obj.schema_type
        schema_type_value = schema_type.value if isinstance(schema_type, ApiProviderSchemaType) else schema_type

        return {
            "schema_type": schema_type_value,
            "schema": provider_obj.schema,
            "tools": [tool.model_dump(mode="json") for tool in provider_obj.tools],
            "icon": icon,
            "description": provider_obj.description,
            "credentials": masked_credentials,
            "privacy_policy": provider_obj.privacy_policy,
            "custom_disclaimer": provider_obj.custom_disclaimer,
            "labels": labels,
        }

    @classmethod
    def generate_builtin_tool_icon_url(cls, provider_id: str) -> str:
        return str(
            URL(dify_config.CONSOLE_API_URL or "/")
            / "console"
            / "api"
            / "workspaces"
            / "current"
            / "tool-provider"
            / "builtin"
            / provider_id
            / "icon"
        )

    @classmethod
    def generate_plugin_tool_icon_url(cls, tenant_id: str, filename: str) -> str:
        return str(
            URL(dify_config.CONSOLE_API_URL or "/")
            / "console"
            / "api"
            / "workspaces"
            / "current"
            / "plugin"
            / "icon"
            % {"tenant_id": tenant_id, "filename": filename}
        )

    @classmethod
    def get_tool_icon(
        cls,
        tenant_id: str,
        provider_type: ToolProviderType,
        provider_id: str,
        *,
        tool_providers: ToolProviderIcons,
    ) -> str | EmojiIconDict:
        """
        get the tool icon

        :param tenant_id: the id of the tenant
        :param provider_type: the type of the provider
        :param provider_id: the id of the provider
        :return:
        """
        match provider_type:
            case ToolProviderType.BUILT_IN:
                provider = ToolManager.get_builtin_provider(provider_id, tenant_id)
                if isinstance(provider, PluginToolProviderController):
                    try:
                        return cls.generate_plugin_tool_icon_url(tenant_id, provider.entity.identity.icon)
                    except Exception:
                        return {"background": "#252525", "content": "\ud83d\ude01"}
                return cls.generate_builtin_tool_icon_url(provider_id)
            case ToolProviderType.PLUGIN:
                provider = ToolManager.get_plugin_provider(provider_id, tenant_id)
                try:
                    return cls.generate_plugin_tool_icon_url(tenant_id, provider.entity.identity.icon)
                except Exception:
                    return {"background": "#252525", "content": "\ud83d\ude01"}
            case ToolProviderType.API | ToolProviderType.WORKFLOW | ToolProviderType.MCP:
                try:
                    icon = tool_providers.icon(
                        tenant_id=tenant_id, provider_type=provider_type, provider_id=provider_id
                    )
                    if icon is not None:
                        try:
                            return emoji_icon_adapter.validate_json(icon)
                        except ValueError:
                            if provider_type == ToolProviderType.MCP:
                                return sign_upload_file_url(upload_file_id=icon)
                except Exception:
                    logger.warning("Failed to load tool icon for %s", provider_id, exc_info=True)
                return {"background": "#252525", "content": "😁"}
            case ToolProviderType.APP | ToolProviderType.DATASET_RETRIEVAL:
                raise ValueError(f"provider type {provider_type} not found")
            case _:
                raise ValueError(f"provider type {provider_type} not found")

    @classmethod
    def _convert_tool_parameters_type(
        cls,
        parameters: list[ToolParameter],
        variable_pool: "VariablePool | None",
        tool_configurations: Mapping[str, Any],
        typ: Literal["agent", "workflow", "tool"] = "workflow",
        allow_file_parameters: bool = False,
        use_default_for_missing_form_parameters: bool = False,
    ) -> dict[str, Any]:
        """
        Convert tool parameters type
        """
        from graphon.nodes.tool.entities import ToolNodeData
        from graphon.nodes.tool.exc import ToolParameterError

        runtime_parameters: dict[str, Any] = {}
        for parameter in parameters:
            if (
                parameter.type
                in {
                    ToolParameter.ToolParameterType.SYSTEM_FILES,
                    ToolParameter.ToolParameterType.FILE,
                    ToolParameter.ToolParameterType.FILES,
                }
                and parameter.required
                and typ == "agent"
                and not allow_file_parameters
            ):
                raise ValueError(f"file type parameter {parameter.name} not supported in agent")
            # save tool parameter to tool entity memory
            if parameter.form == ToolParameter.ToolParameterForm.FORM:
                if variable_pool:
                    config = tool_configurations.get(parameter.name, {})

                    selector_value = cls._extract_runtime_selector_value(parameter, config)
                    if selector_value is not None:
                        # Selector parameters carry structured dictionaries, not scalar ToolInput values.
                        runtime_parameters[parameter.name] = selector_value
                        continue

                    if not (config and isinstance(config, dict) and config.get("value") is not None):
                        continue
                    tool_input = ToolNodeData.ToolInput.model_validate(tool_configurations.get(parameter.name, {}))
                    if tool_input.type == "variable":
                        variable_selector = tool_input.value
                        if not isinstance(variable_selector, list) or not all(
                            isinstance(selector_part, str) for selector_part in variable_selector
                        ):
                            raise ToolParameterError("Variable tool input must be a variable selector")
                        variable = variable_pool.get(variable_selector)
                        if variable is None:
                            raise ToolParameterError(f"Variable {tool_input.value} does not exist")
                        parameter_value = variable.value
                    elif tool_input.type == "constant":
                        parameter_value = tool_input.value
                    elif tool_input.type == "mixed":
                        segment_group = convert_template(variable_pool, str(tool_input.value))
                        parameter_value = segment_group.text
                    else:
                        raise ToolParameterError(f"Unknown tool input type '{tool_input.type}'")
                    runtime_parameters[parameter.name] = parameter_value

                else:
                    parameter_value = tool_configurations.get(parameter.name)
                    if use_default_for_missing_form_parameters and parameter_value is None:
                        if parameter.default is not None:
                            parameter_value = parameter.default
                        elif (
                            parameter.required
                            and parameter.type == ToolParameter.ToolParameterType.SELECT
                            and parameter.options
                        ):
                            parameter_value = parameter.options[0].value
                        else:
                            continue
                    value = parameter.init_frontend_parameter(parameter_value)
                    runtime_parameters[parameter.name] = value
        return runtime_parameters

    @classmethod
    def _extract_runtime_selector_value(cls, parameter: ToolParameter, config: Any) -> dict[str, Any] | None:
        if parameter.type not in {
            ToolParameter.ToolParameterType.MODEL_SELECTOR,
            ToolParameter.ToolParameterType.APP_SELECTOR,
        }:
            return None
        if not isinstance(config, dict):
            return None

        input_value = config.get("value")
        if isinstance(input_value, dict) and cls._is_selector_value(parameter, input_value):
            return cast("dict[str, Any]", parameter.init_frontend_parameter(input_value))

        if cls._is_selector_value(parameter, config):
            selector_value = dict(config)
            selector_value.pop("type", None)
            selector_value.pop("value", None)
            return cast("dict[str, Any]", parameter.init_frontend_parameter(selector_value))

        return None

    @classmethod
    def _is_selector_value(cls, parameter: ToolParameter, value: Mapping[str, Any]) -> bool:
        if parameter.type == ToolParameter.ToolParameterType.MODEL_SELECTOR:
            return (
                isinstance(value.get("provider"), str)
                and isinstance(value.get("model"), str)
                and isinstance(value.get("model_type"), str)
            )
        if parameter.type == ToolParameter.ToolParameterType.APP_SELECTOR:
            return isinstance(value.get("app_id"), str)
        return False


ToolManager.load_hardcoded_providers_cache()
