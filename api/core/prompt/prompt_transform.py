from typing import Any

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities.message_entities import PromptMessage
from core.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey
from core.prompt.entities.advanced_prompt_entities import MemoryConfig


class PromptTransform:
    def _resolve_model_runtime(
        self,
        *,
        model_config: ModelConfigWithCredentialsEntity | None = None,
        model_instance: ModelInstance | None = None,
    ) -> tuple[ModelInstance, AIModelEntity]:
        if model_instance is None:
            if model_config is None:
                raise ValueError("Either model_config or model_instance must be provided.")
            model_instance = ModelInstance(
                provider_model_bundle=model_config.provider_model_bundle, model=model_config.model
            )
            model_instance.credentials = model_config.credentials
            model_instance.parameters = model_config.parameters
            model_instance.stop = model_config.stop

        model_schema = model_instance.model_type_instance.get_model_schema(
            model=model_instance.model_name,
            credentials=model_instance.credentials,
        )
        if model_schema is None:
            if model_config is None:
                raise ValueError("Model schema not found for the provided model instance.")
            model_schema = model_config.model_schema

        return model_instance, model_schema

    def _append_chat_histories(
        self,
        memory: TokenBufferMemory,
        memory_config: MemoryConfig,
        prompt_messages: list[PromptMessage],
        *,
        model_config: ModelConfigWithCredentialsEntity | None = None,
        model_instance: ModelInstance | None = None,
    ) -> list[PromptMessage]:
        rest_tokens = self._calculate_rest_token(
            prompt_messages,
            model_config=model_config,
            model_instance=model_instance,
        )
        histories = self._get_history_messages_list_from_memory(memory, memory_config, rest_tokens)
        prompt_messages.extend(histories)

        return prompt_messages

    def _calculate_rest_token(
        self,
        prompt_messages: list[PromptMessage],
        *,
        model_config: ModelConfigWithCredentialsEntity | None = None,
        model_instance: ModelInstance | None = None,
    ) -> int:
        model_instance, model_schema = self._resolve_model_runtime(
            model_config=model_config,
            model_instance=model_instance,
        )
        model_parameters = model_instance.parameters
        rest_tokens = 2000

        model_context_tokens = model_schema.model_properties.get(ModelPropertyKey.CONTEXT_SIZE)
        if model_context_tokens:
            curr_message_tokens = model_instance.get_llm_num_tokens(prompt_messages)

            max_tokens = 0
            for parameter_rule in model_schema.parameter_rules:
                if parameter_rule.name == "max_tokens" or (
                    parameter_rule.use_template and parameter_rule.use_template == "max_tokens"
                ):
                    max_tokens = (
                        model_parameters.get(parameter_rule.name)
                        or model_parameters.get(parameter_rule.use_template or "")
                    ) or 0

            rest_tokens = model_context_tokens - max_tokens - curr_message_tokens
            rest_tokens = max(rest_tokens, 0)

        return rest_tokens

    def _get_history_messages_from_memory(
        self,
        memory: TokenBufferMemory,
        memory_config: MemoryConfig,
        max_token_limit: int,
        human_prefix: str | None = None,
        ai_prefix: str | None = None,
    ) -> str:
        """Get memory messages."""
        kwargs: dict[str, Any] = {"max_token_limit": max_token_limit}

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
        return list(
            memory.get_history_prompt_messages(
                max_token_limit=max_token_limit,
                message_limit=memory_config.window.size
                if (
                    memory_config.window.enabled
                    and memory_config.window.size is not None
                    and memory_config.window.size > 0
                )
                else None,
            )
        )
