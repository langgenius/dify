from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional

from pydantic import BaseModel
from os import path, listdir
from yaml import load, FullLoader

from core.model_runtime.entities.message_entities import PromptMessage
from core.assistant.entities.assistant_entities import AssistantAppMessage, AssistantAppType, \
    AssistantToolProviderIdentity, AssistantToolParamter
from core.assistant.provider.assistant_tool import AssistantTool

import importlib

class AssistantToolProvider(BaseModel, ABC):
    identity: Optional[AssistantToolProviderIdentity] = None
    tools: Optional[List[AssistantTool]] = None

    def _get_bulitin_tools(self) -> List[AssistantTool]:
        """
            returns a list of tools that the provider can provide

            :return: list of tools
        """
        if self.tools:
            return self.tools
        
        provider = self.identity.name
        tool_path = path.join(path.dirname(path.realpath(__file__)), "builtin", provider, "tools")
        # get all the yaml files in the tool path
        tool_files = list(filter(lambda x: x.endswith(".yaml") and not x.startswith("__"), listdir(tool_path)))
        tools = []
        for tool_file in tool_files:
            with open(path.join(tool_path, tool_file), "r") as f:
                tool = load(f, FullLoader)
                # get tool class, import the module
                py_path = path.join(path.dirname(path.realpath(__file__)), 'builtin', provider, 'tools', f'{tool["identity"]["name"]}.py')
                spec = importlib.util.spec_from_file_location(f'core.assistant.provider.builtin.{provider}.tools.{tool["identity"]["name"]}', py_path)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)

                # get all the classes in the module
                classes = [x for _, x in vars(mod).items() if isinstance(x, type) and x != AssistantTool and issubclass(x, AssistantTool)]
                assistant_tool_class = classes[0]
                tools.append(assistant_tool_class(**tool))

        self.tools = tools
        return tools

    def get_tools(self) -> List[AssistantTool]:
        """
            returns a list of tools that the provider can provide

            :return: list of tools
        """
        if self.app_type == AssistantAppType.BUILT_IN:
            return self._get_bulitin_tools()
        
        # app based or api based will override this method
        raise NotImplementedError('get_tools should be implemented by the subclass')

    def get_parameters(self, tool_name: str) -> List[AssistantToolParamter]:
        """
            returns the parameters of the tool

            :param tool_name: the name of the tool, defined in `get_tools`
            :return: list of parameters
        """
        pass

    @property
    def app_type(self) -> AssistantAppType:
        """
            returns the type of the provider

            :return: type of the provider
        """
        return AssistantAppType.BUILT_IN

    def _invoke(
        self,
        tool_name: str,
        tool_paramters: Dict[str, Any],
        credentials: Dict[str, Any],
        prompt_messages: List[PromptMessage],
    ) -> List[AssistantAppMessage]:
        """
            should be implemented by the subclass

            tool_name: the name of the tool, defined in `get_tools`
            tool_paramters: the parameters of the tool
            credentials: the credentials of the tool
            prompt_messages: the prompt messages that the tool can use

            :return: the messages that the tool wants to send to the user
        """
        pass

    def invoke(
        self,
        tool_id: int,
        tool_name: str,
        tool_paramters: Dict[str, Any],
        credentials: Dict[str, Any],
        prompt_messages: List[PromptMessage],
    ) -> List[AssistantAppMessage]:
        """
            invoke will detect which type of assistant should be used and route the request to the correct method
        
            tool_name: the name of the tool, defined in `get_tools`
            tool_paramters: the parameters of the tool
            credentials: the credentials of the tool
            prompt_messages: the prompt messages that the tool can use

            :return: the messages that the tool wants to send to the user
        """
        if self.app_type == AssistantAppType.APP_BASED:
            # use app based assistant
            return self.invoke_app_based(tool_id, tool_name, tool_paramters, credentials, prompt_messages)
        elif self.app_type == AssistantAppType.API_BASED:
            # use api based assistant
            return self.invoke_api_based(tool_id, tool_name, tool_paramters, credentials, prompt_messages)
        else:
            # use built-in assistant, _invoke should be implemented by the subclass
            return self._invoke(tool_name, tool_paramters, credentials, prompt_messages)

    def invoke_app_based(
        self,
        tool_id: int,
        tool_name: str,
        tool_paramters: Dict[str, Any],
        credentials: Dict[str, Any],
        prompt_messages: List[PromptMessage],
    ) -> List[AssistantAppMessage]:
        """
            invoke app based assistant

            tool_name: the name of the tool, defined in `get_tools`
            tool_paramters: the parameters of the tool
            credentials: the credentials of the tool
            prompt_messages: the prompt messages that the tool can use

            :return: the messages that the tool wants to send to the user
        """
        raise NotImplementedError()

    def invoke_api_based(
        self,
        tool_id: int,
        tool_name: str,
        tool_paramters: Dict[str, Any],
        credentials: Dict[str, Any],
        prompt_messages: List[PromptMessage],
    ) -> List[AssistantAppMessage]:
        """
            invoke api based assistant

            tool_name: the name of the tool, defined in `get_tools`
            tool_paramters: the parameters of the tool
            credentials: the credentials of the tool
            prompt_messages: the prompt messages that the tool can use

            :return: the messages that the tool wants to send to the user
        """
        raise NotImplementedError()

    @abstractmethod
    def validate_parameters(self, tool_name: str, tool_parameters: Dict[str, Any]) -> None:
        """
            validate the parameters of the tool

            :param tool_name: the name of the tool, defined in `get_tools`
            :param tool_parameters: the parameters of the tool
        """
        pass

    @abstractmethod
    def validate_credentials(self, tool_name: str, credentials: Dict[str, Any]) -> None:
        """
            validate the credentials of the provider

            :param tool_name: the name of the tool, defined in `get_tools`
            :param credentials: the credentials of the tool
        """
        pass

    def create_image_message(self, image: str) -> AssistantAppMessage:
        """
            create an image message

            :param image: the url of the image
            :return: the image message
        """
        return AssistantAppMessage(type=AssistantAppMessage.AssistantAppMessageType.IMAGE, message=image)
    
    def create_link_message(self, link: str) -> AssistantAppMessage:
        """
            create a link message

            :param link: the url of the link
            :return: the link message
        """
        return AssistantAppMessage(type=AssistantAppMessage.AssistantAppMessageType.LINK, message=link)
    
    def create_text_message(self, text: str) -> AssistantAppMessage:
        """
            create a text message

            :param text: the text
            :return: the text message
        """
        return AssistantAppMessage(type=AssistantAppMessage.AssistantAppMessageType.TEXT, message=text)