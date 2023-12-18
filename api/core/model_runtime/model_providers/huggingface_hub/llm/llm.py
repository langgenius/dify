from typing import Optional, List, Union, Generator

from huggingface_hub import InferenceClient
from huggingface_hub.hf_api import HfApi
from huggingface_hub.utils import HfHubHTTPError

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.defaults import PARAMETER_RULE_TEMPLATE
from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage, LLMResultChunk, LLMResultChunkDelta, LLMMode
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool, AssistantPromptMessage
from core.model_runtime.entities.model_entities import ParameterRule, DefaultParameterName, AIModelEntity, ModelType, \
    FetchFrom
from core.model_runtime.errors.invoke import InvokeError, InvokeConnectionError, InvokeServerUnavailableError, \
    InvokeRateLimitError, \
    InvokeAuthorizationError, InvokeBadRequestError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel


class HuggingfaceHubLargeLanguageModel(LargeLanguageModel):
    def _invoke(self, model: str, credentials: dict, prompt_messages: list[PromptMessage], model_parameters: dict,
                tools: Optional[list[PromptMessageTool]] = None, stop: Optional[List[str]] = None, stream: bool = True,
                user: Optional[str] = None) -> Union[LLMResult, Generator]:

        client = InferenceClient(token=credentials['huggingfacehub_api_token'])

        if credentials['huggingfacehub_api_type'] == 'inference_endpoints':
            model = credentials['huggingfacehub_endpoint_url']

        response = client.text_generation(
            prompt=prompt_messages[0].content,
            details=True,
            stream=stream,
            model=model,
            stop_sequences=stop,
            **model_parameters)

        if stream:
            return self._handle_generate_stream_response(credentials['model'], response)

        return self._handle_generate_response(credentials['model'], response)

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
        if 'huggingfacehub_api_type' not in credentials:
            raise CredentialsValidateFailedError('Huggingface Hub Endpoint Type must be provided.')

        if 'huggingfacehub_api_token' not in credentials:
            raise CredentialsValidateFailedError('Huggingface Hub Access Token must be provided.')

        if 'model' not in credentials:
            raise CredentialsValidateFailedError('Huggingface Hub Model Name must be provided.')

        if credentials['huggingfacehub_api_type'] == 'inference_endpoints':
            if 'huggingfacehub_endpoint_url' not in credentials:
                raise CredentialsValidateFailedError('Huggingface Hub Endpoint URL must be provided.')

            if 'task_type' not in credentials:
                raise CredentialsValidateFailedError('Huggingface Hub Task Type must be provided.')
        elif credentials['huggingfacehub_api_type'] == 'hosted_inference_api':
            credentials['task_type'] = self._get_hosted_model_task_type(credentials['huggingfacehub_api_token'],
                                                                        credentials['model'])

        if credentials['task_type'] not in ("text2text-generation", "text-generation"):
            raise CredentialsValidateFailedError('Huggingface Hub Task Type must be one of text2text-generation, '
                                                 'text-generation.')

        client = InferenceClient(token=credentials['huggingfacehub_api_token'])

        if credentials['huggingfacehub_api_type'] == 'hosted_inference_api':
            model = credentials['model']
        elif credentials['huggingfacehub_api_type'] == 'inference_endpoints':
            model = credentials['huggingfacehub_endpoint_url']
        else:
            raise CredentialsValidateFailedError('Huggingface Hub Endpoint Type is invalid.')

        try:
            client.text_generation(
                prompt='Who are you?',
                stream=False,
                model=model)
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        return {
            InvokeConnectionError: [

            ],
            InvokeServerUnavailableError: [

            ],
            InvokeRateLimitError: [

            ],
            InvokeAuthorizationError: [

            ],
            InvokeBadRequestError: [
                HfHubHTTPError
            ]
        }

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        entity = AIModelEntity(
            model=credentials['model'],
            label=I18nObject(
                en_US=credentials['model']
            ),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.LLM,
            model_properties={
                'mode': LLMMode.COMPLETION
            },
            parameter_rules=self._get_customizable_model_parameter_rules()
        )

        return entity

    @staticmethod
    def _get_customizable_model_parameter_rules() -> list[ParameterRule]:
        temperature_rule_dict = PARAMETER_RULE_TEMPLATE.get(
            DefaultParameterName.TEMPERATURE).copy()
        temperature_rule_dict['name'] = 'temperature'
        temperature_rule = ParameterRule(**temperature_rule_dict)

        top_p_rule_dict = PARAMETER_RULE_TEMPLATE.get(DefaultParameterName.TOP_P).copy()
        top_p_rule_dict['name'] = 'top_p'
        top_p_rule = ParameterRule(**top_p_rule_dict)

        top_k_rule = ParameterRule(
            name='top_k',
            label={
                'en_US': 'Top K',
                'zh_Hans': 'Top K',
            },
            type='int',
            help={
                'en_US': 'The number of highest probability vocabulary tokens to keep for top-k-filtering.',
                'zh_Hans': '保留的最高概率词汇标记的数量。',
            },
            required=False,
            default=2,
            min=1,
            max=10,
            precision=0,
        )

        return [temperature_rule, top_k_rule, top_p_rule]

    def _handle_generate_stream_response(self, model: str,
                                         response: Generator) -> Generator:
        for chunk in response:
            # skip special tokens
            if chunk.token.special:
                continue

            yield LLMResultChunk(
                model=model,
                delta=LLMResultChunkDelta(
                    index=chunk.token.id,
                    message=AssistantPromptMessage(content=chunk.token.text),
                    usage=self._get_llm_usage(),
                ),
            )

    def _handle_generate_response(self, model: str, response: any) -> LLMResult:
        if isinstance(response, str):
            content = response
        else:
            content = response.generated_text

        usage = self._get_llm_usage()
        result = LLMResult(
            model=model,
            message=AssistantPromptMessage(content=content),
            usage=usage,
        )
        return result

    @staticmethod
    def _get_hosted_model_task_type(huggingfacehub_api_token: str, model_name: str):
        hf_api = HfApi(token=huggingfacehub_api_token)
        model_info = hf_api.model_info(repo_id=model_name)

        try:
            if not model_info:
                raise ValueError(f'Model {model_name} not found.')

            if 'inference' in model_info.cardData and not model_info.cardData['inference']:
                raise ValueError(f'Inference API has been turned off for this model {model_name}.')

            valid_tasks = ("text2text-generation", "text-generation")
            if model_info.pipeline_tag not in valid_tasks:
                raise ValueError(f"Model {model_name} is not a valid task, "
                                 f"must be one of {valid_tasks}.")
        except Exception as e:
            raise CredentialsValidateFailedError(f"{str(e)}")

        return model_info.pipeline_tag
