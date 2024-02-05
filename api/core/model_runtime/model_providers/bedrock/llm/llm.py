import json
import logging
from typing import Generator, List, Optional, Union

import boto3
from botocore.config import Config
from botocore.exceptions import (ClientError, EndpointConnectionError, NoRegionError, ServiceNotInRegionError,
                                 UnknownServiceError)
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (AssistantPromptMessage, PromptMessage, PromptMessageTool,
                                                          SystemPromptMessage, UserPromptMessage)
from core.model_runtime.errors.invoke import (InvokeAuthorizationError, InvokeBadRequestError, InvokeConnectionError,
                                              InvokeError, InvokeRateLimitError, InvokeServerUnavailableError)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel

logger = logging.getLogger(__name__)

class BedrockLargeLanguageModel(LargeLanguageModel):

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
        # invoke model
        return self._generate(model, credentials, prompt_messages, model_parameters, stop, stream, user)

    def get_num_tokens(self, model: str, credentials: dict, messages: list[PromptMessage] | str,
                       tools: Optional[list[PromptMessageTool]] = None) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param messages: prompt messages or message string
        :param tools: tools for tool calling
        :return:md = genai.GenerativeModel(model)
        """
        prefix = model.split('.')[0]

        if isinstance(messages, str):
            prompt = messages
        else:
            prompt = self._convert_messages_to_prompt(messages, prefix)

        return self._get_num_tokens_by_gpt2(prompt)
    
    def _convert_messages_to_prompt(self, model_prefix: str, messages: list[PromptMessage]) -> str:
        """
        Format a list of messages into a full prompt for the Google model

        :param messages: List of PromptMessage to combine.
        :return: Combined string with necessary human_prompt and ai_prompt tags.
        """
        messages = messages.copy()  # don't mutate the original list
        
        text = "".join(
            self._convert_one_message_to_text(message, model_prefix)
            for message in messages
        )

        return text.rstrip()

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        
        try:
            ping_message = UserPromptMessage(content="ping")
            self._generate(model=model,
                           credentials=credentials,
                           prompt_messages=[ping_message],
                           model_parameters={},
                           stream=False)
        
        except ClientError as ex:
            error_code = ex.response['Error']['Code']
            full_error_msg = f"{error_code}: {ex.response['Error']['Message']}"

            raise CredentialsValidateFailedError(str(self._map_client_to_invoke_error(error_code, full_error_msg)))

        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _convert_one_message_to_text(self, message: PromptMessage, model_prefix: str) -> str:
        """
        Convert a single message to a string.

        :param message: PromptMessage to convert.
        :return: String representation of the message.
        """
        
        if model_prefix == "anthropic":
            human_prompt_prefix = "\n\nHuman:"
            human_prompt_postfix = ""
            ai_prompt = "\n\nAssistant:"

        elif model_prefix == "meta":
            human_prompt_prefix = "\n[INST]"
            human_prompt_postfix = "[\\INST]\n"
            ai_prompt = ""

        elif model_prefix == "amazon":
            human_prompt_prefix = "\n\nUser:"
            human_prompt_postfix = ""
            ai_prompt = "\n\nBot:"
        
        else:
            human_prompt_prefix = ""
            human_prompt_postfix = ""
            ai_prompt = ""

        content = message.content

        if isinstance(message, UserPromptMessage):
            message_text = f"{human_prompt_prefix} {content} {human_prompt_postfix}"
        elif isinstance(message, AssistantPromptMessage):
            message_text = f"{ai_prompt} {content}"
        elif isinstance(message, SystemPromptMessage):
            message_text = content
        else:
            raise ValueError(f"Got unknown type {message}")

        return message_text

    def _convert_messages_to_prompt(self, messages: List[PromptMessage], model_prefix: str) -> str:
        """
        Format a list of messages into a full prompt for the Anthropic, Amazon and Llama models

        :param messages: List of PromptMessage to combine.
        :return: Combined string with necessary human_prompt and ai_prompt tags.
        """
        if not messages:
            return ''

        messages = messages.copy()  # don't mutate the original list
        if not isinstance(messages[-1], AssistantPromptMessage):
            messages.append(AssistantPromptMessage(content=""))

        text = "".join(
            self._convert_one_message_to_text(message, model_prefix)
            for message in messages
        )

        # trim off the trailing ' ' that might come from the "Assistant: "
        return text.rstrip()

    def _create_payload(self, model_prefix: str, prompt_messages: list[PromptMessage], model_parameters: dict, stop: Optional[List[str]] = None, stream: bool = True):
        """
        Create payload for bedrock api call depending on model provider
        """
        payload = dict()

        if model_prefix == "amazon":
            payload["textGenerationConfig"] = { **model_parameters }
            payload["textGenerationConfig"]["stopSequences"] = ["User:"] + (stop if stop else [])
            
            payload["inputText"] = self._convert_messages_to_prompt(prompt_messages, model_prefix)
        
        elif model_prefix == "ai21":
            payload["temperature"] = model_parameters.get("temperature")
            payload["topP"] = model_parameters.get("topP")
            payload["maxTokens"] = model_parameters.get("maxTokens")
            payload["prompt"] = self._convert_messages_to_prompt(prompt_messages, model_prefix)

            # jurassic models only support a single stop sequence
            if stop:
                payload["stopSequences"] = stop[0]

            if model_parameters.get("presencePenalty"):
                payload["presencePenalty"] = {model_parameters.get("presencePenalty")}
            if model_parameters.get("frequencyPenalty"):
                payload["frequencyPenalty"] = {model_parameters.get("frequencyPenalty")}
            if model_parameters.get("countPenalty"):
                payload["countPenalty"] = {model_parameters.get("countPenalty")}

        elif model_prefix == "anthropic":
            payload = { **model_parameters }
            payload["prompt"] = self._convert_messages_to_prompt(prompt_messages, model_prefix)
            payload["stop_sequences"] = ["\n\nHuman:"] + (stop if stop else [])
            
        elif model_prefix == "cohere":
            payload = { **model_parameters }
            payload["prompt"] = prompt_messages[0].content
            payload["stream"] = stream
        
        elif model_prefix == "meta":
            payload = { **model_parameters }
            payload["prompt"] = self._convert_messages_to_prompt(prompt_messages, model_prefix)

        else:
            raise ValueError(f"Got unknown model prefix {model_prefix}")
        
        return payload

    def _generate(self, model: str, credentials: dict,
                  prompt_messages: list[PromptMessage], model_parameters: dict,
                  stop: Optional[List[str]] = None, stream: bool = True,
                  user: Optional[str] = None) -> Union[LLMResult, Generator]:
        """
        Invoke large language model

        :param model: model name
        :param credentials: credentials kwargs
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """
        client_config = Config(
            region_name=credentials["aws_region"]
        )

        runtime_client = boto3.client(
            service_name='bedrock-runtime',
            config=client_config,
            aws_access_key_id=credentials["aws_access_key_id"],
            aws_secret_access_key=credentials["aws_secret_access_key"]
        )

        model_prefix = model.split('.')[0]
        payload = self._create_payload(model_prefix, prompt_messages, model_parameters, stop, stream)

        # need workaround for ai21 models which doesn't support streaming
        if stream and model_prefix != "ai21":
            invoke = runtime_client.invoke_model_with_response_stream
        else:
            invoke = runtime_client.invoke_model

        try:
            body_jsonstr=json.dumps(payload)
            response = invoke(
                modelId=model,
                contentType="application/json",
                accept= "*/*",
                body=body_jsonstr
            )
        except ClientError as ex:
            error_code = ex.response['Error']['Code']
            full_error_msg = f"{error_code}: {ex.response['Error']['Message']}"
            raise self._map_client_to_invoke_error(error_code, full_error_msg)
        
        except (EndpointConnectionError, NoRegionError, ServiceNotInRegionError) as ex:
            raise InvokeConnectionError(str(ex))

        except UnknownServiceError as ex:
            raise InvokeServerUnavailableError(str(ex))

        except Exception as ex:
            raise InvokeError(str(ex))
        

        if stream:
            return self._handle_generate_stream_response(model, credentials, response, prompt_messages)

        return self._handle_generate_response(model, credentials, response, prompt_messages)

    def _handle_generate_response(self, model: str, credentials: dict, response: dict,
                                  prompt_messages: list[PromptMessage]) -> LLMResult:
        """
        Handle llm response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response
        """
        response_body = json.loads(response.get('body').read().decode('utf-8'))

        finish_reason = response_body.get("error")

        if finish_reason is not None:
            raise InvokeError(finish_reason)

        # get output text and calculate num tokens based on model / provider
        model_prefix = model.split('.')[0]

        if model_prefix == "amazon":
            output = response_body.get("results")[0].get("outputText").strip('\n')
            prompt_tokens = response_body.get("inputTextTokenCount")
            completion_tokens = response_body.get("results")[0].get("tokenCount")

        elif model_prefix == "ai21":
            output = response_body.get('completions')[0].get('data').get('text')
            prompt_tokens = len(response_body.get("prompt").get("tokens"))
            completion_tokens = len(response_body.get('completions')[0].get('data').get('tokens'))

        elif model_prefix == "anthropic":
            output = response_body.get("completion")
            prompt_tokens = self.get_num_tokens(model, credentials, prompt_messages)
            completion_tokens = self.get_num_tokens(model, credentials, output if output else '')
            
        elif model_prefix == "cohere":
            output = response_body.get("generations")[0].get("text")
            prompt_tokens = self.get_num_tokens(model, credentials, prompt_messages)
            completion_tokens = self.get_num_tokens(model, credentials, output if output else '')
            
        elif model_prefix == "meta":
            output = response_body.get("generation").strip('\n')
            prompt_tokens = response_body.get("prompt_token_count")
            completion_tokens = response_body.get("generation_token_count")

        else:
            raise ValueError(f"Got unknown model prefix {model_prefix} when handling block response")

        # construct assistant message from output
        assistant_prompt_message = AssistantPromptMessage(
            content=output
        )

        # calculate usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        # construct response
        result = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=assistant_prompt_message,
            usage=usage,
        )

        return result

    def _handle_generate_stream_response(self, model: str, credentials: dict, response: dict,
                                         prompt_messages: list[PromptMessage]) -> Generator:
        """
        Handle llm stream response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator result
        """
        model_prefix = model.split('.')[0]
        if model_prefix == "ai21":
            response_body = json.loads(response.get('body').read().decode('utf-8'))

            content = response_body.get('completions')[0].get('data').get('text')
            finish_reason = response_body.get('completions')[0].get('finish_reason')

            prompt_tokens = len(response_body.get("prompt").get("tokens"))
            completion_tokens = len(response_body.get('completions')[0].get('data').get('tokens'))
            usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)
            yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content=content),
                        finish_reason=finish_reason,
                        usage=usage
                    )
                )
            return
        
        stream = response.get('body')
        if not stream:
            raise InvokeError('No response body')
        
        index = -1
        for event in stream:
            chunk = event.get('chunk')
            
            if not chunk:
                exception_name = next(iter(event))
                full_ex_msg = f"{exception_name}: {event[exception_name]['message']}"
                raise self._map_client_to_invoke_error(exception_name, full_ex_msg)

            payload = json.loads(chunk.get('bytes').decode())

            model_prefix = model.split('.')[0]
            if model_prefix == "amazon":
                content_delta = payload.get("outputText").strip('\n')
                finish_reason = payload.get("completion_reason")
 
            elif model_prefix == "anthropic":
                content_delta = payload.get("completion")
                finish_reason = payload.get("stop_reason")

            elif model_prefix == "cohere":
                content_delta = payload.get("text")
                finish_reason = payload.get("finish_reason")
            
            elif model_prefix == "meta":
                content_delta = payload.get("generation").strip('\n')
                finish_reason = payload.get("stop_reason")
            
            else:
                raise ValueError(f"Got unknown model prefix {model_prefix} when handling stream response")

            # transform assistant message to prompt message
            assistant_prompt_message = AssistantPromptMessage(
                content = content_delta if content_delta else '',
            )
            index += 1
           
            if not finish_reason:
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index,
                        message=assistant_prompt_message
                    )
                )

            else:
                # get num tokens from metrics in last chunk
                prompt_tokens = payload["amazon-bedrock-invocationMetrics"]["inputTokenCount"]
                completion_tokens = payload["amazon-bedrock-invocationMetrics"]["outputTokenCount"]

                # transform usage
                usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)
                
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index,
                        message=assistant_prompt_message,
                        finish_reason=finish_reason,
                        usage=usage
                    )
                )
    
    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the ermd = genai.GenerativeModel(model)ror type thrown to the caller
        The value is the md = genai.GenerativeModel(model)error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke emd = genai.GenerativeModel(model)rror mapping
        """
        return {
            InvokeConnectionError: [],
            InvokeServerUnavailableError: [],
            InvokeRateLimitError: [],
            InvokeAuthorizationError: [],
            InvokeBadRequestError: []
        }
    
    def _map_client_to_invoke_error(self, error_code: str, error_msg: str) -> type[InvokeError]:
        """
        Map client error to invoke error

        :param error_code: error code
        :param error_msg: error message
        :return: invoke error
        """

        if error_code == "AccessDeniedException":
            return InvokeAuthorizationError(error_msg)
        elif error_code in ["ResourceNotFoundException", "ValidationException"]:
            return InvokeBadRequestError(error_msg)
        elif error_code in ["ThrottlingException", "ServiceQuotaExceededException"]:
            return InvokeRateLimitError(error_msg)
        elif error_code in ["ModelTimeoutException", "ModelErrorException", "InternalServerException", "ModelNotReadyException"]:
            return InvokeServerUnavailableError(error_msg)
        elif error_code == "ModelStreamErrorException":
            return InvokeConnectionError(error_msg)

        return InvokeError(error_msg)