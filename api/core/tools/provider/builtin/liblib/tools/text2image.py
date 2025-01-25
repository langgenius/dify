import json
import logging
import time
from enum import IntEnum
from typing import Dict

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.liblib.tools.liblib_client import LibLibClient
from core.tools.tool.builtin_tool import BuiltinTool

logger = logging.getLogger(__name__)


class GenerateStatus(IntEnum):
    """Image generation status codes"""
    PENDING = 1
    PREPARING = 2
    RUNNING = 3
    SAVING = 4
    COMPLETED = 5
    FAILED = 6


class Text2ImageTool(BuiltinTool):
    def _invoke(self, tool_parameters: Dict, **kwargs) -> ToolInvokeMessage:
        """Generate an image from text using LibLib API.
        
        Args:
            tool_parameters: A dictionary containing the generation parameters:
                - prompt: Text description of the desired image
                - negative_prompt: Text description of what to avoid in the image
                - width: Image width in pixels
                - height: Image height in pixels
                - num_inference_steps: Number of denoising steps
                - guidance_scale: How closely to follow the prompt
                - aspect_ratio: Desired aspect ratio of the image
                
        Returns:
            A ToolInvokeMessage containing the generated image URL
            
        Raises:
            ValueError: If the API request fails or returns invalid data
        """
        # Get credentials
        appkey = self.runtime.credentials.get("appkey")
        appsecret = self.runtime.credentials.get("appsecret")
        if not appkey or not appsecret:
            raise ValueError("Missing credentials: appkey or appsecret")
            
        # Initialize API client
        client = LibLibClient(appkey, appsecret)
        
        # Extract and validate parameters
        prompt = tool_parameters.get("prompt", "")
        negative_prompt = tool_parameters.get("negative_prompt", "")
        width = int(tool_parameters.get("width", 512))
        height = int(tool_parameters.get("height", 512))
        num_inference_steps = int(tool_parameters.get("num_inference_steps", 20))
        guidance_scale = float(tool_parameters.get("guidance_scale", 7.5))
        
        # Get model info
        model_info = {
            "url_type": "ultra",
            "text2img_template_uuid": "5d7e67009b344550bc1aa6ccbfa1d7f4"
        }
        
        # Generate image
        result = client.text_to_image(
            model_info=model_info,
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale
        )
        
        if not result.get('generateUuid'):
            raise ValueError("Failed to start image generation: missing generateUuid")
            
        # Poll for completion
        return self._wait_for_completion(client, result['generateUuid'])
        
    def _wait_for_completion(self, client: LibLibClient, generate_uuid: str) -> ToolInvokeMessage:
        """Wait for image generation to complete and return the result.
        
        Args:
            client: LibLib API client instance
            generate_uuid: UUID of the generation task
            
        Returns:
            ToolInvokeMessage containing the generated image URL
            
        Raises:
            ValueError: If the generation fails or times out
        """
        retries = 0
        max_retries = 3
        
        while True:
            try:
                # Get generation status
                status_uri = "/api/generate/webui/status"
                sign, timestamp, nonce = client._make_signature(status_uri)
                
                status_url = f"{LibLibClient._BASE_URL}{status_uri}"
                status_url += f"?AccessKey={client._appkey}"
                status_url += f"&Signature={sign}"
                status_url += f"&Timestamp={timestamp}"
                status_url += f"&SignatureNonce={nonce}"
                
                status_response = requests.post(
                    status_url,
                    headers={'Content-Type': 'application/json'},
                    json={"generateUuid": generate_uuid}
                )
                
                if status_response.status_code != 200:
                    raise ValueError(f"Status check failed with status code {status_response.status_code}")
                    
                try:
                    response_json = status_response.json()
                except json.JSONDecodeError as e:
                    raise ValueError(f"Invalid JSON response: {e}")
                    
                if not isinstance(response_json, dict):
                    raise ValueError(f"Invalid response format: {response_json}")
                    
                status_data = response_json.get('data')
                if not status_data:
                    if retries < max_retries:
                        retries += 1
                        time.sleep(1)
                        continue
                    raise ValueError(f"Invalid response: {response_json}")
                    
                # Check generation status
                status = GenerateStatus(int(status_data['generateStatus']))
                logger.debug(f"Generation status: {status.name}")
                
                if status == GenerateStatus.COMPLETED:
                    if not status_data.get('images'):
                        raise ValueError("Generation completed but no images returned")
                        
                    image = status_data['images'][0]
                    if not image.get('imageUrl'):
                        raise ValueError("Image data missing URL")
                        
                    return self.create_image_message(image=image['imageUrl'])
                    
                elif status == GenerateStatus.FAILED:
                    raise ValueError(f"Generation failed: {status_data.get('generateMsg', 'Unknown error')}")
                    
                # Still processing, wait and retry
                time.sleep(1)
                
            except Exception as e:
                if retries < max_retries:
                    retries += 1
                    time.sleep(1)
                    continue
                raise
