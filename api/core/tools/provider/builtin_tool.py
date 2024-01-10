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

    meta: Meta = None

    def fork_processing_tool(self, meta: Dict[str, Any]) -> 'BuiltinTool':
        """
            fork a new tool with meta data

            :param meta: the meta data of a tool call processing, tenant_id is required
            :return: the new tool
        """
        return BuiltinTool(
            identity=self.identity.copy(),
            parameters=self.parameters.copy(),
            description=self.description.copy(),
            meta=BuiltinTool.Meta(**meta)
        )
    
    def invoke_model(
        self, user_id: str, model_config: dict, prompt_messages: List[PromptMessage], stop: List[str]
    ) -> LLMResult:
        """
            invoke model

            :param model_config: the model config
            :param prompt_messages: the prompt messages
            :param stop: the stop words
            :return: the model result
        """
        # parse model config
        model_config_entity = ToolModelConfig(**model_config)
        # invoke model
        return ToolModelManager.invoke(
            user_id=user_id,
            tenant_id=self.meta.tenant_id,
            model_config=model_config,
            tool_type='builtin',
            tool_name=self.identity.name,
            model_provider=model_config_entity.provider,
            model=model_config_entity.model,
            model_parameters=model_config_entity.model_parameters,
            prompt_messages=prompt_messages,
            stop=stop
        )