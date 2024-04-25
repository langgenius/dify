import json
import logging
import mimetypes
from collections.abc import Generator
from os import listdir, path
from threading import Lock
from typing import Any, Union

from flask import current_app

from core.agent.entities import AgentToolEntity
from core.model_runtime.utils.encoders import jsonable_encoder
from core.provider_manager import ProviderManager
from core.tools import *
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ApiProviderAuthType,
    ToolParameter,
)
from core.tools.entities.user_entities import UserToolProvider
from core.tools.errors import ToolProviderNotFoundError
from core.tools.provider.api_tool_provider import ApiBasedToolProviderController
from core.tools.provider.builtin._positions import BuiltinToolProviderSort
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.provider.model_tool_provider import ModelToolProviderController
from core.tools.tool.api_tool import ApiTool
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.tool.tool import Tool
from core.tools.utils.configuration import (
    ToolConfigurationManager,
    ToolParameterConfigurationManager,
)
from core.utils.module_import_helper import load_single_subclass_from_source
from core.workflow.nodes.tool.entities import ToolEntity
from extensions.ext_database import db
from models.tools import ApiToolProvider, BuiltinToolProvider
from services.tools_transform_service import ToolTransformService

logger = logging.getLogger(__name__)

class ToolManager:
    _builtin_provider_lock = Lock()
    _builtin_providers = {}
    _builtin_providers_loaded = False
    _builtin_tools_labels = {}

    @classmethod
    def get_builtin_provider(cls, provider: str) -> BuiltinToolProviderController:
        """
            get the builtin provider

            :param provider: the name of the provider
            :return: the provider
        """
        if len(cls._builtin_providers) == 0:
            # init the builtin providers
            cls.load_builtin_providers_cache()

        if provider not in cls._builtin_providers:
            raise ToolProviderNotFoundError(f'builtin provider {provider} not found')

        return cls._builtin_providers[provider]

    @classmethod
    def get_builtin_tool(cls, provider: str, tool_name: str) -> BuiltinTool:
        """
            get the builtin tool

            :param provider: the name of the provider
            :param tool_name: the name of the tool

            :return: the provider, the tool
        """
        provider_controller = cls.get_builtin_provider(provider)
        tool = provider_controller.get_tool(tool_name)

        return tool

    @classmethod
    def get_tool(cls, provider_type: str, provider_id: str, tool_name: str, tenant_id: str = None) \
            -> Union[BuiltinTool, ApiTool]:
        """
            get the tool

            :param provider_type: the type of the provider
            :param provider_name: the name of the provider
            :param tool_name: the name of the tool

            :return: the tool
        """
        if provider_type == 'builtin':
            return cls.get_builtin_tool(provider_id, tool_name)
        elif provider_type == 'api':
            if tenant_id is None:
                raise ValueError('tenant id is required for api provider')
            api_provider, _ = cls.get_api_provider_controller(tenant_id, provider_id)
            return api_provider.get_tool(tool_name)
        elif provider_type == 'app':
            raise NotImplementedError('app provider not implemented')
        else:
            raise ToolProviderNotFoundError(f'provider type {provider_type} not found')

    @classmethod
    def get_tool_runtime(cls, provider_type: str, provider_name: str, tool_name: str, tenant_id: str) \
        -> Union[BuiltinTool, ApiTool]:
        """
            get the tool runtime

            :param provider_type: the type of the provider
            :param provider_name: the name of the provider
            :param tool_name: the name of the tool

            :return: the tool
        """
        if provider_type == 'builtin':
            builtin_tool = cls.get_builtin_tool(provider_name, tool_name)

            # check if the builtin tool need credentials
            provider_controller = cls.get_builtin_provider(provider_name)
            if not provider_controller.need_credentials:
                return builtin_tool.fork_tool_runtime(meta={
                    'tenant_id': tenant_id,
                    'credentials': {},
                })

            # get credentials
            builtin_provider: BuiltinToolProvider = db.session.query(BuiltinToolProvider).filter(
                BuiltinToolProvider.tenant_id == tenant_id,
                BuiltinToolProvider.provider == provider_name,
            ).first()

            if builtin_provider is None:
                raise ToolProviderNotFoundError(f'builtin provider {provider_name} not found')

            # decrypt the credentials
            credentials = builtin_provider.credentials
            controller = cls.get_builtin_provider(provider_name)
            tool_configuration = ToolConfigurationManager(tenant_id=tenant_id, provider_controller=controller)

            decrypted_credentials = tool_configuration.decrypt_tool_credentials(credentials)

            return builtin_tool.fork_tool_runtime(meta={
                'tenant_id': tenant_id,
                'credentials': decrypted_credentials,
                'runtime_parameters': {}
            })
        
        elif provider_type == 'api':
            if tenant_id is None:
                raise ValueError('tenant id is required for api provider')

            api_provider, credentials = cls.get_api_provider_controller(tenant_id, provider_name)

            # decrypt the credentials
            tool_configuration = ToolConfigurationManager(tenant_id=tenant_id, provider_controller=api_provider)
            decrypted_credentials = tool_configuration.decrypt_tool_credentials(credentials)

            return api_provider.get_tool(tool_name).fork_tool_runtime(meta={
                'tenant_id': tenant_id,
                'credentials': decrypted_credentials,
            })
        elif provider_type == 'model':
            if tenant_id is None:
                raise ValueError('tenant id is required for model provider')
            # get model provider
            model_provider = cls.get_model_provider(tenant_id, provider_name)

            # get tool
            model_tool = model_provider.get_tool(tool_name)

            return model_tool.fork_tool_runtime(meta={
                'tenant_id': tenant_id,
                'credentials': model_tool.model_configuration['model_instance'].credentials
            })
        elif provider_type == 'app':
            raise NotImplementedError('app provider not implemented')
        else:
            raise ToolProviderNotFoundError(f'provider type {provider_type} not found')

    @classmethod
    def _init_runtime_parameter(cls, parameter_rule: ToolParameter, parameters: dict) -> Union[str, int, float, bool]:
        """
            init runtime parameter
        """
        parameter_value = parameters.get(parameter_rule.name)
        if not parameter_value:
            # get default value
            parameter_value = parameter_rule.default
            if not parameter_value and parameter_rule.required:
                raise ValueError(f"tool parameter {parameter_rule.name} not found in tool config")

        if parameter_rule.type == ToolParameter.ToolParameterType.SELECT:
            # check if tool_parameter_config in options
            options = list(map(lambda x: x.value, parameter_rule.options))
            if parameter_value not in options:
                raise ValueError(
                    f"tool parameter {parameter_rule.name} value {parameter_value} not in options {options}")

        # convert tool parameter config to correct type
        try:
            if parameter_rule.type == ToolParameter.ToolParameterType.NUMBER:
                # check if tool parameter is integer
                if isinstance(parameter_value, int):
                    parameter_value = parameter_value
                elif isinstance(parameter_value, float):
                    parameter_value = parameter_value
                elif isinstance(parameter_value, str):
                    if '.' in parameter_value:
                        parameter_value = float(parameter_value)
                    else:
                        parameter_value = int(parameter_value)
            elif parameter_rule.type == ToolParameter.ToolParameterType.BOOLEAN:
                parameter_value = bool(parameter_value)
            elif parameter_rule.type not in [ToolParameter.ToolParameterType.SELECT,
                                             ToolParameter.ToolParameterType.STRING]:
                parameter_value = str(parameter_value)
            elif parameter_rule.type == ToolParameter.ToolParameterType:
                parameter_value = str(parameter_value)
        except Exception as e:
            raise ValueError(f"tool parameter {parameter_rule.name} value {parameter_value} is not correct type")

        return parameter_value

    @classmethod
    def get_agent_tool_runtime(cls, tenant_id: str, app_id: str, agent_tool: AgentToolEntity) -> Tool:
        """
            get the agent tool runtime
        """
        tool_entity = cls.get_tool_runtime(
            provider_type=agent_tool.provider_type, provider_name=agent_tool.provider_id,
            tool_name=agent_tool.tool_name,
            tenant_id=tenant_id,
        )
        runtime_parameters = {}
        parameters = tool_entity.get_all_runtime_parameters()
        for parameter in parameters:
            if parameter.form == ToolParameter.ToolParameterForm.FORM:
                # save tool parameter to tool entity memory
                value = cls._init_runtime_parameter(parameter, agent_tool.tool_parameters)
                runtime_parameters[parameter.name] = value

        # decrypt runtime parameters
        encryption_manager = ToolParameterConfigurationManager(
            tenant_id=tenant_id,
            tool_runtime=tool_entity,
            provider_name=agent_tool.provider_id,
            provider_type=agent_tool.provider_type,
            identity_id=f'AGENT.{app_id}'
        )
        runtime_parameters = encryption_manager.decrypt_tool_parameters(runtime_parameters)

        tool_entity.runtime.runtime_parameters.update(runtime_parameters)
        return tool_entity

    @classmethod
    def get_workflow_tool_runtime(cls, tenant_id: str, app_id: str, node_id: str, workflow_tool: ToolEntity):
        """
            get the workflow tool runtime
        """
        tool_entity = cls.get_tool_runtime(
            provider_type=workflow_tool.provider_type,
            provider_name=workflow_tool.provider_id,
            tool_name=workflow_tool.tool_name,
            tenant_id=tenant_id,
        )
        runtime_parameters = {}
        parameters = tool_entity.get_all_runtime_parameters()

        for parameter in parameters:
            # save tool parameter to tool entity memory
            if parameter.form == ToolParameter.ToolParameterForm.FORM:
                value = cls._init_runtime_parameter(parameter, workflow_tool.tool_configurations)
                runtime_parameters[parameter.name] = value

        # decrypt runtime parameters
        encryption_manager = ToolParameterConfigurationManager(
            tenant_id=tenant_id,
            tool_runtime=tool_entity,
            provider_name=workflow_tool.provider_id,
            provider_type=workflow_tool.provider_type,
            identity_id=f'WORKFLOW.{app_id}.{node_id}'
        )

        if runtime_parameters:
            runtime_parameters = encryption_manager.decrypt_tool_parameters(runtime_parameters)

        tool_entity.runtime.runtime_parameters.update(runtime_parameters)
        return tool_entity

    @classmethod
    def get_builtin_provider_icon(cls, provider: str) -> tuple[str, str]:
        """
            get the absolute path of the icon of the builtin provider

            :param provider: the name of the provider

            :return: the absolute path of the icon, the mime type of the icon
        """
        # get provider
        provider_controller = cls.get_builtin_provider(provider)

        absolute_path = path.join(path.dirname(path.realpath(__file__)), 'provider', 'builtin', provider, '_assets',
                                  provider_controller.identity.icon)
        # check if the icon exists
        if not path.exists(absolute_path):
            raise ToolProviderNotFoundError(f'builtin provider {provider} icon not found')

        # get the mime type
        mime_type, _ = mimetypes.guess_type(absolute_path)
        mime_type = mime_type or 'application/octet-stream'

        return absolute_path, mime_type

    @classmethod
    def list_builtin_providers(cls) -> Generator[BuiltinToolProviderController, None, None]:
        # use cache first
        if cls._builtin_providers_loaded:
            yield from list(cls._builtin_providers.values())
            return
        
        with cls._builtin_provider_lock:
            if cls._builtin_providers_loaded:
                yield from list(cls._builtin_providers.values())
                return
            
            yield from cls._list_builtin_providers()
    
    @classmethod
    def _list_builtin_providers(cls) -> Generator[BuiltinToolProviderController, None, None]:
        """
            list all the builtin providers
        """
        for provider in listdir(path.join(path.dirname(path.realpath(__file__)), 'provider', 'builtin')):
            if provider.startswith('__'):
                continue

            if path.isdir(path.join(path.dirname(path.realpath(__file__)), 'provider', 'builtin', provider)):
                if provider.startswith('__'):
                    continue

                # init provider
                try:
                    provider_class = load_single_subclass_from_source(
                        module_name=f'core.tools.provider.builtin.{provider}.{provider}',
                        script_path=path.join(path.dirname(path.realpath(__file__)),
                                            'provider', 'builtin', provider, f'{provider}.py'),
                        parent_type=BuiltinToolProviderController)
                    provider: BuiltinToolProviderController = provider_class()
                    cls._builtin_providers[provider.identity.name] = provider
                    for tool in provider.get_tools():
                        cls._builtin_tools_labels[tool.identity.name] = tool.identity.label
                    yield provider

                except Exception as e:
                    logger.error(f'load builtin provider {provider} error: {e}')
                    continue
        # set builtin providers loaded
        cls._builtin_providers_loaded = True

    @classmethod
    def load_builtin_providers_cache(cls):
        for _ in cls.list_builtin_providers():
            pass

    @classmethod
    def clear_builtin_providers_cache(cls):
        cls._builtin_providers = {}
        cls._builtin_providers_loaded = False

    # @classmethod
    # def list_model_providers(cls, tenant_id: str = None) -> list[ModelToolProviderController]:
    #     """
    #         list all the model providers

    #         :return: the list of the model providers
    #     """
    #     tenant_id = tenant_id or 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    #     # get configurations
    #     model_configurations = ModelToolConfigurationManager.get_all_configuration()
    #     # get all providers
    #     provider_manager = ProviderManager()
    #     configurations = provider_manager.get_configurations(tenant_id).values()
    #     # get model providers
    #     model_providers: list[ModelToolProviderController] = []
    #     for configuration in configurations:
    #         # all the model tool should be configurated
    #         if configuration.provider.provider not in model_configurations:
    #             continue
    #         if not ModelToolProviderController.is_configuration_valid(configuration):
    #             continue
    #         model_providers.append(ModelToolProviderController.from_db(configuration))

    #     return model_providers

    @classmethod
    def get_model_provider(cls, tenant_id: str, provider_name: str) -> ModelToolProviderController:
        """
            get the model provider

            :param provider_name: the name of the provider

            :return: the provider
        """
        # get configurations
        provider_manager = ProviderManager()
        configurations = provider_manager.get_configurations(tenant_id)
        configuration = configurations.get(provider_name)
        if configuration is None:
            raise ToolProviderNotFoundError(f'model provider {provider_name} not found')

        return ModelToolProviderController.from_db(configuration)

    @classmethod
    def get_tool_label(cls, tool_name: str) -> Union[I18nObject, None]:
        """
            get the tool label

            :param tool_name: the name of the tool

            :return: the label of the tool
        """
        cls._builtin_tools_labels
        if len(cls._builtin_tools_labels) == 0:
            # init the builtin providers
            cls.load_builtin_providers_cache()

        if tool_name not in cls._builtin_tools_labels:
            return None

        return cls._builtin_tools_labels[tool_name]

    @classmethod
    def user_list_providers(cls, user_id: str, tenant_id: str) -> list[UserToolProvider]:
        result_providers: dict[str, UserToolProvider] = {}

        # get builtin providers
        builtin_providers = cls.list_builtin_providers()
        
        # get db builtin providers
        db_builtin_providers: list[BuiltinToolProvider] = db.session.query(BuiltinToolProvider). \
            filter(BuiltinToolProvider.tenant_id == tenant_id).all()

        find_db_builtin_provider = lambda provider: next(
            (x for x in db_builtin_providers if x.provider == provider),
            None
        )

        # append builtin providers
        for provider in builtin_providers:
            user_provider = ToolTransformService.builtin_provider_to_user_provider(
                provider_controller=provider,
                db_provider=find_db_builtin_provider(provider.identity.name),
                decrypt_credentials=False
            )

            result_providers[provider.identity.name] = user_provider

        # # get model tool providers
        # model_providers = cls.list_model_providers(tenant_id=tenant_id)
        # # append model providers
        # for provider in model_providers:
        #     user_provider = ToolTransformService.model_provider_to_user_provider(
        #         db_provider=provider,
        #     )
        #     result_providers[f'model_provider.{provider.identity.name}'] = user_provider

        # get db api providers
        db_api_providers: list[ApiToolProvider] = db.session.query(ApiToolProvider). \
            filter(ApiToolProvider.tenant_id == tenant_id).all()

        for db_api_provider in db_api_providers:
            provider_controller = ToolTransformService.api_provider_to_controller(
                db_provider=db_api_provider,
            )
            user_provider = ToolTransformService.api_provider_to_user_provider(
                provider_controller=provider_controller,
                db_provider=db_api_provider,
                decrypt_credentials=False
            )
            result_providers[db_api_provider.name] = user_provider

        return BuiltinToolProviderSort.sort(list(result_providers.values()))

    @classmethod
    def get_api_provider_controller(cls, tenant_id: str, provider_id: str) -> tuple[
        ApiBasedToolProviderController, dict[str, Any]]:
        """
            get the api provider

            :param provider_name: the name of the provider

            :return: the provider controller, the credentials
        """
        provider: ApiToolProvider = db.session.query(ApiToolProvider).filter(
            ApiToolProvider.id == provider_id,
            ApiToolProvider.tenant_id == tenant_id,
        ).first()

        if provider is None:
            raise ToolProviderNotFoundError(f'api provider {provider_id} not found')

        controller = ApiBasedToolProviderController.from_db(
            provider,
            ApiProviderAuthType.API_KEY if provider.credentials['auth_type'] == 'api_key' else 
            ApiProviderAuthType.NONE
        )
        controller.load_bundled_tools(provider.tools)

        return controller, provider.credentials

    @classmethod
    def user_get_api_provider(cls, provider: str, tenant_id: str) -> dict:
        """
            get api provider
        """
        """
            get tool provider
        """
        provider: ApiToolProvider = db.session.query(ApiToolProvider).filter(
            ApiToolProvider.tenant_id == tenant_id,
            ApiToolProvider.name == provider,
        ).first()

        if provider is None:
            raise ValueError(f'you have not added provider {provider}')

        try:
            credentials = json.loads(provider.credentials_str) or {}
        except:
            credentials = {}

        # package tool provider controller
        controller = ApiBasedToolProviderController.from_db(
            provider, ApiProviderAuthType.API_KEY if credentials['auth_type'] == 'api_key' else ApiProviderAuthType.NONE
        )
        # init tool configuration
        tool_configuration = ToolConfigurationManager(tenant_id=tenant_id, provider_controller=controller)

        decrypted_credentials = tool_configuration.decrypt_tool_credentials(credentials)
        masked_credentials = tool_configuration.mask_tool_credentials(decrypted_credentials)

        try:
            icon = json.loads(provider.icon)
        except:
            icon = {
                "background": "#252525",
                "content": "\ud83d\ude01"
            }

        return jsonable_encoder({
            'schema_type': provider.schema_type,
            'schema': provider.schema,
            'tools': provider.tools,
            'icon': icon,
            'description': provider.description,
            'credentials': masked_credentials,
            'privacy_policy': provider.privacy_policy
        })

    @classmethod
    def get_tool_icon(cls, tenant_id: str, provider_type: str, provider_id: str) -> Union[str, dict]:
        """
            get the tool icon

            :param tenant_id: the id of the tenant
            :param provider_type: the type of the provider
            :param provider_id: the id of the provider
            :return:
        """
        provider_type = provider_type
        provider_id = provider_id
        if provider_type == 'builtin':
            return (current_app.config.get("CONSOLE_API_URL")
                    + "/console/api/workspaces/current/tool-provider/builtin/"
                    + provider_id
                    + "/icon")
        elif provider_type == 'api':
            try:
                provider: ApiToolProvider = db.session.query(ApiToolProvider).filter(
                    ApiToolProvider.tenant_id == tenant_id,
                    ApiToolProvider.id == provider_id
                )
                return json.loads(provider.icon)
            except:
                return {
                    "background": "#252525",
                    "content": "\ud83d\ude01"
                }
        else:
            raise ValueError(f"provider type {provider_type} not found")

ToolManager.load_builtin_providers_cache()