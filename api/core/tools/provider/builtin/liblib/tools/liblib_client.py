import base64
import hmac
import json
import logging
import time
import uuid
from hashlib import sha1
from typing import Dict, Optional

import requests

logger = logging.getLogger(__name__)


class LibLibClient:
    """Client for interacting with the LibLib API."""
    
    _BASE_URL = 'https://openapi.liblibai.cloud'

    def __init__(self, appkey: str, appsecret: str):
        """Initialize the LibLib API client.
        
        Args:
            appkey: API access key
            appsecret: API secret key
        """
        self._appkey = appkey
        self._appsecret = appsecret

    def _make_signature(self, uri: str) -> tuple[str, str, str]:
        """Generate signature for API request.
        
        Args:
            uri: API endpoint URI
            
        Returns:
            Tuple of (signature, timestamp, nonce)
        """
        timestamp = str(int(time.time() * 1000))
        signature_nonce = str(uuid.uuid4())
        content = '&'.join((uri, timestamp, signature_nonce))
        
        digest = hmac.new(self._appsecret.encode(), content.encode(), sha1).digest()
        sign = base64.urlsafe_b64encode(digest).rstrip(b'=').decode()
        
        return sign, timestamp, signature_nonce

    def _make_request(self, uri: str, params: Dict) -> Dict:
        """Make an authenticated request to the API.
        
        Args:
            uri: API endpoint URI
            params: Request parameters
            
        Returns:
            API response data
            
        Raises:
            ValueError: If the request fails or returns an error
        """
        sign, timestamp, nonce = self._make_signature(uri)
        
        url = f"{self._BASE_URL}{uri}"
        url += f"?AccessKey={self._appkey}"
        url += f"&Signature={sign}"
        url += f"&Timestamp={timestamp}"
        url += f"&SignatureNonce={nonce}"
        
        response = requests.post(
            url,
            headers={'Content-Type': 'application/json'},
            json=params
        )
        
        if response.status_code != 200:
            raise ValueError(f"Request failed with status code {response.status_code}")
        
        try:
            data = response.json()
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON response: {e}")
            
        if data.get('code') != 0:
            raise ValueError(f"API error: {data.get('msg', 'Unknown error')}")
            
        return data['data']

    def text_to_image(
        self,
        model_info: Dict,
        prompt: str,
        negative_prompt: str = "",
        width: Optional[int] = None,
        height: Optional[int] = None,
        num_inference_steps: int = 20,
        guidance_scale: float = 7.5
    ) -> Dict:
        """Generate image from text description.
        
        Args:
            model_info: Model configuration
            prompt: Text description of the desired image
            negative_prompt: Text description of what to avoid
            width: Image width in pixels (512-2048)
            height: Image height in pixels (512-2048)
            num_inference_steps: Number of denoising steps
            guidance_scale: How closely to follow the prompt
            
        Returns:
            Generation task information including UUID
            
        Raises:
            ValueError: If parameters are invalid
        """
        uri = f"/api/generate/webui/text2img/{model_info['url_type']}"
        
        # Validate dimensions
        if width is not None and (width < 512 or width > 2048):
            raise ValueError("Width must be between 512 and 2048 pixels")
        if height is not None and (height < 512 or height > 2048):
            raise ValueError("Height must be between 512 and 2048 pixels")

        # Use default size if not specified
        image_size = {
            "width": width if width is not None else 512,
            "height": height if height is not None else 512
        }
            
        params = {
            "templateUuid": model_info['text2img_template_uuid'],
            "generateParams": {
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "imageSize": image_size,
                "num_inference_steps": num_inference_steps,
                "guidance_scale": guidance_scale,
                "imgCount": 1
            }
        }
            
        return self._make_request(uri, params)
