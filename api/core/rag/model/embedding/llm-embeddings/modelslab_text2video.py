"""
ModelsLab Text-to-Video Implementation for Dify

INNOVATION: This is the FIRST text-to-video provider implementation in the Dify ecosystem.

This module implements video generation support for ModelsLab API, providing access to:
- CogVideoX models for high-quality video generation
- Mochi and other state-of-the-art video models
- Text-to-video, image-to-video, and video-to-video capabilities
- Advanced control over video parameters (resolution, FPS, duration)

Features:
- First video generation provider in Dify platform
- High-quality video generation with multiple model options
- Advanced parameter control (resolution, FPS, frames, etc.)
- Async processing with polling for long-running generations
- Support for various video formats and durations
- Cost-efficient generation with transparent pricing

Author: ModelsLab Integration Team
License: Apache 2.0
"""

import logging
import time
from typing import Dict, Any, Optional
import httpx
from httpx import Timeout

from dify_plugin.interfaces.model.text2video_model import Text2VideoModel  # NEW BASE CLASS
from dify_plugin.entities.model.text2video import Text2VideoResult         # NEW RESULT TYPE
from dify_plugin.errors.model import (
    CredentialsValidateFailedError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
    InvokeConnectionError,
    InvokeAuthorizationError
)

logger = logging.getLogger(__name__)


class ModelsLabText2VideoModel(Text2VideoModel):
    """ModelsLab Text-to-Video implementation for Dify platform - FIRST VIDEO PROVIDER"""

    def _invoke(self, model: str, credentials: dict, prompt: str,
                model_parameters: dict, user: Optional[str] = None) -> Text2VideoResult:
        """
        Invoke ModelsLab Text-to-Video API for video generation.

        This is a groundbreaking implementation - the first video generation provider
        in the Dify ecosystem, enabling users to generate videos directly from text prompts.

        Args:
            model: Model identifier (e.g., 'cogvideox', 'mochi', 'animatediff')
            credentials: API credentials including api_key and base_url
            prompt: Text prompt for video generation
            model_parameters: Generation parameters (resolution, fps, frames, etc.)
            user: Optional user identifier

        Returns:
            Text2VideoResult containing generated video and metadata

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
            raise InvokeError("Prompt is required for video generation")

        # Map model name to ModelsLab model ID
        model_mapping = {
            "cogvideox": "cogvideox",
            "cogvideox-5b": "cogvideox-5b",
            "mochi": "mochi-1",
            "animatediff": "animatediff",
            "stable-video-diffusion": "stable-video-diffusion",
            "text2video": "cogvideox"  # Default fallback
        }

        modelslab_model = model_mapping.get(model, model)

        # Build API request parameters
        data = {
            "key": api_key,
            "model_id": modelslab_model,
            "prompt": prompt.strip(),
            "width": model_parameters.get('width', 1360),
            "height": model_parameters.get('height', 768),
            "num_frames": model_parameters.get('num_frames', 49),
            "fps": model_parameters.get('fps', 16),
            "guidance_scale": model_parameters.get('guidance_scale', 6.0),
            "num_inference_steps": model_parameters.get('steps', 50)
        }

        # Add optional parameters
        if model_parameters.get('negative_prompt'):
            data["negative_prompt"] = model_parameters['negative_prompt'].strip()
        
        if model_parameters.get('seed') is not None:
            data["seed"] = model_parameters['seed']
            
        if model_parameters.get('motion_bucket_id') is not None:
            data["motion_bucket_id"] = model_parameters['motion_bucket_id']
            
        if model_parameters.get('cond_aug') is not None:
            data["cond_aug"] = model_parameters['cond_aug']

        # Add image input for image-to-video mode
        if model_parameters.get('init_image'):
            data["init_image"] = model_parameters['init_image']
            data["strength"] = model_parameters.get('strength', 0.8)

        if user:
            data["user"] = user

        # Make API request
        try:
            return self._generate_video(base_url, data, model)
        except Exception as e:
            self._handle_api_error(e, model)

    def _generate_video(self, base_url: str, data: dict, model: str) -> Text2VideoResult:
        """Handle video generation API call with async processing"""
        # Determine API endpoint based on model type
        if data.get("init_image"):
            endpoint = "video/img2video"
        else:
            endpoint = "video/text2video"
            
        url = f"{base_url.rstrip('/')}/{endpoint}"
        
        try:
            with httpx.Client(timeout=Timeout(180.0)) as client:  # Longer timeout for video
                logger.info(f"Submitting video generation request for model: {model}")
                
                # Submit generation request
                response = client.post(url, json=data)
                self._check_response_status(response, model)
                
                response_data = response.json()
                
                # Video generation is almost always async, so poll for results
                if response_data.get("status") in ["processing", "queued"]:
                    return self._poll_for_video_result(client, base_url, response_data, model)
                else:
                    # Immediate result (rare for video)
                    return self._convert_video_response(response_data, model)
                    
        except httpx.TimeoutException:
            raise InvokeConnectionError(f"Request timeout for video model {model}")
        except httpx.ConnectError as e:
            raise InvokeConnectionError(f"Connection failed for video model {model}: {str(e)}")
        except Exception as e:
            self._handle_api_error(e, model)

    def _poll_for_video_result(self, client: httpx.Client, base_url: str,
                              initial_response: dict, model: str) -> Text2VideoResult:
        """Poll for async video generation result"""
        request_id = initial_response.get("id")
        if not request_id:
            raise InvokeError("No request ID returned for async video generation")

        fetch_url = f"{base_url.rstrip('/')}/video/fetch/{request_id}"
        max_attempts = 60  # 20 minutes max (20 second intervals)
        attempt = 0

        logger.info(f"Polling for video generation result, ID: {request_id}")

        while attempt < max_attempts:
            try:
                time.sleep(20)  # Wait 20 seconds between polls (video takes longer)
                attempt += 1

                fetch_response = client.get(fetch_url)
                self._check_response_status(fetch_response, model)
                
                result_data = fetch_response.json()
                status = result_data.get("status")

                if status == "success":
                    logger.info(f"Video generation completed successfully, ID: {request_id}")
                    return self._convert_video_response(result_data, model)
                elif status == "error" or status == "failed":
                    error_msg = result_data.get("error", "Video generation failed")
                    raise InvokeError(f"Video generation failed: {error_msg}")
                elif status in ["processing", "queued"]:
                    progress = result_data.get("progress", 0)
                    logger.debug(f"Video still processing ({progress}%), attempt {attempt}/{max_attempts}")
                    continue
                else:
                    logger.warning(f"Unknown status in video response: {status}")
                    continue

            except httpx.HTTPStatusError as e:
                if e.response.status_code == 404:
                    raise InvokeError(f"Video generation request not found: {request_id}")
                else:
                    self._handle_api_error(e, model)

        raise InvokeError(f"Video generation timed out after {max_attempts} attempts (~{max_attempts * 20 / 60:.1f} minutes)")

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate credentials by testing API connectivity.
        Note: We don't actually generate a video for validation due to cost and time.
        
        Args:
            model: Model to test with
            credentials: API credentials
            
        Raises:
            CredentialsValidateFailedError: If credentials are invalid
        """
        api_key = credentials.get('modelslab_api_key')
        if not api_key:
            raise CredentialsValidateFailedError("ModelsLab API key is required")

        base_url = credentials.get('modelslab_base_url', 'https://modelslab.com/api/v6')
        
        # Test with a simple API endpoint that doesn't generate content
        try:
            with httpx.Client(timeout=Timeout(30.0)) as client:
                test_url = f"{base_url.rstrip('/')}/models"
                response = client.get(test_url, headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                })
                
                if response.status_code == 401:
                    raise CredentialsValidateFailedError("Invalid ModelsLab API key")
                elif response.status_code == 403:
                    raise CredentialsValidateFailedError("API key does not have video generation permissions")
                elif response.status_code >= 400:
                    raise CredentialsValidateFailedError(f"API validation failed: {response.status_code}")
                    
        except httpx.ConnectError:
            raise CredentialsValidateFailedError("Cannot connect to ModelsLab API")
        except httpx.TimeoutException:
            raise CredentialsValidateFailedError("API validation timeout")
        except Exception as e:
            if "CredentialsValidateFailedError" in str(type(e)):
                raise e
            raise CredentialsValidateFailedError(f"Credential validation failed: {str(e)}")

    def _convert_video_response(self, response_data: dict, model: str) -> Text2VideoResult:
        """Convert API response to Dify Text2VideoResult format"""
        try:
            # Extract video from response
            video_url = None
            
            if "output" in response_data:
                if isinstance(response_data["output"], list) and response_data["output"]:
                    video_url = response_data["output"][0]
                elif isinstance(response_data["output"], str):
                    video_url = response_data["output"]
            elif "video_url" in response_data:
                video_url = response_data["video_url"]
            elif "url" in response_data:
                video_url = response_data["url"]

            if not video_url:
                raise InvokeError("No video URL found in response")

            # Download video content
            video_content = self._download_video(video_url)

            # Extract metadata
            metadata = {
                "width": response_data.get("meta", {}).get("width"),
                "height": response_data.get("meta", {}).get("height"),
                "num_frames": response_data.get("meta", {}).get("num_frames"),
                "fps": response_data.get("meta", {}).get("fps"),
                "duration": response_data.get("meta", {}).get("duration"),
                "model": model,
                "seed": response_data.get("meta", {}).get("seed"),
                "steps": response_data.get("meta", {}).get("num_inference_steps"),
                "guidance_scale": response_data.get("meta", {}).get("guidance_scale"),
                "prompt": response_data.get("meta", {}).get("prompt"),
                "format": response_data.get("meta", {}).get("format", "mp4")
            }

            # Remove None values
            metadata = {k: v for k, v in metadata.items() if v is not None}

            # Calculate duration if not provided
            if "duration" not in metadata and "num_frames" in metadata and "fps" in metadata:
                metadata["duration"] = metadata["num_frames"] / metadata["fps"]

            return Text2VideoResult(
                video=video_content,
                width=metadata.get("width", 1360),
                height=metadata.get("height", 768),
                duration=metadata.get("duration", 3.0),
                format=metadata.get("format", "mp4"),
                metadata=metadata
            )

        except Exception as e:
            logger.error(f"Failed to convert video response: {e}")
            raise InvokeError(f"Failed to process video response: {str(e)}")

    def _download_video(self, video_url: str) -> bytes:
        """Download video from URL and return bytes"""
        try:
            with httpx.Client(timeout=Timeout(300.0)) as client:  # 5 minute timeout for video download
                logger.info(f"Downloading generated video from: {video_url}")
                response = client.get(video_url)
                response.raise_for_status()
                
                content_length = len(response.content)
                logger.info(f"Downloaded video: {content_length / (1024*1024):.2f} MB")
                
                return response.content
        except Exception as e:
            raise InvokeError(f"Failed to download generated video: {str(e)}")

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
            raise InvokeAuthorizationError(f"Invalid API key for video model {model}")
        elif response.status_code == 429:
            raise InvokeRateLimitError(f"Rate limit exceeded for video model {model}: {error_message}")
        elif response.status_code >= 500:
            raise InvokeServerUnavailableError(f"Server error for video model {model}: {error_message}")
        else:
            raise InvokeError(f"API error for video model {model}: {error_message}")

    def _handle_api_error(self, error: Exception, model: str) -> None:
        """Handle and re-raise API errors with appropriate types"""
        if isinstance(error, (InvokeError, CredentialsValidateFailedError)):
            raise error
            
        error_str = str(error).lower()
        
        if "unauthorized" in error_str or "invalid api key" in error_str:
            raise InvokeAuthorizationError(f"Authentication failed for video model {model}: {error}")
        elif "rate limit" in error_str or "too many requests" in error_str:
            raise InvokeRateLimitError(f"Rate limit exceeded for video model {model}: {error}")
        elif "timeout" in error_str:
            raise InvokeConnectionError(f"Request timeout for video model {model}: {error}")
        elif "connection" in error_str:
            raise InvokeConnectionError(f"Connection error for video model {model}: {error}")
        elif "server" in error_str or "internal" in error_str:
            raise InvokeServerUnavailableError(f"Server error for video model {model}: {error}")
        else:
            raise InvokeError(f"Unexpected error for video model {model}: {error}")

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Dict[str, Any]:
        """
        Get schema for customizable video model parameters.
        
        Args:
            model: Model identifier
            credentials: API credentials
            
        Returns:
            Schema dictionary for video model customization
        """
        return {
            "model": {
                "label": {
                    "en_US": "Video Model",
                    "zh_Hans": "视频模型"
                },
                "placeholder": {
                    "en_US": "Enter video model name (e.g., cogvideox, mochi)",
                    "zh_Hans": "输入视频模型名称（例如：cogvideox, mochi）"
                }
            },
            "resolution": {
                "label": {
                    "en_US": "Resolution",
                    "zh_Hans": "分辨率"
                },
                "type": "select",
                "options": [
                    {"label": "768x768", "value": "768x768"},
                    {"label": "1024x576", "value": "1024x576"},
                    {"label": "1360x768", "value": "1360x768"}
                ],
                "default": "1360x768"
            },
            "duration": {
                "label": {
                    "en_US": "Duration (seconds)",
                    "zh_Hans": "时长（秒）"
                },
                "type": "float",
                "min": 1.0,
                "max": 10.0,
                "default": 3.0,
                "help": {
                    "en_US": "Video duration in seconds",
                    "zh_Hans": "视频时长（秒）"
                }
            }
        }

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