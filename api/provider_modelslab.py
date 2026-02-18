"""
ModelsLab Provider for Dify

This provider integrates ModelsLab's comprehensive AI APIs with Dify, supporting:
- Large Language Models (LLM)
- Text Embeddings 
- Image Generation (Text2Img)
- Video Generation (Text2Video) - First video provider in Dify ecosystem

Author: ModelsLab Integration Team
License: Apache 2.0
"""

import logging
from typing import Optional
import httpx
from dify_plugin import ModelProvider
from dify_plugin.entities.model import ModelType
from dify_plugin.errors.model import CredentialsValidateFailedError

logger = logging.getLogger(__name__)


class ModelsLabProvider(ModelProvider):
    """ModelsLab AI provider for Dify platform"""

    def validate_provider_credentials(self, credentials: dict) -> None:
        """
        Validate ModelsLab provider credentials by testing API connectivity.
        
        This method tests the API key by making a simple request to ModelsLab's API.
        It uses the LLM endpoint with a minimal request to verify authentication.
        
        Args:
            credentials: Dictionary containing ModelsLab credentials
                - modelslab_api_key: Required API key
                - modelslab_base_url: Optional base URL (defaults to official API)
                
        Raises:
            CredentialsValidateFailedError: If credentials are invalid or API is unreachable
        """
        api_key = credentials.get('modelslab_api_key')
        if not api_key:
            raise CredentialsValidateFailedError("ModelsLab API key is required")

        base_url = credentials.get('modelslab_base_url', 'https://modelslab.com/api/v6')
        
        try:
            # Test credentials using a simple LLM model validation
            model_instance = self.get_model_instance(ModelType.LLM)
            model_instance.validate_credentials(
                model="meta-llama/llama-3.1-8b-instruct",
                credentials=credentials
            )
            logger.info("ModelsLab provider credentials validated successfully")
            
        except CredentialsValidateFailedError:
            # Re-raise credential errors as-is
            raise
        except Exception as ex:
            logger.exception(f"ModelsLab provider credential validation failed: {ex}")
            
            # Provide helpful error messages based on common failure scenarios
            error_message = str(ex).lower()
            
            if "api key" in error_message or "unauthorized" in error_message:
                raise CredentialsValidateFailedError(
                    "Invalid ModelsLab API key. Please check your API key from https://modelslab.com/api-keys"
                )
            elif "network" in error_message or "connection" in error_message:
                raise CredentialsValidateFailedError(
                    "Cannot reach ModelsLab API. Please check your internet connection and try again."
                )
            elif "timeout" in error_message:
                raise CredentialsValidateFailedError(
                    "ModelsLab API request timed out. Please try again later."
                )
            else:
                raise CredentialsValidateFailedError(
                    f"ModelsLab API validation failed: {str(ex)[:100]}"
                )

    def get_provider_info(self) -> dict:
        """Get information about the ModelsLab provider"""
        return {
            "name": "ModelsLab",
            "description": "Comprehensive AI APIs for text, image, and video generation",
            "website": "https://modelslab.com",
            "documentation": "https://docs.modelslab.com",
            "supported_model_types": ["llm", "text-embedding", "text2img", "text2video"],
            "features": [
                "Latest LLM models (Llama 3.1, Mixtral, Gemini)",
                "Advanced image generation (Flux, SDXL, Playground v2.5)",
                "Video generation capabilities (CogVideoX, Mochi)",
                "High-quality text embeddings",
                "Competitive pricing and fast inference",
                "Global API availability"
            ]
        }

    def _test_api_connectivity(self, api_key: str, base_url: str) -> bool:
        """
        Test basic API connectivity using a simple endpoint.
        
        Args:
            api_key: ModelsLab API key
            base_url: ModelsLab API base URL
            
        Returns:
            True if API is reachable and key is valid
            
        Raises:
            Exception: If API test fails
        """
        try:
            # Use a simple models list endpoint to test connectivity
            test_url = f"{base_url.rstrip('/')}/models"
            
            with httpx.Client(timeout=30.0) as client:
                response = client.get(
                    test_url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                        "User-Agent": "Dify-ModelsLab-Plugin/1.0.0"
                    }
                )
                
                if response.status_code == 200:
                    logger.debug("ModelsLab API connectivity test successful")
                    return True
                elif response.status_code == 401:
                    raise Exception("Invalid API key")
                elif response.status_code == 403:
                    raise Exception("API key does not have required permissions")
                elif response.status_code >= 500:
                    raise Exception("ModelsLab API server error")
                else:
                    raise Exception(f"API test failed with status {response.status_code}")
                    
        except httpx.TimeoutException:
            raise Exception("API request timeout")
        except httpx.ConnectError:
            raise Exception("Network connection error")
        except Exception as e:
            # Re-raise with context
            raise Exception(f"API connectivity test failed: {str(e)}")

    @property 
    def supported_model_types(self) -> list[ModelType]:
        """Get list of model types supported by this provider"""
        return [
            ModelType.LLM,
            ModelType.TEXT_EMBEDDING, 
            ModelType.TEXT2IMG,
            ModelType.TEXT2VIDEO  # Innovation: First video provider in Dify
        ]

    @property
    def provider_schema(self) -> dict:
        """Get the provider schema information"""
        schema = super().get_provider_schema()
        schema.update({
            "provider": "modelslab",
            "label": {"en_US": "ModelsLab", "zh_Hans": "ModelsLab"},
            "description": {
                "en_US": "Comprehensive AI APIs for text, image, and video generation",
                "zh_Hans": "用于文本、图像和视频生成的综合 AI API"
            },
            "supported_model_types": ["llm", "text-embedding", "text2img", "text2video"]
        })
        return schema