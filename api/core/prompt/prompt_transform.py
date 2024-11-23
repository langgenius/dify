from typing import Optional

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities.message_entities import PromptMessage
from core.model_runtime.entities.model_entities import ModelPropertyKey
from core.prompt.entities.advanced_prompt_entities import MemoryConfig


class PromptTransform:
    def _append_chat_histories(
        self,
        memory: TokenBufferMemory,
        memory_config: MemoryConfig,
        prompt_messages: list[PromptMessage],
        model_config: ModelConfigWithCredentialsEntity,
    ) -> list[PromptMessage]:
        rest_tokens = self._calculate_rest_token(prompt_messages, model_config)
        histories = self._get_history_messages_list_from_memory(memory, memory_config, rest_tokens)
        prompt_messages.extend(histories)

        return prompt_messages

    def _calculate_rest_token(
        self, prompt_messages: list[PromptMessage], model_config: ModelConfigWithCredentialsEntity
    ) -> int:
        rest_tokens = 2000

        model_context_tokens = model_config.model_schema.model_properties.get(ModelPropertyKey.CONTEXT_SIZE)
        if model_context_tokens:
            model_instance = ModelInstance(
                provider_model_bundle=model_config.provider_model_bundle, model=model_config.model
            )

            curr_message_tokens = model_instance.get_llm_num_tokens(prompt_messages)

            max_tokens = 0
            for parameter_rule in model_config.model_schema.parameter_rules:
                if parameter_rule.name == "max_tokens" or (
                    parameter_rule.use_template and parameter_rule.use_template == "max_tokens"
                ):
                    max_tokens = (
                        model_config.parameters.get(parameter_rule.name)
                        or model_config.parameters.get(parameter_rule.use_template)
                    ) or 0

            rest_tokens = model_context_tokens - max_tokens - curr_message_tokens
            rest_tokens = max(rest_tokens, 0)

        return rest_tokens

    def _get_history_messages_from_memory(
        self,
        memory: TokenBufferMemory,
        memory_config: MemoryConfig,
        max_token_limit: int,
        human_prefix: Optional[str] = None,
        ai_prefix: Optional[str] = None,
    ) -> str:
        """Get memory messages."""
        kwargs = {"max_token_limit": max_token_limit}

        if human_prefix:
            kwargs["human_prefix"] = human_prefix

        if ai_prefix:
            kwargs["ai_prefix"] = ai_prefix

        if memory_config.window.enabled and memory_config.window.size is not None and memory_config.window.size > 0:
            kwargs["message_limit"] = memory_config.window.size

        return memory.get_history_prompt_text(**kwargs)

    def _get_history_messages_list_from_memory(
        self, memory: TokenBufferMemory, memory_config: MemoryConfig, max_token_limit: int
    ) -> list[PromptMessage]:
        """Get memory messages."""
        return memory.get_history_prompt_messages(
            max_token_limit=max_token_limit,
            message_limit=memory_config.window.size
            if (
                memory_config.window.enabled and memory_config.window.size is not None and memory_config.window.size > 0
            )
            else None,
        )
