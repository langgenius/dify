import logging
from collections.abc import Generator
from typing import Optional, Union, cast

import cohere
from cohere.responses import Chat, Generations
from cohere.responses.chat import StreamEnd, StreamingChat, StreamTextGeneration
from cohere.responses.generation import StreamingGenerations, StreamingText

from core.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageContentType,
    PromptMessageTool,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
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


class CohereLargeLanguageModel(LargeLanguageModel):
    """
    Model class for Cohere large language model.
    """

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

        if model_mode == LLMMode.CHAT:
            return self._chat_generate(
                model=model,
                credentials=credentials,
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                stop=stop,
                stream=stream,
                user=user
            )
        else:
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
        model_mode = self.get_model_mode(model)

        try:
            if model_mode == LLMMode.CHAT:
                return self._num_tokens_from_messages(model, credentials, prompt_messages)
            else:
                return self._num_tokens_from_string(model, credentials, prompt_messages[0].content)
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

            if model_mode == LLMMode.CHAT:
                self._chat_generate(
                    model=model,
                    credentials=credentials,
                    prompt_messages=[UserPromptMessage(content='ping')],
                    model_parameters={
                        'max_tokens': 20,
                        'temperature': 0,
                    },
                    stream=False
                )
            else:
                self._generate(
                    model=model,
                    credentials=credentials,
                    prompt_messages=[UserPromptMessage(content='ping')],
                    model_parameters={
                        'max_tokens': 20,
                        'temperature': 0,
                    },
                    stream=False
                )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _generate(self, model: str, credentials: dict,
                  prompt_messages: list[PromptMessage], model_parameters: dict, stop: Optional[list[str]] = None,
                  stream: bool = True, user: Optional[str] = None) -> Union[LLMResult, Generator]:
        """
        Invoke llm model

        :param model: model name
        :param credentials: credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """
        # initialize client
        client = cohere.Client(credentials.get('api_key'))

        if stop:
            model_parameters['end_sequences'] = stop

        response = client.generate(
            prompt=prompt_messages[0].content,
            model=model,
            stream=stream,
            **model_parameters,
        )

        if stream:
            return self._handle_generate_stream_response(model, credentials, response, prompt_messages)

        return self._handle_generate_response(model, credentials, response, prompt_messages)

    def _handle_generate_response(self, model: str, credentials: dict, response: Generations,
                                  prompt_messages: list[PromptMessage]) \
            -> LLMResult:
        """
        Handle llm response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response
        """
        assistant_text = response.generations[0].text

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(
            content=assistant_text
        )

        # calculate num tokens
        prompt_tokens = response.meta['billed_units']['input_tokens']
        completion_tokens = response.meta['billed_units']['output_tokens']

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        # transform response
        response = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=assistant_prompt_message,
            usage=usage
        )

        return response

    def _handle_generate_stream_response(self, model: str, credentials: dict, response: StreamingGenerations,
                                         prompt_messages: list[PromptMessage]) -> Generator:
        """
        Handle llm stream response

        :param model: model name
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator
        """
        index = 1
        full_assistant_content = ''
        for chunk in response:
            if isinstance(chunk, StreamingText):
                chunk = cast(StreamingText, chunk)
                text = chunk.text

                if text is None:
                    continue

                # transform assistant message to prompt message
                assistant_prompt_message = AssistantPromptMessage(
                    content=text
                )

                full_assistant_content += text

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index,
                        message=assistant_prompt_message,
                    )
                )

                index += 1
            elif chunk is None:
                # calculate num tokens
                prompt_tokens = response.meta['billed_units']['input_tokens']
                completion_tokens = response.meta['billed_units']['output_tokens']

                # transform usage
                usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index,
                        message=AssistantPromptMessage(content=''),
                        finish_reason=response.finish_reason,
                        usage=usage
                    )
                )
                break

    def _chat_generate(self, model: str, credentials: dict,
                       prompt_messages: list[PromptMessage], model_parameters: dict, stop: Optional[list[str]] = None,
                       stream: bool = True, user: Optional[str] = None) -> Union[LLMResult, Generator]:
        """
        Invoke llm chat model

        :param model: model name
        :param credentials: credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """
        # initialize client
        client = cohere.Client(credentials.get('api_key'))

        if user:
            model_parameters['user_name'] = user

        message, chat_histories = self._convert_prompt_messages_to_message_and_chat_histories(prompt_messages)

        # chat model
        real_model = model
        if self.get_model_schema(model, credentials).fetch_from == FetchFrom.PREDEFINED_MODEL:
            real_model = model.removesuffix('-chat')

        response = client.chat(
            message=message,
            chat_history=chat_histories,
            model=real_model,
            stream=stream,
            return_preamble=True,
            **model_parameters,
        )

        if stream:
            return self._handle_chat_generate_stream_response(model, credentials, response, prompt_messages, stop)

        return self._handle_chat_generate_response(model, credentials, response, prompt_messages, stop)

    def _handle_chat_generate_response(self, model: str, credentials: dict, response: Chat,
                                       prompt_messages: list[PromptMessage], stop: Optional[list[str]] = None) \
            -> LLMResult:
        """
        Handle llm chat response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :param stop: stop words
        :return: llm response
        """
        assistant_text = response.text

        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(
            content=assistant_text
        )

        # calculate num tokens
        prompt_tokens = self._num_tokens_from_messages(model, credentials, prompt_messages)
        completion_tokens = self._num_tokens_from_messages(model, credentials, [assistant_prompt_message])

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        if stop:
            # enforce stop tokens
            assistant_text = self.enforce_stop_tokens(assistant_text, stop)
            assistant_prompt_message = AssistantPromptMessage(
                content=assistant_text
            )

        # transform response
        response = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=assistant_prompt_message,
            usage=usage,
            system_fingerprint=response.preamble
        )

        return response

    def _handle_chat_generate_stream_response(self, model: str, credentials: dict, response: StreamingChat,
                                              prompt_messages: list[PromptMessage],
                                              stop: Optional[list[str]] = None) -> Generator:
        """
        Handle llm chat stream response

        :param model: model name
        :param response: response
        :param prompt_messages: prompt messages
        :param stop: stop words
        :return: llm response chunk generator
        """

        def final_response(full_text: str, index: int, finish_reason: Optional[str] = None,
                           preamble: Optional[str] = None) -> LLMResultChunk:
            # calculate num tokens
            prompt_tokens = self._num_tokens_from_messages(model, credentials, prompt_messages)

            full_assistant_prompt_message = AssistantPromptMessage(
                content=full_text
            )
            completion_tokens = self._num_tokens_from_messages(model, credentials, [full_assistant_prompt_message])

            # transform usage
            usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

            return LLMResultChunk(
                model=model,
                prompt_messages=prompt_messages,
                system_fingerprint=preamble,
                delta=LLMResultChunkDelta(
                    index=index,
                    message=AssistantPromptMessage(content=''),
                    finish_reason=finish_reason,
                    usage=usage
                )
            )

        index = 1
        full_assistant_content = ''
        for chunk in response:
            if isinstance(chunk, StreamTextGeneration):
                chunk = cast(StreamTextGeneration, chunk)
                text = chunk.text

                if text is None:
                    continue

                # transform assistant message to prompt message
                assistant_prompt_message = AssistantPromptMessage(
                    content=text
                )

                # stop
                # notice: This logic can only cover few stop scenarios
                if stop and text in stop:
                    yield final_response(full_assistant_content, index, 'stop')
                    break

                full_assistant_content += text

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index,
                        message=assistant_prompt_message,
                    )
                )

                index += 1
            elif isinstance(chunk, StreamEnd):
                chunk = cast(StreamEnd, chunk)
                yield final_response(full_assistant_content, index, chunk.finish_reason, response.preamble)
                index += 1

    def _convert_prompt_messages_to_message_and_chat_histories(self, prompt_messages: list[PromptMessage]) \
            -> tuple[str, list[dict]]:
        """
        Convert prompt messages to message and chat histories
        :param prompt_messages: prompt messages
        :return:
        """
        chat_histories = []
        for prompt_message in prompt_messages:
            chat_histories.append(self._convert_prompt_message_to_dict(prompt_message))

        # get latest message from chat histories and pop it
        if len(chat_histories) > 0:
            latest_message = chat_histories.pop()
            message = latest_message['message']
        else:
            raise ValueError('Prompt messages is empty')

        return message, chat_histories

    def _convert_prompt_message_to_dict(self, message: PromptMessage) -> dict:
        """
        Convert PromptMessage to dict for Cohere model
        """
        if isinstance(message, UserPromptMessage):
            message = cast(UserPromptMessage, message)
            if isinstance(message.content, str):
                message_dict = {"role": "USER", "message": message.content}
            else:
                sub_message_text = ''
                for message_content in message.content:
                    if message_content.type == PromptMessageContentType.TEXT:
                        message_content = cast(TextPromptMessageContent, message_content)
                        sub_message_text += message_content.data

                message_dict = {"role": "USER", "message": sub_message_text}
        elif isinstance(message, AssistantPromptMessage):
            message = cast(AssistantPromptMessage, message)
            message_dict = {"role": "CHATBOT", "message": message.content}
        elif isinstance(message, SystemPromptMessage):
            message = cast(SystemPromptMessage, message)
            message_dict = {"role": "USER", "message": message.content}
        else:
            raise ValueError(f"Got unknown type {message}")

        if message.name:
            message_dict["user_name"] = message.name

        return message_dict

    def _num_tokens_from_string(self, model: str, credentials: dict, text: str) -> int:
        """
        Calculate num tokens for text completion model.

        :param model: model name
        :param credentials: credentials
        :param text: prompt text
        :return: number of tokens
        """
        # initialize client
        client = cohere.Client(credentials.get('api_key'))

        response = client.tokenize(
            text=text,
            model=model
        )

        return response.length

    def _num_tokens_from_messages(self, model: str, credentials: dict, messages: list[PromptMessage]) -> int:
        """Calculate num tokens Cohere model."""
        messages = [self._convert_prompt_message_to_dict(m) for m in messages]
        message_strs = [f"{message['role']}: {message['message']}" for message in messages]
        message_str = "\n".join(message_strs)

        real_model = model
        if self.get_model_schema(model, credentials).fetch_from == FetchFrom.PREDEFINED_MODEL:
            real_model = model.removesuffix('-chat')

        return self._num_tokens_from_string(real_model, credentials, message_str)

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity:
        """
            Cohere supports fine-tuning of their models. This method returns the schema of the base model
            but renamed to the fine-tuned model name.

            :param model: model name
            :param credentials: credentials

            :return: model schema
        """
        # get model schema
        models = self.predefined_models()
        model_map = {model.model: model for model in models}

        mode = credentials.get('mode')

        if mode == 'chat':
            base_model_schema = model_map['command-light-chat']
        else:
            base_model_schema = model_map['command-light']

        base_model_schema = cast(AIModelEntity, base_model_schema)

        base_model_schema_features = base_model_schema.features or []
        base_model_schema_model_properties = base_model_schema.model_properties or {}
        base_model_schema_parameters_rules = base_model_schema.parameter_rules or []

        entity = AIModelEntity(
            model=model,
            label=I18nObject(
                zh_Hans=model,
                en_US=model
            ),
            model_type=ModelType.LLM,
            features=[feature for feature in base_model_schema_features],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                key: property for key, property in base_model_schema_model_properties.items()
            },
            parameter_rules=[rule for rule in base_model_schema_parameters_rules],
            pricing=base_model_schema.pricing
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
            InvokeConnectionError: [
                cohere.CohereConnectionError
            ],
            InvokeServerUnavailableError: [],
            InvokeRateLimitError: [],
            InvokeAuthorizationError: [],
            InvokeBadRequestError: [
                cohere.CohereAPIError,
                cohere.CohereError,
            ]
        }
