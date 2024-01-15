from core.tools.provider.tool import Tool
from core.tools.model.tool_model_manager import ToolModelManager
from core.model_runtime.entities.message_entities import PromptMessage
from core.model_runtime.entities.llm_entities import LLMResult

from typing import List

class BuiltinTool(Tool):
    """
        Builtin tool

        :param meta: the meta data of a tool call processing
    """

    def invoke_model(
        self, user_id: str, prompt_messages: List[PromptMessage], stop: List[str]
    ) -> LLMResult:
        """
            invoke model

            :param model_config: the model config
            :param prompt_messages: the prompt messages
            :param stop: the stop words
            :return: the model result
        """
        # invoke model
        return ToolModelManager.invoke(
            user_id=user_id,
            tenant_id=self.runtime.tenant_id,
            tool_type='builtin',
            tool_name=self.identity.name,
            prompt_messages=prompt_messages,
        )
    
    def get_max_tokens(self) -> int:
        """
            get max tokens

            :param model_config: the model config
            :return: the max tokens
        """
        return ToolModelManager.get_max_llm_context_tokens(
            tenant_id=self.runtime.tenant_id,
        )

    def get_prompt_tokens(self, prompt_messages: List[PromptMessage]) -> int:
        """
            get prompt tokens

            :param prompt_messages: the prompt messages
            :return: the tokens
        """
        return ToolModelManager.calculate_tokens(
            tenant_id=self.runtime.tenant_id,
            prompt_messages=prompt_messages
        )