from core.tools.provider.tool import Tool
from core.tools.model.tool_model_manager import ToolModelManager
from core.tools.model.entities import ToolModelConfig
from core.model_runtime.entities.message_entities import PromptMessage
from core.model_runtime.entities.llm_entities import LLMResult

from typing import Dict, Any, List
from pydantic import BaseModel

class BuiltinTool(Tool):
    """
        Builtin tool

        :param meta: the meta data of a tool call processing
    """
    class Meta(BaseModel):
        """
            Meta data of a tool call processing
        """
        tenant_id: str = None
        tool_id: str = None
        credentials: Dict[str, Any] = None

    meta: Meta = None

    def fork_processing_tool(self, meta: Dict[str, Any]) -> 'BuiltinTool':
        """
            fork a new tool with meta data

            :param meta: the meta data of a tool call processing, tenant_id is required
            :return: the new tool
        """
        return self.__class__(
            identity=self.identity.copy() if self.identity else None,
            parameters=self.parameters.copy() if self.parameters else None,
            description=self.description.copy() if self.description else None,
            meta=BuiltinTool.Meta(**meta)
        )
    
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
            tenant_id=self.meta.tenant_id,
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
            tenant_id=self.meta.tenant_id,
        )

    def get_prompt_tokens(self, prompt_messages: List[PromptMessage]) -> int:
        """
            get prompt tokens

            :param prompt_messages: the prompt messages
            :return: the tokens
        """
        return ToolModelManager.calculate_tokens(
            tenant_id=self.meta.tenant_id,
            prompt_messages=prompt_messages
        )