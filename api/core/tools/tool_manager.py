import importlib
import json
import logging
import mimetypes
from os import listdir, path
from typing import Any, Dict, List, Tuple, Union

from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
from core.model_runtime.entities.message_entities import PromptMessage
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.constant import DEFAULT_PROVIDERS
from core.tools.entities.tool_entities import ApiProviderAuthType, ToolInvokeMessage, ToolProviderCredentials
from core.tools.entities.user_entities import UserToolProvider
from core.tools.errors import ToolProviderNotFoundError
from core.tools.provider.api_tool_provider import ApiBasedToolProviderController
from core.tools.provider.app_tool_provider import AppBasedToolProviderEntity
from core.tools.provider.builtin._positions import BuiltinToolProviderSort
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.provider.tool_provider import ToolProviderController
from core.tools.tool.api_tool import ApiTool
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.configuration import ToolConfiguration
from core.tools.utils.encoder import serialize_base_model_dict
from extensions.ext_database import db
from models.tools import ApiToolProvider, BuiltinToolProvider

logger = logging.getLogger(__name__)

_builtin_providers = {}
_builtin_tools_labels = {}

class ToolManager:
    @staticmethod
    def invoke(
        provider: str,
        tool_id: str,
        tool_name: str,
        tool_parameters: Dict[str, Any],
        credentials: Dict[str, Any],
        prompt_messages: List[PromptMessage],
    ) -> List[ToolInvokeMessage]:
        """
            invoke the assistant

            :param provider: the name of the provider
            :param tool_id: the id of the tool
            :param tool_name: the name of the tool, defined in `get_tools`
            :param tool_parameters: the parameters of the tool
            :param credentials: the credentials of the tool
            :param prompt_messages: the prompt messages that the tool can use

            :return: the messages that the tool wants to send to the user
        """
        provider_entity: ToolProviderController = None
        if provider == DEFAULT_PROVIDERS.API_BASED:
            provider_entity = ApiBasedToolProviderController()
        elif provider == DEFAULT_PROVIDERS.APP_BASED:
            provider_entity = AppBasedToolProviderEntity()

        if provider_entity is None:
            # fetch the provider from .provider.builtin
            py_path = path.join(path.dirname(path.realpath(__file__)), 'builtin', provider, f'{provider}.py')
            spec = importlib.util.spec_from_file_location(f'core.tools.provider.builtin.{provider}.{provider}', py_path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

            # get all the classes in the module
            classes = [ x for _, x in vars(mod).items() 
                       if isinstance(x, type) and x != ToolProviderController and issubclass(x, ToolProviderController)
            ]
            if len(classes) == 0:
                raise ToolProviderNotFoundError(f'provider {provider} not found')
            if len(classes) > 1:
                raise ToolProviderNotFoundError(f'multiple providers found for {provider}')
            
            provider_entity = classes[0]()

        return provider_entity.invoke(tool_id, tool_name, tool_parameters, credentials, prompt_messages)
    
    @staticmethod
    def get_builtin_provider(provider: str) -> BuiltinToolProviderController:
        global _builtin_providers
        """
            get the builtin provider

            :param provider: the name of the provider
            :return: the provider
        """
        if len(_builtin_providers) == 0:
            # init the builtin providers
            ToolManager.list_builtin_providers()

        if provider not in _builtin_providers:
            raise ToolProviderNotFoundError(f'builtin provider {provider} not found')
        
        return _builtin_providers[provider]
    
    @staticmethod
    def get_builtin_tool(provider: str, tool_name: str) -> BuiltinTool:
        """
            get the builtin tool

            :param provider: the name of the provider
            :param tool_name: the name of the tool

            :return: the provider, the tool
        """
        provider_controller = ToolManager.get_builtin_provider(provider)
        tool = provider_controller.get_tool(tool_name)

        return tool
    
    @staticmethod
    def get_tool(provider_type: str, provider_id: str, tool_name: str, tenant_id: str = None) \
        -> Union[BuiltinTool, ApiTool]:
        """
            get the tool

            :param provider_type: the type of the provider
            :param provider_name: the name of the provider
            :param tool_name: the name of the tool

            :return: the tool
        """
        if provider_type == 'builtin':
            return ToolManager.get_builtin_tool(provider_id, tool_name)
        elif provider_type == 'api':
            if tenant_id is None:
                raise ValueError('tenant id is required for api provider')
            api_provider, _ = ToolManager.get_api_provider_controller(tenant_id, provider_id)
            return api_provider.get_tool(tool_name)
        elif provider_type == 'app':
            raise NotImplementedError('app provider not implemented')
        else:
            raise ToolProviderNotFoundError(f'provider type {provider_type} not found')
        
    @staticmethod
    def get_tool_runtime(provider_type: str, provider_name: str, tool_name: str, tenant_id, 
                         agent_callback: DifyAgentCallbackHandler = None) \
        -> Union[BuiltinTool, ApiTool]:
        """
            get the tool runtime

            :param provider_type: the type of the provider
            :param provider_name: the name of the provider
            :param tool_name: the name of the tool

            :return: the tool
        """
        if provider_type == 'builtin':
            builtin_tool = ToolManager.get_builtin_tool(provider_name, tool_name)

            # check if the builtin tool need credentials
            provider_controller = ToolManager.get_builtin_provider(provider_name)
            if not provider_controller.need_credentials:
                return builtin_tool.fork_tool_runtime(meta={
                    'tenant_id': tenant_id,
                    'credentials': {},
                }, agent_callback=agent_callback)

            # get credentials
            builtin_provider: BuiltinToolProvider = db.session.query(BuiltinToolProvider).filter(
                BuiltinToolProvider.tenant_id == tenant_id,
                BuiltinToolProvider.provider == provider_name,
            ).first()

            if builtin_provider is None:
                raise ToolProviderNotFoundError(f'builtin provider {provider_name} not found')
            
            # decrypt the credentials
            credentials = builtin_provider.credentials
            controller = ToolManager.get_builtin_provider(provider_name)
            tool_configuration = ToolConfiguration(tenant_id=tenant_id, provider_controller=controller)

            decrypted_credentials = tool_configuration.decrypt_tool_credentials(credentials)

            return builtin_tool.fork_tool_runtime(meta={
                'tenant_id': tenant_id,
                'credentials': decrypted_credentials,
                'runtime_parameters': {}
            }, agent_callback=agent_callback)
        
        elif provider_type == 'api':
            if tenant_id is None:
                raise ValueError('tenant id is required for api provider')
            
            api_provider, credentials = ToolManager.get_api_provider_controller(tenant_id, provider_name)

            # decrypt the credentials
            tool_configuration = ToolConfiguration(tenant_id=tenant_id, provider_controller=api_provider)
            decrypted_credentials = tool_configuration.decrypt_tool_credentials(credentials)

            return api_provider.get_tool(tool_name).fork_tool_runtime(meta={
                'tenant_id': tenant_id,
                'credentials': decrypted_credentials,
            })
        elif provider_type == 'app':
            raise NotImplementedError('app provider not implemented')
        else:
            raise ToolProviderNotFoundError(f'provider type {provider_type} not found')

    @staticmethod
    def get_builtin_provider_icon(provider: str) -> Tuple[str, str]:
        """
            get the absolute path of the icon of the builtin provider

            :param provider: the name of the provider

            :return: the absolute path of the icon, the mime type of the icon
        """
        # get provider
        provider_controller = ToolManager.get_builtin_provider(provider)

        absolute_path = path.join(path.dirname(path.realpath(__file__)), 'provider', 'builtin', provider, '_assets', provider_controller.identity.icon)
        # check if the icon exists
        if not path.exists(absolute_path):
            raise ToolProviderNotFoundError(f'builtin provider {provider} icon not found')
        
        # get the mime type
        mime_type, _ = mimetypes.guess_type(absolute_path)
        mime_type = mime_type or 'application/octet-stream'

        return absolute_path, mime_type

    @staticmethod
    def list_builtin_providers() -> List[BuiltinToolProviderController]:
        global _builtin_providers

        # use cache first
        if len(_builtin_providers) > 0:
            return list(_builtin_providers.values())
        
        builtin_providers: List[BuiltinToolProviderController] = []
        for provider in listdir(path.join(path.dirname(path.realpath(__file__)), 'provider', 'builtin')):
            if provider.startswith('__'):
                continue

            if path.isdir(path.join(path.dirname(path.realpath(__file__)), 'provider', 'builtin', provider)):
                if provider.startswith('__'):
                    continue

                py_path = path.join(path.dirname(path.realpath(__file__)), 'provider', 'builtin', provider, f'{provider}.py')
                spec = importlib.util.spec_from_file_location(f'core.tools.provider.builtin.{provider}.{provider}', py_path)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)

                # load all classes
                classes = [
                    obj for name, obj in vars(mod).items() 
                        if isinstance(obj, type) and obj != BuiltinToolProviderController and issubclass(obj, BuiltinToolProviderController)
                ]
                if len(classes) == 0:
                    raise ToolProviderNotFoundError(f'provider {provider} not found')
                if len(classes) > 1:
                    raise ToolProviderNotFoundError(f'multiple providers found for {provider}')
                
                # init provider
                provider_class = classes[0]
                builtin_providers.append(provider_class())

        # cache the builtin providers
        for provider in builtin_providers:
            _builtin_providers[provider.identity.name] = provider
            for tool in provider.get_tools():
                _builtin_tools_labels[tool.identity.name] = tool.identity.label

        return builtin_providers
    
    @staticmethod
    def get_tool_label(tool_name: str) -> Union[I18nObject, None]:
        """
            get the tool label

            :param tool_name: the name of the tool

            :return: the label of the tool
        """
        global _builtin_tools_labels
        if len(_builtin_tools_labels) == 0:
            # init the builtin providers
            ToolManager.list_builtin_providers()

        if tool_name not in _builtin_tools_labels:
            return None
        
        return _builtin_tools_labels[tool_name]
    
    @staticmethod
    def user_list_providers(
        user_id: str,
        tenant_id: str,
    ) -> List[UserToolProvider]:
        result_providers: Dict[str, UserToolProvider] = {}
        # get builtin providers
        builtin_providers = ToolManager.list_builtin_providers()
        # append builtin providers
        for provider in builtin_providers:
            result_providers[provider.identity.name] = UserToolProvider(
                id=provider.identity.name,
                author=provider.identity.author,
                name=provider.identity.name,
                description=I18nObject(
                    en_US=provider.identity.description.en_US,
                    zh_Hans=provider.identity.description.zh_Hans,
                ),
                icon=provider.identity.icon,
                label=I18nObject(
                    en_US=provider.identity.label.en_US,
                    zh_Hans=provider.identity.label.zh_Hans,
                ),
                type=UserToolProvider.ProviderType.BUILTIN,
                team_credentials={},
                is_team_authorization=False,
            )

            # get credentials schema
            schema = provider.get_credentials_schema()
            for name, value in schema.items():
                result_providers[provider.identity.name].team_credentials[name] = \
                    ToolProviderCredentials.CredentialsType.default(value.type)

            # check if the provider need credentials
            if not provider.need_credentials:
                result_providers[provider.identity.name].is_team_authorization = True
                result_providers[provider.identity.name].allow_delete = False

        # get db builtin providers
        db_builtin_providers: List[BuiltinToolProvider] = db.session.query(BuiltinToolProvider). \
            filter(BuiltinToolProvider.tenant_id == tenant_id).all()
        
        for db_builtin_provider in db_builtin_providers:
            # add provider into providers
            credentials = db_builtin_provider.credentials
            provider_name = db_builtin_provider.provider
            result_providers[provider_name].is_team_authorization = True

            # package builtin tool provider controller
            controller = ToolManager.get_builtin_provider(provider_name)

            # init tool configuration
            tool_configuration = ToolConfiguration(tenant_id=tenant_id, provider_controller=controller)
            # decrypt the credentials and mask the credentials
            decrypted_credentials = tool_configuration.decrypt_tool_credentials(credentials=credentials)
            masked_credentials = tool_configuration.mask_tool_credentials(credentials=decrypted_credentials)

            result_providers[provider_name].team_credentials = masked_credentials

        # get db api providers
        db_api_providers: List[ApiToolProvider] = db.session.query(ApiToolProvider). \
            filter(ApiToolProvider.tenant_id == tenant_id).all()
        
        for db_api_provider in db_api_providers:
            username = 'Anonymous'
            try:
                username = db_api_provider.user.name
            except Exception as e:
                logger.error(f'failed to get user name for api provider {db_api_provider.id}: {str(e)}')
            # add provider into providers
            credentials = db_api_provider.credentials
            provider_name = db_api_provider.name
            result_providers[provider_name] = UserToolProvider(
                id=db_api_provider.id,
                author=username,
                name=db_api_provider.name,
                description=I18nObject(
                    en_US=db_api_provider.description,
                    zh_Hans=db_api_provider.description,
                ),
                icon=db_api_provider.icon,
                label=I18nObject(
                    en_US=db_api_provider.name,
                    zh_Hans=db_api_provider.name,
                ),
                type=UserToolProvider.ProviderType.API,
                team_credentials={},
                is_team_authorization=True,
            )

            # package tool provider controller
            controller = ApiBasedToolProviderController.from_db(
                db_provider=db_api_provider,
                auth_type=ApiProviderAuthType.API_KEY if db_api_provider.credentials['auth_type'] == 'api_key' else ApiProviderAuthType.NONE
            )

            # init tool configuration
            tool_configuration = ToolConfiguration(tenant_id=tenant_id, provider_controller=controller)

            # decrypt the credentials and mask the credentials
            decrypted_credentials = tool_configuration.decrypt_tool_credentials(credentials=credentials)
            masked_credentials = tool_configuration.mask_tool_credentials(credentials=decrypted_credentials)

            result_providers[provider_name].team_credentials = masked_credentials

        return BuiltinToolProviderSort.sort(list(result_providers.values()))
    
    @staticmethod
    def get_api_provider_controller(tenant_id: str, provider_id: str) -> Tuple[ApiBasedToolProviderController, Dict[str, Any]]:
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
            provider, ApiProviderAuthType.API_KEY if provider.credentials['auth_type'] == 'api_key' else ApiProviderAuthType.NONE
        )
        controller.load_bundled_tools(provider.tools)

        return controller, provider.credentials
    
    @staticmethod
    def user_get_api_provider(provider: str, tenant_id: str) -> dict:
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
        tool_configuration = ToolConfiguration(tenant_id=tenant_id, provider_controller=controller)

        decrypted_credentials = tool_configuration.decrypt_tool_credentials(credentials)
        masked_credentials = tool_configuration.mask_tool_credentials(decrypted_credentials)

        try:
            icon = json.loads(provider.icon)
        except:
            icon = {
                "background": "#252525",
                "content": "\ud83d\ude01"
            }

        return json.loads(serialize_base_model_dict({
            'schema_type': provider.schema_type,
            'schema': provider.schema,
            'tools': provider.tools,
            'icon': icon,
            'description': provider.description,
            'credentials': masked_credentials,
            'privacy_policy': provider.privacy_policy
        }))