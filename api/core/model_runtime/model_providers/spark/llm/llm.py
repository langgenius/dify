import threading
from typing import Optional, Generator, Union, List

from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool, UserPromptMessage, AssistantPromptMessage, \
    SystemPromptMessage
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, \
    LLMResultChunkDelta
from core.model_runtime.errors.invoke import InvokeConnectionError, InvokeServerUnavailableError, InvokeRateLimitError, \
    InvokeAuthorizationError, InvokeBadRequestError, InvokeError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel

from ._client import SparkLLMClient


class SparkLargeLanguageModel(LargeLanguageModel):

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
        # transform credentials to kwargs for model instance
        credentials_kwargs = self._to_credential_kwargs(credentials)

        # invoke model
        return self._generate(model, credentials_kwargs, prompt_messages, model_parameters, stop, stream, user)

    def get_num_tokens(self, model: str, prompt_messages: list[PromptMessage],
                       tools: Optional[list[PromptMessageTool]] = None) -> int:
        """
        Get number of tokens for given prompt messages

        :param model:
        :param prompt_messages:
        :param tools: tools for tool calling
        :return:
        """
        prompt = self._convert_messages_to_prompt(prompt_messages)

        return self._get_num_tokens_by_gpt2(prompt)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            # transform credentials to kwargs for model instance
            credentials_kwargs = self._to_credential_kwargs(credentials)
            self._generate(
                model=model,
                credentials_kwargs=credentials_kwargs,
                prompt_messages=[
                    UserPromptMessage(content="ping"),
                ],
                model_parameters={
                    "temperature": 0.5,
                },
                stream=False
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _generate(self, model: str, credentials_kwargs: dict,
                  prompt_messages: list[PromptMessage], model_parameters: dict,
                  stop: Optional[List[str]] = None, stream: bool = True,
                  user: Optional[str] = None) -> Union[LLMResult, Generator]:
        """
        Invoke large language model

        :param model: model name
        :param credentials_kwargs: credentials kwargs
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """
        extra_model_kwargs = {}
        if stop:
            extra_model_kwargs['stop_sequences'] = stop

        client = SparkLLMClient(
            model=model,
            **credentials_kwargs,
        )

        thread = threading.Thread(target=client.run, args=(
            [{ 'role': prompt_message.role.value, 'content': prompt_message.content } for prompt_message in prompt_messages],
            user,
            model_parameters,
            stream
        ))
        thread.start()

        if stream:
            return self._handle_generate_stream_response(thread, model, client, prompt_messages)

        return self._handle_generate_response(thread, model, client, prompt_messages)
        
    def _handle_generate_response(self, thread: threading.Thread, model: str, client: SparkLLMClient,
                                  prompt_messages: list[PromptMessage]) -> LLMResult:
        """
        Handle llm response

        :param model: model name
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response
        """
        completion = ""

        for content in client.subscribe():
            if isinstance(content, dict):
                delta = content['data']
            else:
                delta = content

            completion += delta

        thread.join()
        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(
            content=completion
        )

        # calculate num tokens
        prompt_tokens = self.get_num_tokens(model, prompt_messages)
        completion_tokens = self.get_num_tokens(model, [assistant_prompt_message])

        # transform usage
        usage = self._calc_response_usage(model, prompt_tokens, completion_tokens)

        # transform response
        result = LLMResult(
            model=model,
            message=assistant_prompt_message,
            usage=usage,
        )

        return result
    
    def _handle_generate_stream_response(self, thread: threading.Thread, model: str, client: SparkLLMClient,
                                         prompt_messages: list[PromptMessage]) -> Generator:
        """
        Handle llm stream response

        :param model: model name
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator result
        """
        for index, content in enumerate(client.subscribe()):
            if isinstance(content, dict):
                delta = content['data']
            else:
                delta = content

            assistant_prompt_message = AssistantPromptMessage(
                content=delta if delta else '',
            )

            yield LLMResultChunk(
                model=model,
                delta=LLMResultChunkDelta(
                    index=index,
                    message=assistant_prompt_message,
                )
            )
        else:
            prompt_tokens = self.get_num_tokens(model, prompt_messages)
            completion_tokens = self.get_num_tokens(model, [assistant_prompt_message])

            # transform usage
            usage = self._calc_response_usage(model, prompt_tokens, completion_tokens)

            yield LLMResultChunk(
                model=model,
                delta=LLMResultChunkDelta(
                    index=index,
                    message=AssistantPromptMessage(content=''),
                    usage=usage
                )
            )
        
        thread.join()

    def _to_credential_kwargs(self, credentials: dict) -> dict:
        """
        Transform credentials to kwargs for model instance

        :param credentials:
        :return:
        """
        credentials_kwargs = {
            "app_id": credentials['spark_app_id'],
            "api_secret": credentials['spark_api_secret'],
            "api_key": credentials['spark_api_key'],
        }

        return credentials_kwargs

    def _convert_one_message_to_text(self, message: PromptMessage) -> str:
        """
        Convert a single message to a string.

        :param message: PromptMessage to convert.
        :return: String representation of the message.
        """
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
    
    def _convert_messages_to_prompt(self, messages: List[PromptMessage]) -> str:
        """
        Format a list of messages into a full prompt for the Anthropic model

        :param messages: List of PromptMessage to combine.
        :return: Combined string with necessary human_prompt and ai_prompt tags.
        """
        messages = messages.copy()  # don't mutate the original list

        text = "".join(
            self._convert_one_message_to_text(message)
            for message in messages
        )

        # trim off the trailing ' ' that might come from the "Assistant: "
        return text.rstrip()

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
            InvokeConnectionError: [],
            InvokeServerUnavailableError: [],
            InvokeRateLimitError: [],
            InvokeAuthorizationError: [],
            InvokeBadRequestError: []
        }
