from collections.abc import Generator
from typing import Optional, Union

from huggingface_hub import InferenceClient  # type: ignore
from huggingface_hub.hf_api import HfApi  # type: ignore
from huggingface_hub.utils import BadRequestError  # type: ignore

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.defaults import PARAMETER_RULE_TEMPLATE
from core.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageTool,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
    DefaultParameterName,
    FetchFrom,
    ModelPropertyKey,
    ModelType,
    ParameterRule,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.model_providers.huggingface_hub._common import _CommonHuggingfaceHub


class HuggingfaceHubLargeLanguageModel(_CommonHuggingfaceHub, LargeLanguageModel):
    def _invoke(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[list[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
    ) -> Union[LLMResult, Generator]:
        client = InferenceClient(token=credentials["huggingfacehub_api_token"])

        if credentials["huggingfacehub_api_type"] == "inference_endpoints":
            model = credentials["huggingfacehub_endpoint_url"]

        if "baichuan" in model.lower():
            stream = False

        response = client.text_generation(
            prompt=prompt_messages[0].content,
            details=True,
            stream=stream,
            model=model,
            stop_sequences=stop,
            **model_parameters,
        )

        if stream:
            return self._handle_generate_stream_response(model, credentials, prompt_messages, response)

        return self._handle_generate_response(model, credentials, prompt_messages, response)

    def get_num_tokens(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]] = None,
    ) -> int:
        prompt = self._convert_messages_to_prompt(prompt_messages)
        return self._get_num_tokens_by_gpt2(prompt)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        try:
            if "huggingfacehub_api_type" not in credentials:
                raise CredentialsValidateFailedError("Huggingface Hub Endpoint Type must be provided.")

            if credentials["huggingfacehub_api_type"] not in {"inference_endpoints", "hosted_inference_api"}:
                raise CredentialsValidateFailedError("Huggingface Hub Endpoint Type is invalid.")

            if "huggingfacehub_api_token" not in credentials:
                raise CredentialsValidateFailedError("Huggingface Hub Access Token must be provided.")

            if credentials["huggingfacehub_api_type"] == "inference_endpoints":
                if "huggingfacehub_endpoint_url" not in credentials:
                    raise CredentialsValidateFailedError("Huggingface Hub Endpoint URL must be provided.")

                if "task_type" not in credentials:
                    raise CredentialsValidateFailedError("Huggingface Hub Task Type must be provided.")
            elif credentials["huggingfacehub_api_type"] == "hosted_inference_api":
                credentials["task_type"] = self._get_hosted_model_task_type(
                    credentials["huggingfacehub_api_token"], model
                )

            if credentials["task_type"] not in {"text2text-generation", "text-generation"}:
                raise CredentialsValidateFailedError(
                    "Huggingface Hub Task Type must be one of text2text-generation, text-generation."
                )

            client = InferenceClient(token=credentials["huggingfacehub_api_token"])

            if credentials["huggingfacehub_api_type"] == "inference_endpoints":
                model = credentials["huggingfacehub_endpoint_url"]

            try:
                client.text_generation(prompt="Who are you?", stream=True, model=model)
            except BadRequestError as e:
                raise CredentialsValidateFailedError(
                    "Only available for models running on with the `text-generation-inference`. "
                    "To learn more about the TGI project, please refer to https://github.com/huggingface/text-generation-inference."
                )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.LLM,
            model_properties={ModelPropertyKey.MODE: LLMMode.COMPLETION.value},
            parameter_rules=self._get_customizable_model_parameter_rules(),
        )

        return entity

    @staticmethod
    def _get_customizable_model_parameter_rules() -> list[ParameterRule]:
        temperature_rule_dict = PARAMETER_RULE_TEMPLATE.get(DefaultParameterName.TEMPERATURE).copy()
        temperature_rule_dict["name"] = "temperature"
        temperature_rule = ParameterRule(**temperature_rule_dict)
        temperature_rule.default = 0.5

        top_p_rule_dict = PARAMETER_RULE_TEMPLATE.get(DefaultParameterName.TOP_P).copy()
        top_p_rule_dict["name"] = "top_p"
        top_p_rule = ParameterRule(**top_p_rule_dict)
        top_p_rule.default = 0.5

        top_k_rule = ParameterRule(
            name="top_k",
            label={
                "en_US": "Top K",
                "zh_Hans": "Top K",
            },
            type="int",
            help={
                "en_US": "The number of highest probability vocabulary tokens to keep for top-k-filtering.",
                "zh_Hans": "保留的最高概率词汇标记的数量。",
            },
            required=False,
            default=2,
            min=1,
            max=10,
            precision=0,
        )

        max_new_tokens = ParameterRule(
            name="max_new_tokens",
            label={
                "en_US": "Max New Tokens",
                "zh_Hans": "最大新标记",
            },
            type="int",
            help={
                "en_US": "Maximum number of generated tokens.",
                "zh_Hans": "生成的标记的最大数量。",
            },
            required=False,
            default=20,
            min=1,
            max=4096,
            precision=0,
        )

        seed = ParameterRule(
            name="seed",
            label={
                "en_US": "Random sampling seed",
                "zh_Hans": "随机采样种子",
            },
            type="int",
            help={
                "en_US": "Random sampling seed.",
                "zh_Hans": "随机采样种子。",
            },
            required=False,
            precision=0,
        )

        repetition_penalty = ParameterRule(
            name="repetition_penalty",
            label={
                "en_US": "Repetition Penalty",
                "zh_Hans": "重复惩罚",
            },
            type="float",
            help={
                "en_US": "The parameter for repetition penalty. 1.0 means no penalty.",
                "zh_Hans": "重复惩罚的参数。1.0 表示没有惩罚。",
            },
            required=False,
            precision=1,
        )

        return [temperature_rule, top_k_rule, top_p_rule, max_new_tokens, seed, repetition_penalty]

    def _handle_generate_stream_response(
        self, model: str, credentials: dict, prompt_messages: list[PromptMessage], response: Generator
    ) -> Generator:
        index = -1
        for chunk in response:
            # skip special tokens
            if chunk.token.special:
                continue

            index += 1

            assistant_prompt_message = AssistantPromptMessage(content=chunk.token.text)

            if chunk.details:
                prompt_tokens = self.get_num_tokens(model, credentials, prompt_messages)
                completion_tokens = self.get_num_tokens(model, credentials, [assistant_prompt_message])

                usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index,
                        message=assistant_prompt_message,
                        usage=usage,
                        finish_reason=chunk.details.finish_reason,
                    ),
                )
            else:
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index,
                        message=assistant_prompt_message,
                    ),
                )

    def _handle_generate_response(
        self, model: str, credentials: dict, prompt_messages: list[PromptMessage], response: any
    ) -> LLMResult:
        if isinstance(response, str):
            content = response
        else:
            content = response.generated_text

        assistant_prompt_message = AssistantPromptMessage(content=content)

        prompt_tokens = self.get_num_tokens(model, credentials, prompt_messages)
        completion_tokens = self.get_num_tokens(model, credentials, [assistant_prompt_message])

        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        result = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=assistant_prompt_message,
            usage=usage,
        )
        return result

    @staticmethod
    def _get_hosted_model_task_type(huggingfacehub_api_token: str, model_name: str):
        hf_api = HfApi(token=huggingfacehub_api_token)
        model_info = hf_api.model_info(repo_id=model_name)

        try:
            if not model_info:
                raise ValueError(f"Model {model_name} not found.")

            if "inference" in model_info.cardData and not model_info.cardData["inference"]:
                raise ValueError(f"Inference API has been turned off for this model {model_name}.")

            valid_tasks = ("text2text-generation", "text-generation")
            if model_info.pipeline_tag not in valid_tasks:
                raise ValueError(f"Model {model_name} is not a valid task, must be one of {valid_tasks}.")
        except Exception as e:
            raise CredentialsValidateFailedError(f"{str(e)}")

        return model_info.pipeline_tag

    def _convert_messages_to_prompt(self, messages: list[PromptMessage]) -> str:
        messages = messages.copy()  # don't mutate the original list

        text = "".join(self._convert_one_message_to_text(message) for message in messages)

        return text.rstrip()

    @staticmethod
    def _convert_one_message_to_text(message: PromptMessage) -> str:
        human_prompt = "\n\nHuman:"
        ai_prompt = "\n\nAssistant:"
        content = message.content

        if isinstance(message, UserPromptMessage):
            message_text = f"{human_prompt} {content}"
        elif isinstance(message, AssistantPromptMessage):
            message_text = f"{ai_prompt} {content}"
        elif isinstance(message, SystemPromptMessage):
            message_text = content
        else:
            raise ValueError(f"Got unknown type {message}")

        return message_text
