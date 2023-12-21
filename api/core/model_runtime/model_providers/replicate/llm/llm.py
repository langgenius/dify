from typing import Optional, List, Union, Generator

from replicate import Client as ReplicateClient
from replicate.exceptions import ReplicateError, ModelError
from replicate.prediction import Prediction

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage, LLMMode, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool, AssistantPromptMessage, \
    PromptMessageRole
from core.model_runtime.entities.model_entities import ParameterRule, AIModelEntity, FetchFrom, ModelType
from core.model_runtime.errors.invoke import InvokeError, InvokeBadRequestError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel


class ReplicateLargeLanguageModel(LargeLanguageModel):

    def _invoke(self, model: str, credentials: dict, prompt_messages: list[PromptMessage], model_parameters: dict,
                tools: Optional[list[PromptMessageTool]] = None, stop: Optional[List[str]] = None, stream: bool = True,
                user: Optional[str] = None) -> Union[LLMResult, Generator]:

        model_name = credentials['model']
        version = credentials['model_version']

        client = ReplicateClient(api_token=credentials['replicate_api_token'])
        model_info = client.models.get(model_name)
        model_info_version = model_info.versions.get(version)

        inputs = {**model_parameters}

        if prompt_messages[0].role == PromptMessageRole.SYSTEM:
            if 'system_prompt' in model_info_version.openapi_schema['components']['schemas']['Input']['properties']:
                inputs['system_prompt'] = prompt_messages[0].content
            inputs['prompt'] = prompt_messages[1].content
        else:
            inputs['prompt'] = prompt_messages[0].content

        prediction = client.predictions.create(
            version=model_info_version, input=inputs
        )

        if stream:
            return self._handle_generate_stream_response(model, prediction, stop)
        return self._handle_generate_response(model, prediction, stop)

    @staticmethod
    def _get_llm_usage():
        usage = LLMUsage(
            prompt_tokens=0,
            prompt_unit_price=0,
            prompt_price_unit=0,
            prompt_price=0,
            completion_tokens=0,
            completion_unit_price=0,
            completion_price_unit=0,
            completion_price=0,
            total_tokens=0,
            total_price=0,
            currency='USD',
            latency=0,
        )
        return usage

    def get_num_tokens(self, model: str, prompt_messages: list[PromptMessage],
                       tools: Optional[list[PromptMessageTool]] = None) -> int:
        return 0

    def validate_credentials(self, model: str, credentials: dict) -> None:
        if 'replicate_api_token' not in credentials:
            raise CredentialsValidateFailedError('Replicate Access Token must be provided.')

        if 'model' not in credentials:
            raise CredentialsValidateFailedError('Replicate Model must be provided.')

        if 'model_version' not in credentials:
            raise CredentialsValidateFailedError('Replicate Model Version must be provided.')

        if credentials['model'].count("/") != 1:
            raise CredentialsValidateFailedError('Replicate Model Name must be provided, '
                                                 'format: {user_name}/{model_name}')

        model_name = credentials['model']
        version = credentials['model_version']

        try:
            client = ReplicateClient(api_token=credentials['replicate_api_token'])
            model_info = client.models.get(model_name)
            model_info_version = model_info.versions.get(version)

            self._check_text_generation_model(model_info_version, model_name, version)
        except ReplicateError as e:
            raise CredentialsValidateFailedError(
                f"Model {model_name}:{version} not exists, cause: {e.__class__.__name__}:{str(e)}")
        except Exception as e:
            raise CredentialsValidateFailedError(str(e))

    @staticmethod
    def _check_text_generation_model(model_info_version, model_name, version):
        if 'temperature' not in model_info_version.openapi_schema['components']['schemas']['Input']['properties'] \
                or 'top_p' not in model_info_version.openapi_schema['components']['schemas']['Input']['properties'] \
                or 'top_k' not in model_info_version.openapi_schema['components']['schemas']['Input']['properties']:
            raise CredentialsValidateFailedError(f"Model {model_name}:{version} is not a Text Generation model.")

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        model_name = credentials['model']
        model_type = LLMMode.CHAT if model_name.endswith('-chat') else LLMMode.COMPLETION

        entity = AIModelEntity(
            model=model_name,
            label=I18nObject(
                en_US=model_name
            ),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.LLM,
            model_properties={
                'mode': model_type
            },
            parameter_rules=self._get_customizable_model_parameter_rules(credentials)
        )

        return entity

    @classmethod
    def _get_customizable_model_parameter_rules(cls, credentials: dict) -> list[ParameterRule]:
        model_name = credentials['model']
        version = credentials['model_version']

        client = ReplicateClient(api_token=credentials['replicate_api_token'])
        model_info = client.models.get(model_name)
        model_info_version = model_info.versions.get(version)

        parameter_rules = []

        for key, value in model_info_version.openapi_schema['components']['schemas']['Input']['properties'].items():
            if key not in ['system_prompt', 'prompt']:
                param_type = cls._get_parameter_type(value['type'])

                rule = ParameterRule(
                    name=key,
                    label={
                        'en_US': value['title']
                    },
                    type=param_type,
                    help={
                        'en_US': value.get('description'),
                    },
                    required=False,
                    default=value.get('default'),
                    min=value.get('minimum'),
                    max=value.get('maximum')
                )
                parameter_rules.append(rule)

        return parameter_rules

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        return {
            InvokeBadRequestError: [
                ReplicateError,
                ModelError
            ]
        }

    def _handle_generate_stream_response(self, model: str,
                                         prediction: Prediction, stop: list[str]) -> Generator:
        index = 0
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

            yield LLMResultChunk(
                model=model,
                delta=LLMResultChunkDelta(
                    index=index,
                    message=AssistantPromptMessage(content=output),
                    usage=self._get_llm_usage(),
                ),
            )
            index += 1

    def _handle_generate_response(self, model: str, prediction: Prediction, stop: list[str]) -> LLMResult:
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

        usage = self._get_llm_usage()
        result = LLMResult(
            model=model,
            message=AssistantPromptMessage(content=current_completion),
            usage=usage,
        )

        return result

    @classmethod
    def _get_parameter_type(cls, param_type: str) -> str:
        if param_type == 'integer':
            return 'int'
        elif param_type == 'number':
            return 'float'
        elif param_type == 'boolean':
            return 'boolean'
        elif param_type == 'string':
            return 'string'
