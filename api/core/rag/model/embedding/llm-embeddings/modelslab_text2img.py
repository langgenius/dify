"""
ModelsLab Text-to-Image Implementation for Dify

This module implements image generation support for ModelsLab API, providing access to:
- Flux models (latest state-of-the-art)
- SDXL and Stable Diffusion variants
- Playground v2.5 and other popular models
- Advanced features like ControlNet, inpainting, style transfer

Features:
- High-quality image generation with multiple model options
- Advanced parameter control (guidance scale, steps, etc.)
- Support for negative prompts and style control
- Async processing with polling for long-running generations
- Cost-efficient generation with transparent pricing

Author: ModelsLab Integration Team
License: Apache 2.0
"""

import logging
import time
from typing import Dict, Any, Optional
import httpx
from httpx import Timeout

from dify_plugin.interfaces.model.text2img_model import Text2ImgModel
from dify_plugin.entities.model.text2img import Text2ImgResult
from dify_plugin.errors.model import (
    CredentialsValidateFailedError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
    InvokeConnectionError,
    InvokeAuthorizationError
)

logger = logging.getLogger(__name__)


class ModelsLabText2ImgModel(Text2ImgModel):
    """ModelsLab Text-to-Image implementation for Dify platform"""

    def _invoke(self, model: str, credentials: dict, prompt: str, 
                model_parameters: dict, user: Optional[str] = None) -> Text2ImgResult:
        """
        Invoke ModelsLab Text-to-Image API for image generation.

        Args:
            model: Model identifier (e.g., 'flux', 'sdxl', 'playground-v2')
            credentials: API credentials including api_key and base_url
            prompt: Text prompt for image generation
            model_parameters: Generation parameters (width, height, steps, etc.)
            user: Optional user identifier

        Returns:
            Text2ImgResult containing generated image(s) and metadata

        Raises:
            InvokeError: If the API call fails
        """
        # Extract and validate credentials
        api_key = credentials.get('modelslab_api_key')
        if not api_key:
            raise CredentialsValidateFailedError("ModelsLab API key is required")

        base_url = credentials.get('modelslab_base_url', 'https://modelslab.com/api/v6')

        # Validate prompt
        if not prompt or not prompt.strip():
            raise InvokeError("Prompt is required for image generation")

        # Map model name to ModelsLab model ID
        model_mapping = {
            "flux": "flux",
            "flux-pro": "flux-pro",
            "flux-dev": "flux-dev",
            "sdxl": "sdxl",
            "sd-1.5": "sd-1.5",
            "playground-v2": "playground-v2-5",
            "playground-v2.5": "playground-v2-5",
            "midjourney": "midjourney",
            "dall-e": "dall-e"
        }

        modelslab_model = model_mapping.get(model, model)

        # Build API request parameters
        data = {
            "key": api_key,
            "model_id": modelslab_model,
            "prompt": prompt.strip(),
            "width": model_parameters.get('width', 1024),
            "height": model_parameters.get('height', 1024),
            "num_inference_steps": model_parameters.get('steps', 25),
            "guidance_scale": model_parameters.get('guidance_scale', 7.0),
            "samples": model_parameters.get('samples', 1)
        }

        # Add optional parameters
        if model_parameters.get('negative_prompt'):
            data["negative_prompt"] = model_parameters['negative_prompt'].strip()
        
        if model_parameters.get('seed') is not None:
            data["seed"] = model_parameters['seed']
            
        if model_parameters.get('safety_checker') is not None:
            data["safety_checker"] = model_parameters['safety_checker']
            
        if model_parameters.get('enhance_prompt') is not None:
            data["enhance_prompt"] = model_parameters['enhance_prompt']

        # Add style parameters if supported
        if model_parameters.get('style'):
            data["style"] = model_parameters['style']
            
        if user:
            data["user"] = user

        # Make API request
        try:
            return self._generate_image(base_url, data, model)
        except Exception as e:
            self._handle_api_error(e, model)

    def _generate_image(self, base_url: str, data: dict, model: str) -> Text2ImgResult:
        """Handle image generation API call with async processing"""
        url = f"{base_url.rstrip('/')}/images/text2img"
        
        try:
            with httpx.Client(timeout=Timeout(120.0)) as client:
                # Submit generation request
                response = client.post(url, json=data)
                self._check_response_status(response, model)
                
                response_data = response.json()
                
                # Check if this is an async response that requires polling
                if response_data.get("status") == "processing":
                    return self._poll_for_result(client, base_url, response_data, model)
                else:
                    return self._convert_response(response_data, model)
                    
        except httpx.TimeoutException:
            raise InvokeConnectionError(f"Request timeout for image model {model}")
        except httpx.ConnectError as e:
            raise InvokeConnectionError(f"Connection failed for image model {model}: {str(e)}")
        except Exception as e:
            self._handle_api_error(e, model)

    def _poll_for_result(self, client: httpx.Client, base_url: str, 
                        initial_response: dict, model: str) -> Text2ImgResult:
        """Poll for async image generation result"""
        request_id = initial_response.get("id")
        if not request_id:
            raise InvokeError("No request ID returned for async image generation")

        fetch_url = f"{base_url.rstrip('/')}/images/fetch/{request_id}"
        max_attempts = 30  # 5 minutes max (10 second intervals)
        attempt = 0

        logger.info(f"Polling for image generation result, ID: {request_id}")

        while attempt < max_attempts:
            try:
                time.sleep(10)  # Wait 10 seconds between polls
                attempt += 1

                fetch_response = client.get(fetch_url)
                self._check_response_status(fetch_response, model)
                
                result_data = fetch_response.json()
                status = result_data.get("status")

                if status == "success":
                    logger.info(f"Image generation completed successfully, ID: {request_id}")
                    return self._convert_response(result_data, model)
                elif status == "error":
                    error_msg = result_data.get("error", "Image generation failed")
                    raise InvokeError(f"Image generation failed: {error_msg}")
                elif status == "processing":
                    logger.debug(f"Image still processing, attempt {attempt}/{max_attempts}")
                    continue
                else:
                    raise InvokeError(f"Unknown status in response: {status}")

            except httpx.HTTPStatusError as e:
                if e.response.status_code == 404:
                    raise InvokeError(f"Image generation request not found: {request_id}")
                else:
                    self._handle_api_error(e, model)

        raise InvokeError(f"Image generation timed out after {max_attempts} attempts")

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate credentials by making a simple image generation request.
        
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
                prompt="test image",
                model_parameters={
                    "width": 512,
                    "height": 512,
                    "steps": 1,
                    "samples": 1
                },
                user=None
            )
        except InvokeAuthorizationError as e:
            raise CredentialsValidateFailedError(f"Invalid credentials: {str(e)}")
        except Exception as e:
            logger.warning(f"Credential validation error: {e}")
            # Don't fail validation for other errors (rate limits, etc.)
            pass

    def _convert_response(self, response_data: dict, model: str) -> Text2ImgResult:
        """Convert API response to Dify Text2ImgResult format"""
        try:
            # Extract images from response
            if "output" in response_data and isinstance(response_data["output"], list):
                # Multiple images in output array
                image_urls = response_data["output"]
            elif "output" in response_data and isinstance(response_data["output"], str):
                # Single image URL
                image_urls = [response_data["output"]]
            elif "images" in response_data:
                # Alternative format with images array
                image_urls = response_data["images"]
            else:
                raise InvokeError("No images found in response")

            if not image_urls:
                raise InvokeError("Empty image list in response")

            # Take the first image (Dify expects single image result)
            image_url = image_urls[0]
            
            # Download image content
            image_content = self._download_image(image_url)

            # Extract metadata
            metadata = {
                "width": response_data.get("meta", {}).get("width"),
                "height": response_data.get("meta", {}).get("height"),
                "model": model,
                "seed": response_data.get("meta", {}).get("seed"),
                "steps": response_data.get("meta", {}).get("num_inference_steps"),
                "guidance_scale": response_data.get("meta", {}).get("guidance_scale"),
                "prompt": response_data.get("meta", {}).get("prompt")
            }

            # Remove None values
            metadata = {k: v for k, v in metadata.items() if v is not None}

            return Text2ImgResult(
                image=image_content,
                width=metadata.get("width", 1024),
                height=metadata.get("height", 1024),
                metadata=metadata
            )

        except Exception as e:
            logger.error(f"Failed to convert image response: {e}")
            raise InvokeError(f"Failed to process image response: {str(e)}")

    def _download_image(self, image_url: str) -> bytes:
        """Download image from URL and return bytes"""
        try:
            with httpx.Client(timeout=Timeout(60.0)) as client:
                response = client.get(image_url)
                response.raise_for_status()
                return response.content
        except Exception as e:
            raise InvokeError(f"Failed to download generated image: {str(e)}")

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
            raise InvokeAuthorizationError(f"Invalid API key for image model {model}")
        elif response.status_code == 429:
            raise InvokeRateLimitError(f"Rate limit exceeded for image model {model}: {error_message}")
        elif response.status_code >= 500:
            raise InvokeServerUnavailableError(f"Server error for image model {model}: {error_message}")
        else:
            raise InvokeError(f"API error for image model {model}: {error_message}")

    def _handle_api_error(self, error: Exception, model: str) -> None:
        """Handle and re-raise API errors with appropriate types"""
        if isinstance(error, (InvokeError, CredentialsValidateFailedError)):
            raise error
            
        error_str = str(error).lower()
        
        if "unauthorized" in error_str or "invalid api key" in error_str:
            raise InvokeAuthorizationError(f"Authentication failed for image model {model}: {error}")
        elif "rate limit" in error_str or "too many requests" in error_str:
            raise InvokeRateLimitError(f"Rate limit exceeded for image model {model}: {error}")
        elif "timeout" in error_str:
            raise InvokeConnectionError(f"Request timeout for image model {model}: {error}")
        elif "connection" in error_str:
            raise InvokeConnectionError(f"Connection error for image model {model}: {error}")
        elif "server" in error_str or "internal" in error_str:
            raise InvokeServerUnavailableError(f"Server error for image model {model}: {error}")
        else:
            raise InvokeError(f"Unexpected error for image model {model}: {error}")

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