from typing import List, Dict, Any
from os import listdir, path

from core.tools.entities.assistant_entities import AssistantAppMessage
from core.tools.provider.tool_provider import AssistantToolProvider
from core.tools.entities.constant import DEFAULT_PROVIDERS
from core.tools.errors import AssistantNotFoundError
from core.tools.provider.api_tool_provider import ApiBasedToolProvider
from core.tools.provider.app_tool_provider import AppBasedToolProvider
from core.model_runtime.entities.message_entities import PromptMessage

import importlib

class ToolManager:
    @staticmethod
    def invoke(
        provider: str,
        tool_id: int,
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
        provider_entity: AssistantToolProvider = None
        if provider == DEFAULT_PROVIDERS.API_BASED:
            provider_entity = ApiBasedToolProvider()
        elif provider == DEFAULT_PROVIDERS.APP_BASED:
            provider_entity = AppBasedToolProvider()

        if provider_entity is None:
            # fetch the provider from .provider.builtin
            py_path = path.join(path.dirname(path.realpath(__file__)), 'builtin', provider, f'{provider}.py')
            spec = importlib.util.spec_from_file_location(f'core.tools.provider.builtin.{provider}.{provider}', py_path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

            # get all the classes in the module
            classes = [x for _, x in vars(mod).items() if isinstance(x, type) and x != AssistantToolProvider and issubclass(x, AssistantToolProvider)]
            if len(classes) == 0:
                raise AssistantNotFoundError(f'provider {provider} not found')
            if len(classes) > 1:
                raise AssistantNotFoundError(f'multiple providers found for {provider}')
            
            provider_entity = classes[0]()

        return provider_entity.invoke(tool_id, tool_name, tool_parameters, credentials, prompt_messages)
    
    @staticmethod
    def list_providers() -> List[AssistantToolProvider]:
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
                classes = [obj for name, obj in vars(mod).items() if isinstance(obj, type) and obj != AssistantToolProvider and issubclass(obj, AssistantToolProvider)]
                if len(classes) == 0:
                    raise AssistantNotFoundError(f'provider {provider} not found')
                if len(classes) > 1:
                    raise AssistantNotFoundError(f'multiple providers found for {provider}')
                
                # init provider
                provider_class = classes[0]
                builtin_providers.append(provider_class())

        return [
            ApiBasedToolProvider(),
            AppBasedToolProvider(),
            *builtin_providers
        ]