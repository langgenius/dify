import json
import os
from collections.abc import Mapping, Sequence
from enum import StrEnum, auto
from typing import TYPE_CHECKING, Any, cast

from core.app.app_config.entities import PromptTemplateEntity
from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.file import file_manager
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_runtime.entities.message_entities import (
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContentUnionTypes,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.prompt.prompt_transform import PromptTransform
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from models.model import AppMode

if TYPE_CHECKING:
    from core.file.models import File


class ModelMode(StrEnum):
    COMPLETION = auto()
    CHAT = auto()


prompt_file_contents: dict[str, Any] = {}


class SimplePromptTransform(PromptTransform):
    """
    Simple Prompt Transform for Chatbot App Basic Mode.
    """

    def get_prompt(
        self,
        app_mode: AppMode,
        prompt_template_entity: PromptTemplateEntity,
        inputs: Mapping[str, str],
        query: str,
        files: Sequence["File"],
        context: str | None,
        memory: TokenBufferMemory | None,
        model_config: ModelConfigWithCredentialsEntity,
        image_detail_config: ImagePromptMessageContent.DETAIL | None = None,
    ) -> tuple[list[PromptMessage], list[str] | None]:
        inputs = {key: str(value) for key, value in inputs.items()}

        model_mode = ModelMode(model_config.mode)
        if model_mode == ModelMode.CHAT:
            prompt_messages, stops = self._get_chat_model_prompt_messages(
                app_mode=app_mode,
                pre_prompt=prompt_template_entity.simple_prompt_template or "",
                inputs=inputs,
                query=query,
                files=files,
                context=context,
                memory=memory,
                model_config=model_config,
                image_detail_config=image_detail_config,
            )
        else:
            prompt_messages, stops = self._get_completion_model_prompt_messages(
                app_mode=app_mode,
                pre_prompt=prompt_template_entity.simple_prompt_template or "",
                inputs=inputs,
                query=query,
                files=files,
                context=context,
                memory=memory,
                model_config=model_config,
                image_detail_config=image_detail_config,
            )

        return prompt_messages, stops

    def _get_prompt_str_and_rules(
        self,
        app_mode: AppMode,
        model_config: ModelConfigWithCredentialsEntity,
        pre_prompt: str,
        inputs: dict,
        query: str | None = None,
        context: str | None = None,
        histories: str | None = None,
    ) -> tuple[str, dict]:
        # get prompt template
        prompt_template_config = self.get_prompt_template(
            app_mode=app_mode,
            provider=model_config.provider,
            model=model_config.model,
            pre_prompt=pre_prompt,
            has_context=context is not None,
            query_in_prompt=query is not None,
            with_memory_prompt=histories is not None,
        )

        custom_variable_keys_obj = prompt_template_config["custom_variable_keys"]
        special_variable_keys_obj = prompt_template_config["special_variable_keys"]

        # Type check for custom_variable_keys
        if not isinstance(custom_variable_keys_obj, list):
            raise TypeError(f"Expected list for custom_variable_keys, got {type(custom_variable_keys_obj)}")
        custom_variable_keys = cast(list[str], custom_variable_keys_obj)

        # Type check for special_variable_keys
        if not isinstance(special_variable_keys_obj, list):
            raise TypeError(f"Expected list for special_variable_keys, got {type(special_variable_keys_obj)}")
        special_variable_keys = cast(list[str], special_variable_keys_obj)

        variables = {k: inputs[k] for k in custom_variable_keys if k in inputs}

        for v in special_variable_keys:
            # support #context#, #query# and #histories#
            if v == "#context#":
                variables["#context#"] = context or ""
            elif v == "#query#":
                variables["#query#"] = query or ""
            elif v == "#histories#":
                variables["#histories#"] = histories or ""

        prompt_template = prompt_template_config["prompt_template"]
        if not isinstance(prompt_template, PromptTemplateParser):
            raise TypeError(f"Expected PromptTemplateParser, got {type(prompt_template)}")

        prompt = prompt_template.format(variables)

        prompt_rules = prompt_template_config["prompt_rules"]
        if not isinstance(prompt_rules, dict):
            raise TypeError(f"Expected dict for prompt_rules, got {type(prompt_rules)}")

        return prompt, prompt_rules

    def get_prompt_template(
        self,
        app_mode: AppMode,
        provider: str,
        model: str,
        pre_prompt: str,
        has_context: bool,
        query_in_prompt: bool,
        with_memory_prompt: bool = False,
    ) -> dict[str, object]:
        prompt_rules = self._get_prompt_rule(app_mode=app_mode, provider=provider, model=model)

        custom_variable_keys: list[str] = []
        special_variable_keys: list[str] = []

        prompt = ""
        for order in prompt_rules["system_prompt_orders"]:
            if order == "context_prompt" and has_context:
                prompt += prompt_rules["context_prompt"]
                special_variable_keys.append("#context#")
            elif order == "pre_prompt" and pre_prompt:
                prompt += pre_prompt + "\n"
                pre_prompt_template = PromptTemplateParser(template=pre_prompt)
                custom_variable_keys = pre_prompt_template.variable_keys
            elif order == "histories_prompt" and with_memory_prompt:
                prompt += prompt_rules["histories_prompt"]
                special_variable_keys.append("#histories#")

        if query_in_prompt:
            prompt += prompt_rules.get("query_prompt", "{{#query#}}")
            special_variable_keys.append("#query#")

        return {
            "prompt_template": PromptTemplateParser(template=prompt),
            "custom_variable_keys": custom_variable_keys,
            "special_variable_keys": special_variable_keys,
            "prompt_rules": prompt_rules,
        }

    def _get_chat_model_prompt_messages(
        self,
        app_mode: AppMode,
        pre_prompt: str,
        inputs: dict,
        query: str,
        context: str | None,
        files: Sequence["File"],
        memory: TokenBufferMemory | None,
        model_config: ModelConfigWithCredentialsEntity,
        image_detail_config: ImagePromptMessageContent.DETAIL | None = None,
    ) -> tuple[list[PromptMessage], list[str] | None]:
        prompt_messages: list[PromptMessage] = []

        # get prompt
        prompt, _ = self._get_prompt_str_and_rules(
            app_mode=app_mode,
            model_config=model_config,
            pre_prompt=pre_prompt,
            inputs=inputs,
            query=None,
            context=context,
        )

        if prompt and query:
            prompt_messages.append(SystemPromptMessage(content=prompt))

        if memory:
            prompt_messages = self._append_chat_histories(
                memory=memory,
                memory_config=MemoryConfig(
                    window=MemoryConfig.WindowConfig(
                        enabled=False,
                    )
                ),
                prompt_messages=prompt_messages,
                model_config=model_config,
            )

        if query:
            prompt_messages.append(self._get_last_user_message(query, files, image_detail_config))
        else:
            prompt_messages.append(self._get_last_user_message(prompt, files, image_detail_config))

        return prompt_messages, None

    def _get_completion_model_prompt_messages(
        self,
        app_mode: AppMode,
        pre_prompt: str,
        inputs: dict,
        query: str,
        context: str | None,
        files: Sequence["File"],
        memory: TokenBufferMemory | None,
        model_config: ModelConfigWithCredentialsEntity,
        image_detail_config: ImagePromptMessageContent.DETAIL | None = None,
    ) -> tuple[list[PromptMessage], list[str] | None]:
        # get prompt
        prompt, prompt_rules = self._get_prompt_str_and_rules(
            app_mode=app_mode,
            model_config=model_config,
            pre_prompt=pre_prompt,
            inputs=inputs,
            query=query,
            context=context,
        )

        if memory:
            tmp_human_message = UserPromptMessage(content=prompt)

            rest_tokens = self._calculate_rest_token([tmp_human_message], model_config)
            histories = self._get_history_messages_from_memory(
                memory=memory,
                memory_config=MemoryConfig(
                    window=MemoryConfig.WindowConfig(
                        enabled=False,
                    )
                ),
                max_token_limit=rest_tokens,
                human_prefix=prompt_rules.get("human_prefix", "Human"),
                ai_prefix=prompt_rules.get("assistant_prefix", "Assistant"),
            )

            # get prompt
            prompt, prompt_rules = self._get_prompt_str_and_rules(
                app_mode=app_mode,
                model_config=model_config,
                pre_prompt=pre_prompt,
                inputs=inputs,
                query=query,
                context=context,
                histories=histories,
            )

        stops = prompt_rules.get("stops")
        if stops is not None and len(stops) == 0:
            stops = None

        return [self._get_last_user_message(prompt, files, image_detail_config)], stops

    def _get_last_user_message(
        self,
        prompt: str,
        files: Sequence["File"],
        image_detail_config: ImagePromptMessageContent.DETAIL | None = None,
    ) -> UserPromptMessage:
        if files:
            prompt_message_contents: list[PromptMessageContentUnionTypes] = []
            for file in files:
                prompt_message_contents.append(
                    file_manager.to_prompt_message_content(file, image_detail_config=image_detail_config)
                )
            prompt_message_contents.append(TextPromptMessageContent(data=prompt))

            prompt_message = UserPromptMessage(content=prompt_message_contents)
        else:
            prompt_message = UserPromptMessage(content=prompt)

        return prompt_message

    def _get_prompt_rule(self, app_mode: AppMode, provider: str, model: str):
        """
        Get simple prompt rule.
        :param app_mode: app mode
        :param provider: model provider
        :param model: model name
        :return:
        """
        prompt_file_name = self._prompt_file_name(app_mode=app_mode, provider=provider, model=model)

        # Check if the prompt file is already loaded
        if prompt_file_name in prompt_file_contents:
            return cast(dict, prompt_file_contents[prompt_file_name])

        # Get the absolute path of the subdirectory
        prompt_path = os.path.join(os.path.dirname(os.path.realpath(__file__)), "prompt_templates")
        json_file_path = os.path.join(prompt_path, f"{prompt_file_name}.json")

        # Open the JSON file and read its content
        with open(json_file_path, encoding="utf-8") as json_file:
            content = json.load(json_file)

            # Store the content of the prompt file
            prompt_file_contents[prompt_file_name] = content

            return cast(dict, content)

    def _prompt_file_name(self, app_mode: AppMode, provider: str, model: str) -> str:
        # baichuan
        is_baichuan = False
        if provider == "baichuan":
            is_baichuan = True
        else:
            baichuan_supported_providers = ["huggingface_hub", "openllm", "xinference"]
            if provider in baichuan_supported_providers and "baichuan" in model.lower():
                is_baichuan = True

        if is_baichuan:
            if app_mode == AppMode.COMPLETION:
                return "baichuan_completion"
            else:
                return "baichuan_chat"

        # common
        if app_mode == AppMode.COMPLETION:
            return "common_completion"
        else:
            return "common_chat"
