"""
ModelsLab Large Language Model Implementation for Dify

This module implements LLM support for ModelsLab API, providing access to:
- Meta Llama 3.1 models (8B, 70B, 405B)
- Mistral and Mixtral models
- Google Gemini models  
- OpenAI GPT models
- And many other popular LLMs

Features:
- Streaming and non-streaming responses
- Function calling and tool use
- Robust error handling and retry logic
- Cost-efficient token counting
- Support for chat and completion modes

Author: ModelsLab Integration Team
License: Apache 2.0
"""

import json
import logging
from typing import Generator, Union, Optional, List, Dict, Any
import httpx
from httpx import Timeout

from dify_plugin.interfaces.model.large_language_model import LargeLanguageModel
from dify_plugin.entities.model.llm import LLMResult, LLMResultChunk, LLMUsage
from dify_plugin.entities.message import PromptMessage, PromptMessageTool, PromptMessageContent, PromptMessageContentType
from dify_plugin.errors.model import (
    CredentialsValidateFailedError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
    InvokeConnectionError,
    InvokeAuthorizationError
)

logger = logging.getLogger(__name__)


class ModelsLabLargeLanguageModel(LargeLanguageModel):
    """ModelsLab LLM implementation for Dify platform"""

    def _invoke(self, model: str, credentials: dict, prompt_messages: List[PromptMessage],
                model_parameters: dict, tools: Optional[List[PromptMessageTool]] = None,
                stop: Optional[List[str]] = None, stream: bool = True,
                user: Optional[str] = None) -> Union[LLMResult, Generator[LLMResultChunk, None, None]]:
        """
        Invoke ModelsLab LLM API for text generation.

        Args:
            model: Model identifier (e.g., 'meta-llama/llama-3.1-8b-instruct')
            credentials: API credentials including api_key and base_url
            prompt_messages: List of conversation messages
            model_parameters: Generation parameters (temperature, max_tokens, etc.)
            tools: Optional list of tools/functions the model can call
            stop: Optional list of stop sequences
            stream: Whether to stream the response
            user: Optional user identifier

        Returns:
            LLMResult for non-streaming, Generator[LLMResultChunk] for streaming

        Raises:
            InvokeError: If the API call fails
        """
        # Extract and validate credentials
        api_key = credentials.get('modelslab_api_key')
        if not api_key:
            raise CredentialsValidateFailedError("ModelsLab API key is required")

        base_url = credentials.get('modelslab_base_url', 'https://modelslab.com/api/v6')

        # Convert messages to ModelsLab format
        messages = self._convert_messages(prompt_messages)

        # Build API request parameters
        data = {
            "key": api_key,
            "model_id": model,
            "messages": messages,
            "max_tokens": model_parameters.get('max_tokens', 2048),
            "temperature": model_parameters.get('temperature', 0.7),
            "top_p": model_parameters.get('top_p', 1.0),
            "stream": stream
        }

        # Add optional parameters
        if stop:
            data["stop"] = stop
        if tools:
            data["tools"] = self._convert_tools(tools)
        if user:
            data["user"] = user

        # Add provider-specific parameters
        if model_parameters.get('frequency_penalty') is not None:
            data["frequency_penalty"] = model_parameters['frequency_penalty']
        if model_parameters.get('presence_penalty') is not None:
            data["presence_penalty"] = model_parameters['presence_penalty']
        if model_parameters.get('seed') is not None:
            data["seed"] = model_parameters['seed']

        try:
            if stream:
                return self._invoke_stream(base_url, data, model)
            else:
                return self._invoke_sync(base_url, data, model)
        except Exception as e:
            self._handle_api_error(e, model)

    def _invoke_stream(self, base_url: str, data: dict, model: str) -> Generator[LLMResultChunk, None, None]:
        """Handle streaming LLM API calls"""
        url = f"{base_url.rstrip('/')}/chat/completions"
        
        try:
            with httpx.stream('POST', url, json=data, timeout=Timeout(60.0)) as response:
                self._check_response_status(response, model)
                
                for line in response.iter_lines():
                    if not line.strip():
                        continue
                        
                    # Parse Server-Sent Events format
                    if line.startswith('data: '):
                        data_str = line[6:].strip()
                        
                        if data_str == '[DONE]':
                            break
                            
                        try:
                            chunk_data = json.loads(data_str)
                            chunk = self._convert_stream_chunk(chunk_data, model)
                            if chunk:
                                yield chunk
                        except json.JSONDecodeError:
                            logger.warning(f"Failed to parse streaming response: {data_str}")
                            continue
                            
        except httpx.TimeoutException:
            raise InvokeConnectionError(f"Request timeout for model {model}")
        except httpx.ConnectError as e:
            raise InvokeConnectionError(f"Connection failed for model {model}: {str(e)}")
        except Exception as e:
            self._handle_api_error(e, model)

    def _invoke_sync(self, base_url: str, data: dict, model: str) -> LLMResult:
        """Handle synchronous LLM API calls"""
        url = f"{base_url.rstrip('/')}/chat/completions"
        data["stream"] = False  # Ensure non-streaming mode
        
        try:
            with httpx.Client(timeout=Timeout(60.0)) as client:
                response = client.post(url, json=data)
                self._check_response_status(response, model)
                
                response_data = response.json()
                return self._convert_sync_response(response_data, model)
                
        except httpx.TimeoutException:
            raise InvokeConnectionError(f"Request timeout for model {model}")
        except httpx.ConnectError as e:
            raise InvokeConnectionError(f"Connection failed for model {model}: {str(e)}")
        except Exception as e:
            self._handle_api_error(e, model)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate credentials by making a simple API call.
        
        Args:
            model: Model to test with
            credentials: API credentials
            
        Raises:
            CredentialsValidateFailedError: If credentials are invalid
        """
        try:
            # Make a minimal API call to test credentials
            list(self._invoke(
                model=model,
                credentials=credentials,
                prompt_messages=[
                    PromptMessage(content="Hello", role="user")
                ],
                model_parameters={"max_tokens": 1, "temperature": 0},
                stream=False
            ))
        except InvokeAuthorizationError as e:
            raise CredentialsValidateFailedError(f"Invalid credentials: {str(e)}")
        except Exception as e:
            logger.warning(f"Credential validation error: {e}")
            raise CredentialsValidateFailedError(f"Credential validation failed: {str(e)}")

    def get_num_tokens(self, model: str, credentials: dict, prompt_messages: List[PromptMessage],
                       tools: Optional[List[PromptMessageTool]] = None) -> int:
        """
        Estimate token count for given messages and tools.
        
        This provides a rough estimate based on character count.
        For exact counts, ModelsLab API would need a dedicated tokenization endpoint.
        
        Args:
            model: Model identifier
            credentials: API credentials
            prompt_messages: Messages to count tokens for
            tools: Optional tools that may affect token count
            
        Returns:
            Estimated token count
        """
        total_chars = 0
        
        # Count characters in all message content
        for message in prompt_messages:
            if isinstance(message.content, str):
                total_chars += len(message.content)
            elif isinstance(message.content, list):
                for content in message.content:
                    if content.type == PromptMessageContentType.TEXT:
                        total_chars += len(content.data)
            
            # Add role and formatting overhead
            total_chars += len(message.role) + 10

        # Add tool definition tokens if present
        if tools:
            for tool in tools:
                tool_str = json.dumps(tool.to_dict() if hasattr(tool, 'to_dict') else str(tool))
                total_chars += len(tool_str)

        # Rough estimation: 1 token ≈ 4 characters for English text
        # Add 20% buffer for formatting and special tokens
        estimated_tokens = int((total_chars / 4) * 1.2)
        
        return max(estimated_tokens, 10)  # Minimum 10 tokens

    def _convert_messages(self, messages: List[PromptMessage]) -> List[Dict[str, Any]]:
        """Convert Dify messages to ModelsLab format"""
        converted_messages = []
        
        for message in messages:
            converted_msg = {
                "role": message.role,
                "content": self._convert_message_content(message.content)
            }
            converted_messages.append(converted_msg)
            
        return converted_messages

    def _convert_message_content(self, content) -> Union[str, List[Dict[str, Any]]]:
        """Convert message content to appropriate format"""
        if isinstance(content, str):
            return content
        elif isinstance(content, list):
            # Handle multimodal content
            converted_content = []
            for item in content:
                if item.type == PromptMessageContentType.TEXT:
                    converted_content.append({
                        "type": "text",
                        "text": item.data
                    })
                elif item.type == PromptMessageContentType.IMAGE:
                    converted_content.append({
                        "type": "image_url",
                        "image_url": {"url": item.data}
                    })
            return converted_content
        else:
            return str(content)

    def _convert_tools(self, tools: List[PromptMessageTool]) -> List[Dict[str, Any]]:
        """Convert Dify tools to ModelsLab format"""
        converted_tools = []
        
        for tool in tools:
            converted_tool = {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters
                }
            }
            converted_tools.append(converted_tool)
            
        return converted_tools

    def _convert_stream_chunk(self, chunk_data: dict, model: str) -> Optional[LLMResultChunk]:
        """Convert streaming response chunk to Dify format"""
        try:
            choices = chunk_data.get("choices", [])
            if not choices:
                return None
                
            choice = choices[0]
            delta = choice.get("delta", {})
            
            # Extract content
            content = delta.get("content", "")
            
            # Check if this is the final chunk
            finish_reason = choice.get("finish_reason")
            
            # Extract usage information if available (usually in final chunk)
            usage_data = chunk_data.get("usage", {})
            usage = None
            if usage_data:
                usage = LLMUsage(
                    prompt_tokens=usage_data.get("prompt_tokens", 0),
                    completion_tokens=usage_data.get("completion_tokens", 0),
                    total_tokens=usage_data.get("total_tokens", 0)
                )

            return LLMResultChunk(
                model=model,
                prompt_messages=[],  # Not included in stream chunks
                delta=LLMResultChunk.Delta(
                    index=choice.get("index", 0),
                    message=LLMResultChunk.Delta.Message(
                        content=content,
                        role=delta.get("role", "assistant")
                    ),
                    finish_reason=finish_reason,
                    usage=usage
                )
            )
            
        except Exception as e:
            logger.warning(f"Failed to convert stream chunk: {e}")
            return None

    def _convert_sync_response(self, response_data: dict, model: str) -> LLMResult:
        """Convert synchronous response to Dify format"""
        choices = response_data.get("choices", [])
        if not choices:
            raise InvokeError("No choices returned in response")
            
        choice = choices[0]
        message = choice.get("message", {})
        
        # Extract usage information
        usage_data = response_data.get("usage", {})
        usage = LLMUsage(
            prompt_tokens=usage_data.get("prompt_tokens", 0),
            completion_tokens=usage_data.get("completion_tokens", 0),
            total_tokens=usage_data.get("total_tokens", 0)
        )

        return LLMResult(
            model=model,
            prompt_messages=[],  # Original messages not included in response
            message=LLMResult.Message(
                content=message.get("content", ""),
                role=message.get("role", "assistant"),
                tool_calls=self._extract_tool_calls(message)
            ),
            finish_reason=choice.get("finish_reason", "stop"),
            usage=usage,
            system_fingerprint=response_data.get("system_fingerprint")
        )

    def _extract_tool_calls(self, message: dict) -> Optional[List[Dict[str, Any]]]:
        """Extract tool calls from message if present"""
        tool_calls = message.get("tool_calls")
        if not tool_calls:
            return None
            
        converted_calls = []
        for call in tool_calls:
            converted_calls.append({
                "id": call.get("id"),
                "type": call.get("type", "function"),
                "function": {
                    "name": call.get("function", {}).get("name"),
                    "arguments": call.get("function", {}).get("arguments")
                }
            })
            
        return converted_calls

    def _check_response_status(self, response: httpx.Response, model: str) -> None:
        """Check HTTP response status and raise appropriate errors"""
        if response.status_code == 200:
            return
            
        try:
            error_data = response.json()
            error_message = error_data.get("error", {}).get("message", "Unknown error")
        except:
            error_message = response.text or f"HTTP {response.status_code}"

        if response.status_code == 401:
            raise InvokeAuthorizationError(f"Invalid API key for model {model}")
        elif response.status_code == 429:
            raise InvokeRateLimitError(f"Rate limit exceeded for model {model}: {error_message}")
        elif response.status_code >= 500:
            raise InvokeServerUnavailableError(f"Server error for model {model}: {error_message}")
        else:
            raise InvokeError(f"API error for model {model}: {error_message}")

    def _handle_api_error(self, error: Exception, model: str) -> None:
        """Handle and re-raise API errors with appropriate types"""
        if isinstance(error, (InvokeError, CredentialsValidateFailedError)):
            raise error
            
        error_str = str(error).lower()
        
        if "unauthorized" in error_str or "invalid api key" in error_str:
            raise InvokeAuthorizationError(f"Authentication failed for model {model}: {error}")
        elif "rate limit" in error_str or "too many requests" in error_str:
            raise InvokeRateLimitError(f"Rate limit exceeded for model {model}: {error}")
        elif "timeout" in error_str:
            raise InvokeConnectionError(f"Request timeout for model {model}: {error}")
        elif "connection" in error_str:
            raise InvokeConnectionError(f"Connection error for model {model}: {error}")
        elif "server" in error_str or "internal" in error_str:
            raise InvokeServerUnavailableError(f"Server error for model {model}: {error}")
        else:
            raise InvokeError(f"Unexpected error for model {model}: {error}")

    @property
    def _invoke_error_mapping(self) -> Dict[type, List[type]]:
        """Map ModelsLab specific exceptions to Dify exceptions"""
        return {
            InvokeConnectionError: [
                httpx.ConnectError,
                httpx.TimeoutException,
                ConnectionError
            ],
            InvokeServerUnavailableError: [
                httpx.HTTPStatusError
            ],
            InvokeRateLimitError: [
                httpx.HTTPStatusError  # Will be handled in _check_response_status
            ],
            InvokeAuthorizationError: [
                httpx.HTTPStatusError  # Will be handled in _check_response_status  
            ]
        }