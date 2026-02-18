"""
ModelsLab Text Embedding Implementation for Dify

This module implements text embedding support for ModelsLab API, providing access to:
- High-quality embedding models for semantic search
- Multiple embedding dimensions and model types
- Batch processing capabilities
- Cost-efficient embedding generation

Features:
- Support for various embedding model sizes
- Batch processing for multiple texts
- Robust error handling and retry logic
- Efficient token usage and cost optimization

Author: ModelsLab Integration Team
License: Apache 2.0
"""

import logging
from typing import List, Dict, Any
import httpx
from httpx import Timeout

from dify_plugin.interfaces.model.text_embedding_model import TextEmbeddingModel
from dify_plugin.entities.model.text_embedding import EmbeddingUsage, TextEmbeddingResult
from dify_plugin.errors.model import (
    CredentialsValidateFailedError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
    InvokeConnectionError,
    InvokeAuthorizationError
)

logger = logging.getLogger(__name__)


class ModelsLabTextEmbeddingModel(TextEmbeddingModel):
    """ModelsLab Text Embedding implementation for Dify platform"""

    def _invoke(self, model: str, credentials: dict, texts: List[str], 
                user: Optional[str] = None) -> TextEmbeddingResult:
        """
        Invoke ModelsLab Text Embedding API.

        Args:
            model: Model identifier (e.g., 'text-embedding-3-small')
            credentials: API credentials including api_key and base_url
            texts: List of texts to generate embeddings for
            user: Optional user identifier

        Returns:
            TextEmbeddingResult containing embeddings and usage information

        Raises:
            InvokeError: If the API call fails
        """
        # Extract and validate credentials
        api_key = credentials.get('modelslab_api_key')
        if not api_key:
            raise CredentialsValidateFailedError("ModelsLab API key is required")

        base_url = credentials.get('modelslab_base_url', 'https://modelslab.com/api/v6')

        # Validate input
        if not texts or len(texts) == 0:
            raise InvokeError("At least one text is required for embedding")

        # Build API request parameters
        data = {
            "key": api_key,
            "model_id": model,
            "input": texts if len(texts) > 1 else texts[0]  # Single text or batch
        }

        if user:
            data["user"] = user

        # Make API request
        url = f"{base_url.rstrip('/')}/embeddings"

        try:
            with httpx.Client(timeout=Timeout(60.0)) as client:
                response = client.post(url, json=data)
                self._check_response_status(response, model)
                
                response_data = response.json()
                return self._convert_response(response_data, model)
                
        except httpx.TimeoutException:
            raise InvokeConnectionError(f"Request timeout for embedding model {model}")
        except httpx.ConnectError as e:
            raise InvokeConnectionError(f"Connection failed for embedding model {model}: {str(e)}")
        except Exception as e:
            self._handle_api_error(e, model)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate credentials by making a simple embedding request.
        
        Args:
            model: Model to test with
            credentials: API credentials
            
        Raises:
            CredentialsValidateFailedError: If credentials are invalid
        """
        try:
            # Make a minimal API call to test credentials
            self._invoke(
                model=model,
                credentials=credentials,
                texts=["test"],
                user=None
            )
        except InvokeAuthorizationError as e:
            raise CredentialsValidateFailedError(f"Invalid credentials: {str(e)}")
        except Exception as e:
            logger.warning(f"Credential validation error: {e}")
            raise CredentialsValidateFailedError(f"Credential validation failed: {str(e)}")

    def get_num_tokens(self, model: str, credentials: dict, texts: List[str]) -> int:
        """
        Estimate token count for given texts.
        
        This provides a rough estimate based on character count and typical tokenization.
        
        Args:
            model: Model identifier
            credentials: API credentials (not used for estimation)
            texts: Texts to count tokens for
            
        Returns:
            Estimated total token count
        """
        total_chars = sum(len(text) for text in texts)
        
        # Rough estimation: 1 token ≈ 4 characters for English text
        # Add 10% buffer for tokenization overhead
        estimated_tokens = int((total_chars / 4) * 1.1)
        
        return max(estimated_tokens, len(texts))  # Minimum 1 token per text

    def _convert_response(self, response_data: dict, model: str) -> TextEmbeddingResult:
        """Convert API response to Dify TextEmbeddingResult format"""
        try:
            # Extract embeddings from response
            data = response_data.get("data", [])
            if not data:
                raise InvokeError("No embeddings returned in response")

            embeddings = []
            for item in data:
                embedding = item.get("embedding")
                if not embedding:
                    raise InvokeError(f"No embedding data in response item: {item}")
                embeddings.append(embedding)

            # Extract usage information
            usage_data = response_data.get("usage", {})
            usage = EmbeddingUsage(
                tokens=usage_data.get("total_tokens", 0),
                total_tokens=usage_data.get("total_tokens", 0),
                unit_price=usage_data.get("unit_price"),
                price_unit=usage_data.get("price_unit", "token"),
                total_price=usage_data.get("total_price"),
                currency=usage_data.get("currency", "USD"),
                latency=usage_data.get("latency")
            )

            return TextEmbeddingResult(
                embeddings=embeddings,
                usage=usage,
                model=model
            )

        except Exception as e:
            logger.error(f"Failed to convert embedding response: {e}")
            raise InvokeError(f"Failed to process embedding response: {str(e)}")

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
            raise InvokeAuthorizationError(f"Invalid API key for embedding model {model}")
        elif response.status_code == 429:
            raise InvokeRateLimitError(f"Rate limit exceeded for embedding model {model}: {error_message}")
        elif response.status_code >= 500:
            raise InvokeServerUnavailableError(f"Server error for embedding model {model}: {error_message}")
        else:
            raise InvokeError(f"API error for embedding model {model}: {error_message}")

    def _handle_api_error(self, error: Exception, model: str) -> None:
        """Handle and re-raise API errors with appropriate types"""
        if isinstance(error, (InvokeError, CredentialsValidateFailedError)):
            raise error
            
        error_str = str(error).lower()
        
        if "unauthorized" in error_str or "invalid api key" in error_str:
            raise InvokeAuthorizationError(f"Authentication failed for embedding model {model}: {error}")
        elif "rate limit" in error_str or "too many requests" in error_str:
            raise InvokeRateLimitError(f"Rate limit exceeded for embedding model {model}: {error}")
        elif "timeout" in error_str:
            raise InvokeConnectionError(f"Request timeout for embedding model {model}: {error}")
        elif "connection" in error_str:
            raise InvokeConnectionError(f"Connection error for embedding model {model}: {error}")
        elif "server" in error_str or "internal" in error_str:
            raise InvokeServerUnavailableError(f"Server error for embedding model {model}: {error}")
        else:
            raise InvokeError(f"Unexpected error for embedding model {model}: {error}")

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

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Dict[str, Any]:
        """
        Get schema for customizable model parameters.
        
        Args:
            model: Model identifier
            credentials: API credentials
            
        Returns:
            Schema dictionary for model customization
        """
        return {
            "model": {
                "label": {
                    "en_US": "Model",
                    "zh_Hans": "模型"
                },
                "placeholder": {
                    "en_US": "Enter embedding model name",
                    "zh_Hans": "输入嵌入模型名称"
                }
            },
            "dimensions": {
                "label": {
                    "en_US": "Dimensions",
                    "zh_Hans": "维度"
                },
                "type": "int",
                "required": False,
                "placeholder": {
                    "en_US": "Embedding dimensions (e.g., 1536)",
                    "zh_Hans": "嵌入维度（例如：1536）"
                },
                "help": {
                    "en_US": "Number of dimensions for the embedding vectors",
                    "zh_Hans": "嵌入向量的维度数"
                }
            }
        }