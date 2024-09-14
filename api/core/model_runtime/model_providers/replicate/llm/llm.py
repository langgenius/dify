from collections.abc import Generator
from typing import Optional, Union

from replicate import Client as ReplicateClient
from replicate.exceptions import ReplicateError
from replicate.prediction import Prediction

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageRole,
    PromptMessageTool,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
    FetchFrom,
    ModelPropertyKey,
    ModelType,
    ParameterRule,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.model_providers.replicate._common import _CommonReplicate


class ReplicateLargeLanguageModel(_CommonReplicate, LargeLanguageModel):
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
        model_version = ""
        if "model_version" in credentials:
            model_version = credentials["model_version"]

        client = ReplicateClient(api_token=credentials["replicate_api_token"], timeout=30)
        model_info = client.models.get(model)

        if model_version:
            model_info_version = model_info.versions.get(model_version)
        else:
            model_info_version = model_info.latest_version

        inputs = {**model_parameters}

        if prompt_messages[0].role == PromptMessageRole.SYSTEM:
            if "system_prompt" in model_info_version.openapi_schema["components"]["schemas"]["Input"]["properties"]:
                inputs["system_prompt"] = prompt_messages[0].content
            inputs["prompt"] = prompt_messages[1].content
        else:
            inputs["prompt"] = prompt_messages[0].content

        prediction = client.predictions.create(version=model_info_version, input=inputs)

        if stream:
            return self._handle_generate_stream_response(model, credentials, prediction, stop, prompt_messages)
        return self._handle_generate_response(model, credentials, prediction, stop, prompt_messages)

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
        if "replicate_api_token" not in credentials:
            raise CredentialsValidateFailedError("Replicate Access Token must be provided.")

        model_version = ""
        if "model_version" in credentials:
            model_version = credentials["model_version"]

        if model.count("/") != 1:
            raise CredentialsValidateFailedError(
                "Replicate Model Name must be provided, format: {user_name}/{model_name}"
            )

        try:
            client = ReplicateClient(api_token=credentials["replicate_api_token"], timeout=30)
            model_info = client.models.get(model)

            if model_version:
                model_info_version = model_info.versions.get(model_version)
            else:
                model_info_version = model_info.latest_version

            self._check_text_generation_model(model_info_version, model, model_version, model_info.description)
        except ReplicateError as e:
            raise CredentialsValidateFailedError(
                f"Model {model}:{model_version} not exists, cause: {e.__class__.__name__}:{str(e)}"
            )
        except Exception as e:
            raise CredentialsValidateFailedError(str(e))

    @staticmethod
    def _check_text_generation_model(model_info_version, model_name, version, description):
        if "language model" in description.lower():
            return

        if (
            "temperature" not in model_info_version.openapi_schema["components"]["schemas"]["Input"]["properties"]
            or "top_p" not in model_info_version.openapi_schema["components"]["schemas"]["Input"]["properties"]
            or "top_k" not in model_info_version.openapi_schema["components"]["schemas"]["Input"]["properties"]
        ):
            raise CredentialsValidateFailedError(f"Model {model_name}:{version} is not a Text Generation model.")

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        model_type = LLMMode.CHAT if model.endswith("-chat") else LLMMode.COMPLETION

        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.LLM,
            model_properties={ModelPropertyKey.MODE: model_type.value},
            parameter_rules=self._get_customizable_model_parameter_rules(model, credentials),
        )

        return entity

    @classmethod
    def _get_customizable_model_parameter_rules(cls, model: str, credentials: dict) -> list[ParameterRule]:
        model_version = ""
        if "model_version" in credentials:
            model_version = credentials["model_version"]

        client = ReplicateClient(api_token=credentials["replicate_api_token"], timeout=30)
        model_info = client.models.get(model)

        if model_version:
            model_info_version = model_info.versions.get(model_version)
        else:
            model_info_version = model_info.latest_version

        parameter_rules = []

        input_properties = sorted(
            model_info_version.openapi_schema["components"]["schemas"]["Input"]["properties"].items(),
            key=lambda item: item[1].get("x-order", 0),
        )

        for key, value in input_properties:
            if key not in {"system_prompt", "prompt"} and "stop" not in key:
                value_type = value.get("type")

                if not value_type:
                    continue

                param_type = cls._get_parameter_type(value_type)

                rule = ParameterRule(
                    name=key,
                    label={"en_US": value["title"]},
                    type=param_type,
                    help={
                        "en_US": value.get("description"),
                    },
                    required=False,
                    default=value.get("default"),
                    min=value.get("minimum"),
                    max=value.get("maximum"),
                )
                parameter_rules.append(rule)

        return parameter_rules

    def _handle_generate_stream_response(
        self,
        model: str,
        credentials: dict,
        prediction: Prediction,
        stop: list[str],
        prompt_messages: list[PromptMessage],
    ) -> Generator:
        index = -1
        current_completion: str = ""
        stop_condition_reached = False

        prediction_output_length = 10000
        is_prediction_output_finished = False

        for output in prediction.output_iterator():
            current_completion += output

            if not is_prediction_output_finished and prediction.status == "succeeded":
                prediction_output_length = len(prediction.output) - 1
                is_prediction_output_finished = True

            if stop:
                for s in stop:
                    if s in current_completion:
                        prediction.cancel()
                        stop_index = current_completion.find(s)
                        current_completion = current_completion[:stop_index]
                        stop_condition_reached = True
                        break

            if stop_condition_reached:
                break

            index += 1

            assistant_prompt_message = AssistantPromptMessage(content=output or "")

            if index < prediction_output_length:
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(index=index, message=assistant_prompt_message),
                )
            else:
                prompt_tokens = self.get_num_tokens(model, credentials, prompt_messages)
                completion_tokens = self.get_num_tokens(model, credentials, [assistant_prompt_message])

                usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(index=index, message=assistant_prompt_message, usage=usage),
                )

    def _handle_generate_response(
        self,
        model: str,
        credentials: dict,
        prediction: Prediction,
        stop: list[str],
        prompt_messages: list[PromptMessage],
    ) -> LLMResult:
        current_completion: str = ""
        stop_condition_reached = False
        for output in prediction.output_iterator():
            current_completion += output

            if stop:
                for s in stop:
                    if s in current_completion:
                        prediction.cancel()
                        stop_index = current_completion.find(s)
                        current_completion = current_completion[:stop_index]
                        stop_condition_reached = True
                        break

            if stop_condition_reached:
                break

        assistant_prompt_message = AssistantPromptMessage(content=current_completion)

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

    @classmethod
    def _get_parameter_type(cls, param_type: str) -> str:
        type_mapping = {"integer": "int", "number": "float", "boolean": "boolean", "string": "string"}
        return type_mapping.get(param_type)

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
