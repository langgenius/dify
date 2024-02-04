import json
import logging
import re
from decimal import Decimal
from typing import Generator, List, Optional, Union, cast
from urllib.parse import urljoin

import requests
from core.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (AssistantPromptMessage, ImagePromptMessageContent,
                                                          PromptMessage, PromptMessageContentType, PromptMessageTool,
                                                          SystemPromptMessage, TextPromptMessageContent,
                                                          UserPromptMessage)
from core.model_runtime.entities.model_entities import (AIModelEntity, DefaultParameterName, FetchFrom, I18nObject,
                                                        ModelFeature, ModelPropertyKey, ModelType, ParameterRule,
                                                        ParameterType, PriceConfig)
from core.model_runtime.errors.invoke import (InvokeAuthorizationError, InvokeBadRequestError, InvokeConnectionError,
                                              InvokeError, InvokeRateLimitError, InvokeServerUnavailableError)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel

logger = logging.getLogger(__name__)


class OllamaLargeLanguageModel(LargeLanguageModel):
    """
    Model class for Ollama large language model.
    """

    def _invoke(self, model: str, credentials: dict,
                prompt_messages: list[PromptMessage], model_parameters: dict,
                tools: Optional[list[PromptMessageTool]] = None, stop: Optional[List[str]] = None,
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
        return self._generate(
            model=model,
            credentials=credentials,
            prompt_messages=prompt_messages,
            model_parameters=model_parameters,
            stop=stop,
            stream=stream,
            user=user
        )

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
        model_mode = self.get_model_mode(model, credentials)

        if model_mode == LLMMode.CHAT:
            # chat model
            return self._num_tokens_from_messages(prompt_messages)
        else:
            first_prompt_message = prompt_messages[0]
            if isinstance(first_prompt_message.content, str):
                text = first_prompt_message.content
            else:
                text = ''
                for message_content in first_prompt_message.content:
                    if message_content.type == PromptMessageContentType.TEXT:
                        message_content = cast(TextPromptMessageContent, message_content)
                        text = message_content.data
                        break
            return self._get_num_tokens_by_gpt2(text)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            self._generate(
                model=model,
                credentials=credentials,
                prompt_messages=[UserPromptMessage(content="ping")],
                model_parameters={
                    'num_predict': 5
                },
                stream=False
            )
        except InvokeError as ex:
            raise CredentialsValidateFailedError(f'An error occurred during credentials validation: {ex.description}')
        except Exception as ex:
            raise CredentialsValidateFailedError(f'An error occurred during credentials validation: {str(ex)}')

    def _generate(self, model: str, credentials: dict,
                  prompt_messages: list[PromptMessage], model_parameters: dict, stop: Optional[List[str]] = None,
                  stream: bool = True, user: Optional[str] = None) -> Union[LLMResult, Generator]:
        """
        Invoke llm completion model

        :param model: model name
        :param credentials: credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """
        headers = {
            'Content-Type': 'application/json'
        }

        endpoint_url = credentials['base_url']
        if not endpoint_url.endswith('/'):
            endpoint_url += '/'

        # prepare the payload for a simple ping to the model
        data = {
            'model': model,
            'stream': stream
        }

        if 'format' in model_parameters:
            data['format'] = model_parameters['format']
            del model_parameters['format']

        data['options'] = model_parameters or {}

        if stop:
            data['stop'] = "\n".join(stop)

        completion_type = LLMMode.value_of(credentials['mode'])

        if completion_type is LLMMode.CHAT:
            endpoint_url = urljoin(endpoint_url, 'api/chat')
            data['messages'] = [self._convert_prompt_message_to_dict(m) for m in prompt_messages]
        else:
            endpoint_url = urljoin(endpoint_url, 'api/generate')
            first_prompt_message = prompt_messages[0]
            if isinstance(first_prompt_message, UserPromptMessage):
                first_prompt_message = cast(UserPromptMessage, first_prompt_message)
                if isinstance(first_prompt_message.content, str):
                    data['prompt'] = first_prompt_message.content
                else:
                    text = ''
                    images = []
                    for message_content in first_prompt_message.content:
                        if message_content.type == PromptMessageContentType.TEXT:
                            message_content = cast(TextPromptMessageContent, message_content)
                            text = message_content.data
                        elif message_content.type == PromptMessageContentType.IMAGE:
                            message_content = cast(ImagePromptMessageContent, message_content)
                            image_data = re.sub(r'^data:image\/[a-zA-Z]+;base64,', '', message_content.data)
                            images.append(image_data)

                    data['prompt'] = text
                    data['images'] = images

        # send a post request to validate the credentials
        response = requests.post(
            endpoint_url,
            headers=headers,
            json=data,
            timeout=(10, 60),
            stream=stream
        )

        response.encoding = "utf-8"
        if response.status_code != 200:
            raise InvokeError(f"API request failed with status code {response.status_code}: {response.text}")

        if stream:
            return self._handle_generate_stream_response(model, credentials, completion_type, response, prompt_messages)

        return self._handle_generate_response(model, credentials, completion_type, response, prompt_messages)

    def _handle_generate_response(self, model: str, credentials: dict, completion_type: LLMMode,
                                  response: requests.Response, prompt_messages: list[PromptMessage]) -> LLMResult:
        """
        Handle llm completion response

        :param model: model name
        :param credentials: model credentials
        :param completion_type: completion type
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm result
        """
        response_json = response.json()

        if completion_type is LLMMode.CHAT:
            message = response_json.get('message', {})
            response_content = message.get('content', '')
        else:
            response_content = response_json['response']

        assistant_message = AssistantPromptMessage(content=response_content)

        if 'prompt_eval_count' in response_json and 'eval_count' in response_json:
            # transform usage
            prompt_tokens = response_json["prompt_eval_count"]
            completion_tokens = response_json["eval_count"]
        else:
            # calculate num tokens
            prompt_tokens = self._get_num_tokens_by_gpt2(prompt_messages[0].content)
            completion_tokens = self._get_num_tokens_by_gpt2(assistant_message.content)

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        # transform response
        result = LLMResult(
            model=response_json["model"],
            prompt_messages=prompt_messages,
            message=assistant_message,
            usage=usage,
        )

        return result

    def _handle_generate_stream_response(self, model: str, credentials: dict, completion_type: LLMMode,
                                         response: requests.Response, prompt_messages: list[PromptMessage]) -> Generator:
        """
        Handle llm completion stream response

        :param model: model name
        :param credentials: model credentials
        :param completion_type: completion type
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator result
        """
        full_text = ''
        chunk_index = 0

        def create_final_llm_result_chunk(index: int, message: AssistantPromptMessage, finish_reason: str) \
                -> LLMResultChunk:
            # calculate num tokens
            prompt_tokens = self._get_num_tokens_by_gpt2(prompt_messages[0].content)
            completion_tokens = self._get_num_tokens_by_gpt2(full_text)

            # transform usage
            usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

            return LLMResultChunk(
                model=model,
                prompt_messages=prompt_messages,
                delta=LLMResultChunkDelta(
                    index=index,
                    message=message,
                    finish_reason=finish_reason,
                    usage=usage
                )
            )

        for chunk in response.iter_lines(decode_unicode=True, delimiter='\n'):
            if not chunk:
                continue

            try:
                chunk_json = json.loads(chunk)
                # stream ended
            except json.JSONDecodeError as e:
                yield create_final_llm_result_chunk(
                    index=chunk_index,
                    message=AssistantPromptMessage(content=""),
                    finish_reason="Non-JSON encountered."
                )

                chunk_index += 1
                break

            if completion_type is LLMMode.CHAT:
                if not chunk_json:
                    continue

                if 'message' not in chunk_json:
                    text = ''
                else:
                    text = chunk_json.get('message').get('content', '')
            else:
                if not chunk_json:
                    continue

                # transform assistant message to prompt message
                text = chunk_json['response']

            assistant_prompt_message = AssistantPromptMessage(
                content=text
            )

            full_text += text

            if chunk_json['done']:
                # calculate num tokens
                if 'prompt_eval_count' in chunk_json and 'eval_count' in chunk_json:
                    # transform usage
                    prompt_tokens = chunk_json["prompt_eval_count"]
                    completion_tokens = chunk_json["eval_count"]
                else:
                    # calculate num tokens
                    prompt_tokens = self._get_num_tokens_by_gpt2(prompt_messages[0].content)
                    completion_tokens = self._get_num_tokens_by_gpt2(full_text)

                # transform usage
                usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

                yield LLMResultChunk(
                    model=chunk_json['model'],
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=chunk_index,
                        message=assistant_prompt_message,
                        finish_reason='stop',
                        usage=usage
                    )
                )
            else:
                yield LLMResultChunk(
                    model=chunk_json['model'],
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=chunk_index,
                        message=assistant_prompt_message,
                    )
                )

            chunk_index += 1

    def _convert_prompt_message_to_dict(self, message: PromptMessage) -> dict:
        """
        Convert PromptMessage to dict for Ollama API
        """
        if isinstance(message, UserPromptMessage):
            message = cast(UserPromptMessage, message)
            if isinstance(message.content, str):
                message_dict = {"role": "user", "content": message.content}
            else:
                text = ''
                images = []
                for message_content in message.content:
                    if message_content.type == PromptMessageContentType.TEXT:
                        message_content = cast(TextPromptMessageContent, message_content)
                        text = message_content.data
                    elif message_content.type == PromptMessageContentType.IMAGE:
                        message_content = cast(ImagePromptMessageContent, message_content)
                        image_data = re.sub(r'^data:image\/[a-zA-Z]+;base64,', '', message_content.data)
                        images.append(image_data)

                message_dict = {"role": "user", "content": text, "images": images}
        elif isinstance(message, AssistantPromptMessage):
            message = cast(AssistantPromptMessage, message)
            message_dict = {"role": "assistant", "content": message.content}
        elif isinstance(message, SystemPromptMessage):
            message = cast(SystemPromptMessage, message)
            message_dict = {"role": "system", "content": message.content}
        else:
            raise ValueError(f"Got unknown type {message}")

        return message_dict

    def _num_tokens_from_messages(self, messages: List[PromptMessage]) -> int:
        """
        Calculate num tokens.

        :param messages: messages
        """
        num_tokens = 0
        messages_dict = [self._convert_prompt_message_to_dict(m) for m in messages]
        for message in messages_dict:
            for key, value in message.items():
                num_tokens += self._get_num_tokens_by_gpt2(str(key))
                num_tokens += self._get_num_tokens_by_gpt2(str(value))

        return num_tokens

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity:
        """
        Get customizable model schema.

        :param model: model name
        :param credentials: credentials

        :return: model schema
        """
        extras = {}

        if 'vision_support' in credentials and credentials['vision_support'] == 'true':
            extras['features'] = [ModelFeature.VISION]

        entity = AIModelEntity(
            model=model,
            label=I18nObject(
                zh_Hans=model,
                en_US=model
            ),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: credentials.get('mode'),
                ModelPropertyKey.CONTEXT_SIZE: int(credentials.get('context_size', 4096)),
            },
            parameter_rules=[
                ParameterRule(
                    name=DefaultParameterName.TEMPERATURE.value,
                    use_template=DefaultParameterName.TEMPERATURE.value,
                    label=I18nObject(en_US="Temperature"),
                    type=ParameterType.FLOAT,
                    help=I18nObject(en_US="The temperature of the model. "
                                          "Increasing the temperature will make the model answer "
                                          "more creatively. (Default: 0.8)"),
                    default=0.8,
                    min=0,
                    max=2
                ),
                ParameterRule(
                    name=DefaultParameterName.TOP_P.value,
                    use_template=DefaultParameterName.TOP_P.value,
                    label=I18nObject(en_US="Top P"),
                    type=ParameterType.FLOAT,
                    help=I18nObject(en_US="Works together with top-k. A higher value (e.g., 0.95) will lead to "
                                          "more diverse text, while a lower value (e.g., 0.5) will generate more "
                                          "focused and conservative text. (Default: 0.9)"),
                    default=0.9,
                    min=0,
                    max=1
                ),
                ParameterRule(
                    name="top_k",
                    label=I18nObject(en_US="Top K"),
                    type=ParameterType.INT,
                    help=I18nObject(en_US="Reduces the probability of generating nonsense. "
                                          "A higher value (e.g. 100) will give more diverse answers, "
                                          "while a lower value (e.g. 10) will be more conservative. (Default: 40)"),
                    default=40,
                    min=1,
                    max=100
                ),
                ParameterRule(
                    name='repeat_penalty',
                    label=I18nObject(en_US="Repeat Penalty"),
                    type=ParameterType.FLOAT,
                    help=I18nObject(en_US="Sets how strongly to penalize repetitions. "
                                          "A higher value (e.g., 1.5) will penalize repetitions more strongly, "
                                          "while a lower value (e.g., 0.9) will be more lenient. (Default: 1.1)"),
                    default=1.1,
                    min=-2,
                    max=2
                ),
                ParameterRule(
                    name='num_predict',
                    use_template='max_tokens',
                    label=I18nObject(en_US="Num Predict"),
                    type=ParameterType.INT,
                    help=I18nObject(en_US="Maximum number of tokens to predict when generating text. "
                                          "(Default: 128, -1 = infinite generation, -2 = fill context)"),
                    default=128,
                    min=-2,
                    max=int(credentials.get('max_tokens', 4096)),
                ),
                ParameterRule(
                    name='mirostat',
                    label=I18nObject(en_US="Mirostat sampling"),
                    type=ParameterType.INT,
                    help=I18nObject(en_US="Enable Mirostat sampling for controlling perplexity. "
                                          "(default: 0, 0 = disabled, 1 = Mirostat, 2 = Mirostat 2.0)"),
                    default=0,
                    min=0,
                    max=2
                ),
                ParameterRule(
                    name='mirostat_eta',
                    label=I18nObject(en_US="Mirostat Eta"),
                    type=ParameterType.FLOAT,
                    help=I18nObject(en_US="Influences how quickly the algorithm responds to feedback from "
                                          "the generated text. A lower learning rate will result in slower adjustments, "
                                          "while a higher learning rate will make the algorithm more responsive. "
                                          "(Default: 0.1)"),
                    default=0.1,
                    precision=1
                ),
                ParameterRule(
                    name='mirostat_tau',
                    label=I18nObject(en_US="Mirostat Tau"),
                    type=ParameterType.FLOAT,
                    help=I18nObject(en_US="Controls the balance between coherence and diversity of the output. "
                                          "A lower value will result in more focused and coherent text. (Default: 5.0)"),
                    default=5.0,
                    precision=1
                ),
                ParameterRule(
                    name='num_ctx',
                    label=I18nObject(en_US="Size of context window"),
                    type=ParameterType.INT,
                    help=I18nObject(en_US="Sets the size of the context window used to generate the next token. "
                                          "(Default: 2048)"),
                    default=2048,
                    min=1
                ),
                ParameterRule(
                    name='num_gpu',
                    label=I18nObject(en_US="Num GPU"),
                    type=ParameterType.INT,
                    help=I18nObject(en_US="The number of layers to send to the GPU(s). "
                                          "On macOS it defaults to 1 to enable metal support, 0 to disable."),
                    default=1,
                    min=0,
                    max=1
                ),
                ParameterRule(
                    name='num_thread',
                    label=I18nObject(en_US="Num Thread"),
                    type=ParameterType.INT,
                    help=I18nObject(en_US="Sets the number of threads to use during computation. "
                                          "By default, Ollama will detect this for optimal performance. "
                                          "It is recommended to set this value to the number of physical CPU cores "
                                          "your system has (as opposed to the logical number of cores)."),
                    min=1,
                ),
                ParameterRule(
                    name='repeat_last_n',
                    label=I18nObject(en_US="Repeat last N"),
                    type=ParameterType.INT,
                    help=I18nObject(en_US="Sets how far back for the model to look back to prevent repetition. "
                                          "(Default: 64, 0 = disabled, -1 = num_ctx)"),
                    default=64,
                    min=-1
                ),
                ParameterRule(
                    name='tfs_z',
                    label=I18nObject(en_US="TFS Z"),
                    type=ParameterType.FLOAT,
                    help=I18nObject(en_US="Tail free sampling is used to reduce the impact of less probable tokens "
                                          "from the output. A higher value (e.g., 2.0) will reduce the impact more, "
                                          "while a value of 1.0 disables this setting. (default: 1)"),
                    default=1,
                    precision=1
                ),
                ParameterRule(
                    name='seed',
                    label=I18nObject(en_US="Seed"),
                    type=ParameterType.INT,
                    help=I18nObject(en_US="Sets the random number seed to use for generation. Setting this to "
                                          "a specific number will make the model generate the same text for "
                                          "the same prompt. (Default: 0)"),
                    default=0
                ),
                ParameterRule(
                    name='format',
                    label=I18nObject(en_US="Format"),
                    type=ParameterType.STRING,
                    help=I18nObject(en_US="the format to return a response in."
                                          " Currently the only accepted value is json."),
                    options=['json'],
                )
            ],
            pricing=PriceConfig(
                input=Decimal(credentials.get('input_price', 0)),
                output=Decimal(credentials.get('output_price', 0)),
                unit=Decimal(credentials.get('unit', 0)),
                currency=credentials.get('currency', "USD")
            ),
            **extras
        )

        return entity

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
            InvokeAuthorizationError: [
                requests.exceptions.InvalidHeader,  # Missing or Invalid API Key
            ],
            InvokeBadRequestError: [
                requests.exceptions.HTTPError,  # Invalid Endpoint URL or model name
                requests.exceptions.InvalidURL,  # Misconfigured request or other API error
            ],
            InvokeRateLimitError: [
                requests.exceptions.RetryError  # Too many requests sent in a short period of time
            ],
            InvokeServerUnavailableError: [
                requests.exceptions.ConnectionError,  # Engine Overloaded
                requests.exceptions.HTTPError  # Server Error
            ],
            InvokeConnectionError: [
                requests.exceptions.ConnectTimeout,  # Timeout
                requests.exceptions.ReadTimeout  # Timeout
            ]
        }
