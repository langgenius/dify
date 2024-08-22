import json
import logging
from collections.abc import Generator
from typing import Any, Optional, Union

import boto3

from core.model_runtime.entities.llm_entities import LLMMode, LLMResult
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageTool,
)
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, I18nObject, ModelType
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel

logger = logging.getLogger(__name__)


class SageMakerLargeLanguageModel(LargeLanguageModel):
    """
    Model class for Cohere large language model.
    """
    sagemaker_client: Any = None

    def _invoke(self, model: str, credentials: dict,
                prompt_messages: list[PromptMessage], model_parameters: dict,
                tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                stream: bool = True, user: Optional[str] = None) \
            -> Union[LLMResult, Generator]:
        """
        Invoke large language model

        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """
        # get model mode
        model_mode = self.get_model_mode(model, credentials)

        if not self.sagemaker_client:
            access_key = credentials.get('access_key')
            secret_key = credentials.get('secret_key')
            aws_region = credentials.get('aws_region')
            if aws_region:
                if access_key and secret_key:
                    self.sagemaker_client = boto3.client("sagemaker-runtime", 
                        aws_access_key_id=access_key,
                        aws_secret_access_key=secret_key,
                        region_name=aws_region)
                else:
                    self.sagemaker_client = boto3.client("sagemaker-runtime", region_name=aws_region)
            else:
                self.sagemaker_client = boto3.client("sagemaker-runtime")


        sagemaker_endpoint = credentials.get('sagemaker_endpoint')
        response_model = self.sagemaker_client.invoke_endpoint(
                    EndpointName=sagemaker_endpoint,
                    Body=json.dumps(
                    {
                        "inputs": prompt_messages[0].content,
                        "parameters": { "stop" : stop},
                        "history" : []
                    }
                    ),
                    ContentType="application/json",
                )

        assistant_text = response_model['Body'].read().decode('utf8')

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(
            content=assistant_text
        )

        usage = self._calc_response_usage(model, credentials, 0, 0)

        response = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=assistant_prompt_message,
            usage=usage
        )

        return response

    def get_num_tokens(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                       tools: Optional[list[PromptMessageTool]] = None) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :return:
        """
        # get model mode
        model_mode = self.get_model_mode(model)

        try:
            return 0
        except Exception as e:
            raise self._transform_invoke_error(e)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            # get model mode
            model_mode = self.get_model_mode(model)
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the error type thrown to the caller
        The value is the error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke error mapping
        """
        return {
            InvokeConnectionError: [
                InvokeConnectionError
            ],
            InvokeServerUnavailableError: [
                InvokeServerUnavailableError
            ],
            InvokeRateLimitError: [
                InvokeRateLimitError
            ],
            InvokeAuthorizationError: [
                InvokeAuthorizationError
            ],
            InvokeBadRequestError: [
                InvokeBadRequestError,
                KeyError,
                ValueError
            ]
        }

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity | None:
        """
            used to define customizable model schema
        """
        rules = [
            ParameterRule(
                name='temperature',
                type=ParameterType.FLOAT,
                use_template='temperature',
                label=I18nObject(
                    zh_Hans='温度',
                    en_US='Temperature'
                ),
            ),
            ParameterRule(
                name='top_p',
                type=ParameterType.FLOAT,
                use_template='top_p',
                label=I18nObject(
                    zh_Hans='Top P',
                    en_US='Top P'
                )
            ),
            ParameterRule(
                name='max_tokens',
                type=ParameterType.INT,
                use_template='max_tokens',
                min=1,
                max=credentials.get('context_length', 2048),
                default=512,
                label=I18nObject(
                    zh_Hans='最大生成长度',
                    en_US='Max Tokens'
                )
            )
        ]

        completion_type = LLMMode.value_of(credentials["mode"])

        if completion_type == LLMMode.CHAT:
            print(f"completion_type : {LLMMode.CHAT.value}") 

        if completion_type == LLMMode.COMPLETION:
            print(f"completion_type : {LLMMode.COMPLETION.value}") 

        features = []

        support_function_call = credentials.get('support_function_call', False)
        if support_function_call:
            features.append(ModelFeature.TOOL_CALL)

        support_vision = credentials.get('support_vision', False)
        if support_vision:
            features.append(ModelFeature.VISION)

        context_length = credentials.get('context_length', 2048)

        entity = AIModelEntity(
            model=model,
            label=I18nObject(
                en_US=model
            ),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.LLM,
            features=features,
            model_properties={
                ModelPropertyKey.MODE: completion_type,
                ModelPropertyKey.CONTEXT_SIZE: context_length
            },
            parameter_rules=rules
        )

        return entity
