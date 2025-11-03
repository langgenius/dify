from typing import Union

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.model_manager import ModelInstance
from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from core.model_runtime.entities.message_entities import PromptMessageTool, SystemPromptMessage, UserPromptMessage


class FunctionCallMultiDatasetRouter:
    def invoke(
        self,
        query: str,
        dataset_tools: list[PromptMessageTool],
        model_config: ModelConfigWithCredentialsEntity,
        model_instance: ModelInstance,
    ) -> tuple[Union[str, None], LLMUsage]:
        """Given input, decided what to do.
        Returns:
            Action specifying what tool to use.
        """
        if len(dataset_tools) == 0:
            return None, LLMUsage.empty_usage()
        elif len(dataset_tools) == 1:
            return dataset_tools[0].name, LLMUsage.empty_usage()

        try:
            prompt_messages = [
                SystemPromptMessage(content="You are a helpful AI assistant."),
                UserPromptMessage(content=query),
            ]
            result: LLMResult = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                tools=dataset_tools,
                stream=False,
                model_parameters={"temperature": 0.2, "top_p": 0.3, "max_tokens": 1500},
            )
            usage = result.usage or LLMUsage.empty_usage()
            if result.message.tool_calls:
                # get retrieval model config
                return result.message.tool_calls[0].function.name, usage
            return None, usage
        except Exception:
            return None, LLMUsage.empty_usage()
