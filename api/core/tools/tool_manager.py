import json
import logging
import mimetypes
from collections.abc import Generator
from os import listdir, path
from threading import Lock
from typing import TYPE_CHECKING, Any, Literal, Optional, Union, cast

from yarl import URL

import contexts
from core.helper.provider_cache import ToolProviderCredentialsCache
from core.plugin.entities.plugin import ToolProviderID
from core.plugin.impl.tool import PluginToolManager
from core.tools.__base.tool_provider import ToolProviderController
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.mcp_tool.provider import MCPToolProviderController
from core.tools.mcp_tool.tool import MCPTool
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.plugin_tool.tool import PluginTool
from core.tools.utils.uuid_utils import is_valid_uuid
from core.tools.workflow_as_tool.provider import WorkflowToolProviderController
from core.workflow.entities.variable_pool import VariablePool
from services.tools.mcp_tools_mange_service import MCPToolManageService

if TYPE_CHECKING:
    from core.workflow.nodes.tool.entities import ToolEntity

from configs import dify_config
from core.agent.entities import AgentToolEntity
from core.app.entities.app_invoke_entities import InvokeFrom
from core.helper.module_import_helper import load_single_subclass_from_source
from core.helper.position_helper import is_filtered
from core.model_runtime.utils.encoders import jsonable_encoder
from core.tools.__base.tool import Tool
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.builtin_tool.providers._positions import BuiltinToolProviderSort
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.custom_tool.provider import ApiToolProviderController
from core.tools.custom_tool.tool import ApiTool
from core.tools.entities.api_entities import ToolProviderApiEntity, ToolProviderTypeApiLiteral
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ApiProviderAuthType,
    CredentialType,
    ToolInvokeFrom,
    ToolParameter,
    ToolProviderType,
)
from core.tools.errors import ToolProviderNotFoundError
from core.tools.tool_label_manager import ToolLabelManager
from core.tools.utils.configuration import (
    ToolParameterConfigurationManager,
)
from core.tools.utils.encryption import create_provider_encrypter, create_tool_provider_encrypter
from core.tools.workflow_as_tool.tool import WorkflowTool
from extensions.ext_database import db
from models.tools import ApiToolProvider, BuiltinToolProvider, MCPToolProvider, WorkflowToolProvider
from services.tools.tools_transform_service import ToolTransformService

logger = logging.getLogger(__name__)


class ToolManager:
    _builtin_provider_lock = Lock()
    _hardcoded_providers: dict[str, BuiltinToolProviderController] = {}
    _builtin_providers_loaded = False
    _builtin_tools_labels: dict[str, Union[I18nObject, None]] = {}

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
            provider_entity = manager.fetch_tool_provider(tenant_id, provider)
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
        invoke_from: InvokeFrom = InvokeFrom.DEBUGGER,
        tool_invoke_from: ToolInvokeFrom = ToolInvokeFrom.AGENT,
        credential_id: Optional[str] = None,
    ) -> Union[BuiltinTool, PluginTool, ApiTool, WorkflowTool, MCPTool]:
        """
        get the tool runtime

        :param provider_type: the type of the provider
        :param provider_id: the id of the provider
        :param tool_name: the name of the tool
        :param tenant_id: the tenant id
        :param invoke_from: invoke from
        :param tool_invoke_from: the tool invoke from
        :param credential_id: the credential id

        :return: the tool
        """
        if provider_type == ToolProviderType.BUILT_IN:
            # check if the builtin tool need credentials
            provider_controller = cls.get_builtin_provider(provider_id, tenant_id)

            builtin_tool = provider_controller.get_tool(tool_name)
            if not builtin_tool:
                raise ToolProviderNotFoundError(f"builtin tool {tool_name} not found")

            if not provider_controller.need_credentials:
                return cast(
                    BuiltinTool,
                    builtin_tool.fork_tool_runtime(
                        runtime=ToolRuntime(
                            tenant_id=tenant_id,
                            credentials={},
                            invoke_from=invoke_from,
                            tool_invoke_from=tool_invoke_from,
                        )
                    ),
                )
            builtin_provider = None
            if isinstance(provider_controller, PluginToolProviderController):
                provider_id_entity = ToolProviderID(provider_id)
                # get specific credentials
                if is_valid_uuid(credential_id):
                    try:
                        builtin_provider = (
                            db.session.query(BuiltinToolProvider)
                            .filter(
                                BuiltinToolProvider.tenant_id == tenant_id,
                                BuiltinToolProvider.id == credential_id,
                            )
                            .first()
                        )
                    except Exception as e:
                        builtin_provider = None
                        logger.info(f"Error getting builtin provider {credential_id}:{e}", exc_info=True)
                    # if the provider has been deleted, raise an error
                    if builtin_provider is None:
                        raise ToolProviderNotFoundError(f"provider has been deleted: {credential_id}")

                # fallback to the default provider
                if builtin_provider is None:
                    # use the default provider
                    builtin_provider = (
                        db.session.query(BuiltinToolProvider)
                        .filter(
                            BuiltinToolProvider.tenant_id == tenant_id,
                            (BuiltinToolProvider.provider == str(provider_id_entity))
                            | (BuiltinToolProvider.provider == provider_id_entity.provider_name),
                        )
                        .order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
                        .first()
                    )
                    if builtin_provider is None:
                        raise ToolProviderNotFoundError(f"no default provider for {provider_id}")
            else:
                builtin_provider = (
                    db.session.query(BuiltinToolProvider)
                    .filter(BuiltinToolProvider.tenant_id == tenant_id, (BuiltinToolProvider.provider == provider_id))
                    .order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
                    .first()
                )

                if builtin_provider is None:
                    raise ToolProviderNotFoundError(f"builtin provider {provider_id} not found")

            encrypter, _ = create_provider_encrypter(
                tenant_id=tenant_id,
                config=[
                    x.to_basic_provider_config()
                    for x in provider_controller.get_credentials_schema_by_type(builtin_provider.credential_type)
                ],
                cache=ToolProviderCredentialsCache(
                    tenant_id=tenant_id, provider=provider_id, credential_id=builtin_provider.id
                ),
            )
            return cast(
                BuiltinTool,
                builtin_tool.fork_tool_runtime(
                    runtime=ToolRuntime(
                        tenant_id=tenant_id,
                        credentials=encrypter.decrypt(builtin_provider.credentials),
                        credential_type=CredentialType.of(builtin_provider.credential_type),
                        runtime_parameters={},
                        invoke_from=invoke_from,
                        tool_invoke_from=tool_invoke_from,
                    )
                ),
            )

        elif provider_type == ToolProviderType.API:
            api_provider, credentials = cls.get_api_provider_controller(tenant_id, provider_id)
            encrypter, _ = create_tool_provider_encrypter(
                tenant_id=tenant_id,
                controller=api_provider,
            )
            return cast(
                ApiTool,
                api_provider.get_tool(tool_name).fork_tool_runtime(
                    runtime=ToolRuntime(
                        tenant_id=tenant_id,
                        credentials=encrypter.decrypt(credentials),
                        invoke_from=invoke_from,
                        tool_invoke_from=tool_invoke_from,
                    )
                ),
            )
        elif provider_type == ToolProviderType.WORKFLOW:
            workflow_provider = (
                db.session.query(WorkflowToolProvider)
                .filter(WorkflowToolProvider.tenant_id == tenant_id, WorkflowToolProvider.id == provider_id)
                .first()
            )

            if workflow_provider is None:
                raise ToolProviderNotFoundError(f"workflow provider {provider_id} not found")

            controller = ToolTransformService.workflow_provider_to_controller(db_provider=workflow_provider)
            controller_tools: list[WorkflowTool] = controller.get_tools(tenant_id=workflow_provider.tenant_id)
            if controller_tools is None or len(controller_tools) == 0:
                raise ToolProviderNotFoundError(f"workflow provider {provider_id} not found")

            return cast(
                WorkflowTool,
                controller.get_tools(tenant_id=workflow_provider.tenant_id)[0].fork_tool_runtime(
                    runtime=ToolRuntime(
                        tenant_id=tenant_id,
                        credentials={},
                        invoke_from=invoke_from,
                        tool_invoke_from=tool_invoke_from,
                    )
                ),
            )
        elif provider_type == ToolProviderType.APP:
            raise NotImplementedError("app provider not implemented")
        elif provider_type == ToolProviderType.PLUGIN:
            return cls.get_plugin_provider(provider_id, tenant_id).get_tool(tool_name)
        elif provider_type == ToolProviderType.MCP:
            return cls.get_mcp_provider_controller(tenant_id, provider_id).get_tool(tool_name)
        else:
            raise ToolProviderNotFoundError(f"provider type {provider_type.value} not found")

    @classmethod
    def get_agent_tool_runtime(
        cls,
        tenant_id: str,
        app_id: str,
        agent_tool: AgentToolEntity,
        invoke_from: InvokeFrom = InvokeFrom.DEBUGGER,
        variable_pool: Optional[VariablePool] = None,
    ) -> Tool:
        """
        get the agent tool runtime
        """
        tool_entity = cls.get_tool_runtime(
            provider_type=agent_tool.provider_type,
            provider_id=agent_tool.provider_id,
            tool_name=agent_tool.tool_name,
            tenant_id=tenant_id,
            invoke_from=invoke_from,
            tool_invoke_from=ToolInvokeFrom.AGENT,
            credential_id=agent_tool.credential_id,
        )
        runtime_parameters = {}
        parameters = tool_entity.get_merged_runtime_parameters()
        runtime_parameters = cls._convert_tool_parameters_type(
            parameters, variable_pool, agent_tool.tool_parameters, typ="agent"
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
        workflow_tool: "ToolEntity",
        invoke_from: InvokeFrom = InvokeFrom.DEBUGGER,
        variable_pool: Optional[VariablePool] = None,
    ) -> Tool:
        """
        get the workflow tool runtime
        """

        tool_runtime = cls.get_tool_runtime(
            provider_type=workflow_tool.provider_type,
            provider_id=workflow_tool.provider_id,
            tool_name=workflow_tool.tool_name,
            tenant_id=tenant_id,
            invoke_from=invoke_from,
            tool_invoke_from=ToolInvokeFrom.WORKFLOW,
            credential_id=workflow_tool.credential_id,
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
        credential_id: Optional[str] = None,
    ) -> Tool:
        """
        get tool runtime from plugin
        """
        tool_entity = cls.get_tool_runtime(
            provider_type=tool_type,
            provider_id=provider,
            tool_name=tool_name,
            tenant_id=tenant_id,
            invoke_from=InvokeFrom.SERVICE_API,
            tool_invoke_from=ToolInvokeFrom.PLUGIN,
            credential_id=credential_id,
        )
        runtime_parameters = {}
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
            path.dirname(path.realpath(__file__)),
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
        for provider_path in listdir(path.join(path.dirname(path.realpath(__file__)), "builtin_tool", "providers")):
            if provider_path.startswith("__"):
                continue

            if path.isdir(path.join(path.dirname(path.realpath(__file__)), "builtin_tool", "providers", provider_path)):
                if provider_path.startswith("__"):
                    continue

                # init provider
                try:
                    provider_class = load_single_subclass_from_source(
                        module_name=f"core.tools.builtin_tool.providers.{provider_path}.{provider_path}",
                        script_path=path.join(
                            path.dirname(path.realpath(__file__)),
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
                    logger.exception(f"load builtin provider {provider_path}")
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
    def get_tool_label(cls, tool_name: str) -> Union[I18nObject, None]:
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
    def list_default_builtin_providers(cls, tenant_id: str) -> list[BuiltinToolProvider]:
        """
        list all the builtin providers
        """
        # according to multi credentials, select the one with is_default=True first, then created_at oldest
        # for compatibility with old version
        sql = """
                SELECT DISTINCT ON (tenant_id, provider) id
                FROM tool_builtin_providers
                WHERE tenant_id = :tenant_id
                ORDER BY tenant_id, provider, is_default DESC, created_at DESC
                """
        ids = [row.id for row in db.session.execute(db.text(sql), {"tenant_id": tenant_id}).all()]
        return db.session.query(BuiltinToolProvider).filter(BuiltinToolProvider.id.in_(ids)).all()

    @classmethod
    def list_providers_from_api(
        cls, user_id: str, tenant_id: str, typ: ToolProviderTypeApiLiteral
    ) -> list[ToolProviderApiEntity]:
        result_providers: dict[str, ToolProviderApiEntity] = {}

        filters = []
        if not typ:
            filters.extend(["builtin", "api", "workflow", "mcp"])
        else:
            filters.append(typ)

        with db.session.no_autoflush:
            if "builtin" in filters:
                builtin_providers = cls.list_builtin_providers(tenant_id)

                # key: provider name, value: provider
                db_builtin_providers = {
                    str(ToolProviderID(provider.provider)): provider
                    for provider in cls.list_default_builtin_providers(tenant_id)
                }

                # append builtin providers
                for provider in builtin_providers:
                    # handle include, exclude
                    if is_filtered(
                        include_set=cast(set[str], dify_config.POSITION_TOOL_INCLUDES_SET),
                        exclude_set=cast(set[str], dify_config.POSITION_TOOL_EXCLUDES_SET),
                        data=provider,
                        name_func=lambda x: x.identity.name,
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
                db_api_providers: list[ApiToolProvider] = (
                    db.session.query(ApiToolProvider).filter(ApiToolProvider.tenant_id == tenant_id).all()
                )

                api_provider_controllers: list[dict[str, Any]] = [
                    {"provider": provider, "controller": ToolTransformService.api_provider_to_controller(provider)}
                    for provider in db_api_providers
                ]

                # get labels
                labels = ToolLabelManager.get_tools_labels([x["controller"] for x in api_provider_controllers])

                for api_provider_controller in api_provider_controllers:
                    user_provider = ToolTransformService.api_provider_to_user_provider(
                        provider_controller=api_provider_controller["controller"],
                        db_provider=api_provider_controller["provider"],
                        decrypt_credentials=False,
                        labels=labels.get(api_provider_controller["controller"].provider_id, []),
                    )
                    result_providers[f"api_provider.{user_provider.name}"] = user_provider

            if "workflow" in filters:
                # get workflow providers
                workflow_providers: list[WorkflowToolProvider] = (
                    db.session.query(WorkflowToolProvider).filter(WorkflowToolProvider.tenant_id == tenant_id).all()
                )

                workflow_provider_controllers: list[WorkflowToolProviderController] = []
                for workflow_provider in workflow_providers:
                    try:
                        workflow_provider_controllers.append(
                            ToolTransformService.workflow_provider_to_controller(db_provider=workflow_provider)
                        )
                    except Exception:
                        # app has been deleted
                        pass

                labels = ToolLabelManager.get_tools_labels(
                    [cast(ToolProviderController, controller) for controller in workflow_provider_controllers]
                )

                for provider_controller in workflow_provider_controllers:
                    user_provider = ToolTransformService.workflow_provider_to_user_provider(
                        provider_controller=provider_controller,
                        labels=labels.get(provider_controller.provider_id, []),
                    )
                    result_providers[f"workflow_provider.{user_provider.name}"] = user_provider
            if "mcp" in filters:
                mcp_providers = MCPToolManageService.retrieve_mcp_tools(tenant_id, for_list=True)
                for mcp_provider in mcp_providers:
                    result_providers[f"mcp_provider.{mcp_provider.name}"] = mcp_provider

        return BuiltinToolProviderSort.sort(list(result_providers.values()))

    @classmethod
    def get_api_provider_controller(
        cls, tenant_id: str, provider_id: str
    ) -> tuple[ApiToolProviderController, dict[str, Any]]:
        """
        get the api provider

        :param tenant_id: the id of the tenant
        :param provider_id: the id of the provider

        :return: the provider controller, the credentials
        """
        provider: ApiToolProvider | None = (
            db.session.query(ApiToolProvider)
            .filter(
                ApiToolProvider.id == provider_id,
                ApiToolProvider.tenant_id == tenant_id,
            )
            .first()
        )

        if provider is None:
            raise ToolProviderNotFoundError(f"api provider {provider_id} not found")

        auth_type = ApiProviderAuthType.NONE
        provider_auth_type = provider.credentials.get("auth_type")
        if provider_auth_type in ("api_key_header", "api_key"):  # backward compatibility
            auth_type = ApiProviderAuthType.API_KEY_HEADER
        elif provider_auth_type == "api_key_query":
            auth_type = ApiProviderAuthType.API_KEY_QUERY

        controller = ApiToolProviderController.from_db(
            provider,
            auth_type,
        )
        controller.load_bundled_tools(provider.tools)

        return controller, provider.credentials

    @classmethod
    def get_mcp_provider_controller(cls, tenant_id: str, provider_id: str) -> MCPToolProviderController:
        """
        get the api provider

        :param tenant_id: the id of the tenant
        :param provider_id: the id of the provider

        :return: the provider controller, the credentials
        """
        provider: MCPToolProvider | None = (
            db.session.query(MCPToolProvider)
            .filter(
                MCPToolProvider.server_identifier == provider_id,
                MCPToolProvider.tenant_id == tenant_id,
            )
            .first()
        )

        if provider is None:
            raise ToolProviderNotFoundError(f"mcp provider {provider_id} not found")

        controller = MCPToolProviderController._from_db(provider)

        return controller

    @classmethod
    def user_get_api_provider(cls, provider: str, tenant_id: str) -> dict:
        """
        get api provider
        """
        """
            get tool provider
        """
        provider_name = provider
        provider_obj: ApiToolProvider | None = (
            db.session.query(ApiToolProvider)
            .filter(
                ApiToolProvider.tenant_id == tenant_id,
                ApiToolProvider.name == provider,
            )
            .first()
        )

        if provider_obj is None:
            raise ValueError(f"you have not added provider {provider_name}")

        try:
            credentials = json.loads(provider_obj.credentials_str) or {}
        except Exception:
            credentials = {}

        # package tool provider controller
        auth_type = ApiProviderAuthType.NONE
        credentials_auth_type = credentials.get("auth_type")
        if credentials_auth_type in ("api_key_header", "api_key"):  # backward compatibility
            auth_type = ApiProviderAuthType.API_KEY_HEADER
        elif credentials_auth_type == "api_key_query":
            auth_type = ApiProviderAuthType.API_KEY_QUERY

        controller = ApiToolProviderController.from_db(
            provider_obj,
            auth_type,
        )
        # init tool configuration
        encrypter, _ = create_tool_provider_encrypter(
            tenant_id=tenant_id,
            controller=controller,
        )

        masked_credentials = encrypter.mask_tool_credentials(encrypter.decrypt(credentials))

        try:
            icon = json.loads(provider_obj.icon)
        except Exception:
            icon = {"background": "#252525", "content": "\ud83d\ude01"}

        # add tool labels
        labels = ToolLabelManager.get_tool_labels(controller)

        return cast(
            dict,
            jsonable_encoder(
                {
                    "schema_type": provider_obj.schema_type,
                    "schema": provider_obj.schema,
                    "tools": provider_obj.tools,
                    "icon": icon,
                    "description": provider_obj.description,
                    "credentials": masked_credentials,
                    "privacy_policy": provider_obj.privacy_policy,
                    "custom_disclaimer": provider_obj.custom_disclaimer,
                    "labels": labels,
                }
            ),
        )

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
    def generate_workflow_tool_icon_url(cls, tenant_id: str, provider_id: str) -> dict:
        try:
            workflow_provider: WorkflowToolProvider | None = (
                db.session.query(WorkflowToolProvider)
                .filter(WorkflowToolProvider.tenant_id == tenant_id, WorkflowToolProvider.id == provider_id)
                .first()
            )

            if workflow_provider is None:
                raise ToolProviderNotFoundError(f"workflow provider {provider_id} not found")

            icon: dict = json.loads(workflow_provider.icon)
            return icon
        except Exception:
            return {"background": "#252525", "content": "\ud83d\ude01"}

    @classmethod
    def generate_api_tool_icon_url(cls, tenant_id: str, provider_id: str) -> dict:
        try:
            api_provider: ApiToolProvider | None = (
                db.session.query(ApiToolProvider)
                .filter(ApiToolProvider.tenant_id == tenant_id, ApiToolProvider.id == provider_id)
                .first()
            )

            if api_provider is None:
                raise ToolProviderNotFoundError(f"api provider {provider_id} not found")

            icon: dict = json.loads(api_provider.icon)
            return icon
        except Exception:
            return {"background": "#252525", "content": "\ud83d\ude01"}

    @classmethod
    def generate_mcp_tool_icon_url(cls, tenant_id: str, provider_id: str) -> dict[str, str] | str:
        try:
            mcp_provider: MCPToolProvider | None = (
                db.session.query(MCPToolProvider)
                .filter(MCPToolProvider.tenant_id == tenant_id, MCPToolProvider.server_identifier == provider_id)
                .first()
            )

            if mcp_provider is None:
                raise ToolProviderNotFoundError(f"mcp provider {provider_id} not found")

            return mcp_provider.provider_icon
        except Exception:
            return {"background": "#252525", "content": "\ud83d\ude01"}

    @classmethod
    def get_tool_icon(
        cls,
        tenant_id: str,
        provider_type: ToolProviderType,
        provider_id: str,
    ) -> Union[str, dict]:
        """
        get the tool icon

        :param tenant_id: the id of the tenant
        :param provider_type: the type of the provider
        :param provider_id: the id of the provider
        :return:
        """
        provider_type = provider_type
        provider_id = provider_id
        if provider_type == ToolProviderType.BUILT_IN:
            provider = ToolManager.get_builtin_provider(provider_id, tenant_id)
            if isinstance(provider, PluginToolProviderController):
                try:
                    return cls.generate_plugin_tool_icon_url(tenant_id, provider.entity.identity.icon)
                except Exception:
                    return {"background": "#252525", "content": "\ud83d\ude01"}
            return cls.generate_builtin_tool_icon_url(provider_id)
        elif provider_type == ToolProviderType.API:
            return cls.generate_api_tool_icon_url(tenant_id, provider_id)
        elif provider_type == ToolProviderType.WORKFLOW:
            return cls.generate_workflow_tool_icon_url(tenant_id, provider_id)
        elif provider_type == ToolProviderType.PLUGIN:
            provider = ToolManager.get_builtin_provider(provider_id, tenant_id)
            if isinstance(provider, PluginToolProviderController):
                try:
                    return cls.generate_plugin_tool_icon_url(tenant_id, provider.entity.identity.icon)
                except Exception:
                    return {"background": "#252525", "content": "\ud83d\ude01"}
            raise ValueError(f"plugin provider {provider_id} not found")
        elif provider_type == ToolProviderType.MCP:
            return cls.generate_mcp_tool_icon_url(tenant_id, provider_id)
        else:
            raise ValueError(f"provider type {provider_type} not found")

    @classmethod
    def _convert_tool_parameters_type(
        cls,
        parameters: list[ToolParameter],
        variable_pool: Optional[VariablePool],
        tool_configurations: dict[str, Any],
        typ: Literal["agent", "workflow", "tool"] = "workflow",
    ) -> dict[str, Any]:
        """
        Convert tool parameters type
        """
        from core.workflow.nodes.tool.entities import ToolNodeData
        from core.workflow.nodes.tool.exc import ToolParameterError

        runtime_parameters = {}
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
            ):
                raise ValueError(f"file type parameter {parameter.name} not supported in agent")
            # save tool parameter to tool entity memory
            if parameter.form == ToolParameter.ToolParameterForm.FORM:
                if variable_pool:
                    config = tool_configurations.get(parameter.name, {})
                    if not (config and isinstance(config, dict) and config.get("value") is not None):
                        continue
                    tool_input = ToolNodeData.ToolInput(**tool_configurations.get(parameter.name, {}))
                    if tool_input.type == "variable":
                        variable = variable_pool.get(tool_input.value)
                        if variable is None:
                            raise ToolParameterError(f"Variable {tool_input.value} does not exist")
                        parameter_value = variable.value
                    elif tool_input.type in {"mixed", "constant"}:
                        segment_group = variable_pool.convert_template(str(tool_input.value))
                        parameter_value = segment_group.text
                    else:
                        raise ToolParameterError(f"Unknown tool input type '{tool_input.type}'")
                    runtime_parameters[parameter.name] = parameter_value

                else:
                    value = parameter.init_frontend_parameter(tool_configurations.get(parameter.name))
                    runtime_parameters[parameter.name] = value
        return runtime_parameters


ToolManager.load_hardcoded_providers_cache()
