from typing import List, Dict, Any
from os import listdir, path

from core.tools.entities.tool_entities import AssistantAppMessage
from core.tools.provider.tool_provider import ToolProviderController
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.entities.constant import DEFAULT_PROVIDERS
from core.tools.entities.common_entities import I18nObject
from core.tools.errors import ToolProviderNotFoundError
from core.tools.provider.api_tool_provider import ApiBasedToolProviderEntity
from core.tools.provider.app_tool_provider import AppBasedToolProviderEntity
from core.tools.entities.user_entities import UserToolProvider

from core.model_runtime.entities.message_entities import PromptMessage

from extensions.ext_database import db

from models.tools import ApiToolProvider, BuiltinToolProvider

import importlib

_builtin_providers = {}

class ToolManager:
    @staticmethod
    def invoke(
        provider: str,
        tool_id: str,
        tool_name: str,
        tool_parameters: Dict[str, Any],
        credentials: Dict[str, Any],
        prompt_messages: List[PromptMessage],
    ) -> List[AssistantAppMessage]:
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
            provider_entity = ApiBasedToolProviderEntity()
        elif provider == DEFAULT_PROVIDERS.APP_BASED:
            provider_entity = AppBasedToolProviderEntity()

        if provider_entity is None:
            # fetch the provider from .provider.builtin
            py_path = path.join(path.dirname(path.realpath(__file__)), 'builtin', provider, f'{provider}.py')
            spec = importlib.util.spec_from_file_location(f'core.tools.provider.builtin.{provider}.{provider}', py_path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

            # get all the classes in the module
            classes = [x for _, x in vars(mod).items() if isinstance(x, type) and x != ToolProviderController and issubclass(x, ToolProviderController)]
            if len(classes) == 0:
                raise ToolProviderNotFoundError(f'provider {provider} not found')
            if len(classes) > 1:
                raise ToolProviderNotFoundError(f'multiple providers found for {provider}')
            
            provider_entity = classes[0]()

        return provider_entity.invoke(tool_id, tool_name, tool_parameters, credentials, prompt_messages)
    
    @staticmethod
    def get_builtin_provider(provider: str) -> ToolProviderController:
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
    def list_builtin_providers() -> List[BuiltinToolProviderController]:
        global _builtin_providers


        # use cache first
        if len(_builtin_providers) > 0:
            return list(_builtin_providers.values())
        
        builtin_providers = []
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
        return builtin_providers
    
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

        # get db builtin providers
        db_builtin_providers: List[BuiltinToolProvider] = db.session.query(BuiltinToolProvider). \
            filter(BuiltinToolProvider.tenant_id == tenant_id).all()
        
        for db_builtin_provider in db_builtin_providers:
            # add provider into providers
            credentails = db_builtin_provider.credentials
            provider_name = db_builtin_provider.provider
            result_providers[provider_name].is_team_authorization = True

            for name, value in credentails.items():
                if len(value) <= 6:
                    value = '******'
                else:
                    value = value[:3] + '******' + value[-3:]
                
                # overwrite the result_providers
                result_providers[provider_name].team_credentials[name] = value

        # get db api providers
        db_api_providers: List[ApiToolProvider] = db.session.query(ApiToolProvider). \
            filter(ApiToolProvider.tenant_id == tenant_id).all()
        
        for db_api_provider in db_api_providers:
            # add provider into providers
            credentails = db_api_provider.credentials
            provider_name = db_api_provider.name
            result_providers[provider_name] = UserToolProvider(
                author=db_api_provider.tanent.name,
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

            for name, value in credentails.items():
                if len(value) <= 6:
                    value = '******'
                else:
                    value = value[:3] + '******' + value[-3:]
                
                # overwrite the result_providers
                result_providers[provider_name].team_credentials[name] = value

        return list(result_providers.values())