from typing import List, Dict, Any
from os import listdir, path

from core.assistant.entities.assistant_entities import AssistantAppMessage, AssistantAppType
from core.assistant.provider.assistant_tool import AssistantTool
from core.assistant.provider.tool_provider import AssistantToolProvider
from core.assistant.entities.constant import DEFAULT_PROVIDERS
from core.assistant.errors import AssistantNotFoundError
from core.assistant.provider.api_tool_provider import ApiBasedToolProvider
from core.assistant.provider.app_tool_provider import AppBasedToolProvider
from core.model_runtime.entities.message_entities import PromptMessage

from yaml import load, FullLoader

import importlib

class AssistantManager:
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
            module = importlib.import_module(f'core.assistant.provider.builtin.{provider}.{provider}')
            # get all the classes in the module
            classes = [getattr(module, x) for x in dir(module) if issubclass(getattr(module, x), AssistantToolProvider)]
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
                spec = importlib.util.spec_from_file_location(f'core.assistant.provider.builtin.{provider}.{provider}', py_path)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)

                # load all classes
                classes = [obj for name, obj in vars(mod).items() if isinstance(obj, type) and obj != AssistantToolProvider and issubclass(obj, AssistantToolProvider)]
                if len(classes) == 0:
                    raise AssistantNotFoundError(f'provider {provider} not found')
                if len(classes) > 1:
                    raise AssistantNotFoundError(f'multiple providers found for {provider}')
                
                # load provider yaml
                yaml_path = path.join(path.dirname(path.realpath(__file__)), 'provider', 'builtin', provider, f'{provider}.yaml')
                try:
                    with open(yaml_path, 'r') as f:
                        provider_yaml = load(f.read(), FullLoader)
                except:
                    raise AssistantNotFoundError(f'can not load provider yaml for {provider}')
                
                # init provider
                provider_class = classes[0]
                builtin_providers.append(provider_class(**{
                    'identity': provider_yaml['identity'],
                }))

        return [
            ApiBasedToolProvider(),
            AppBasedToolProvider(),
            *builtin_providers
        ]