from typing import Any, Union, List
import requests
from requests.exceptions import RequestException
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
SILICONFLOW_API_URL = "https://api.siliconflow.cn/v1/image/generations"
MODEL_NAME = "deepseek-ai/Janus-Pro-7B"
class JanusTool(BuiltinTool):
    """Tool for generating images using the Janus Pro 7B model via SiliconFlow API.
    
    This model generates 384x384 resolution images. The generated image URLs are valid for 1 hour.
    """
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """Invoke the Janus Pro 7B model to generate images.
        Args:
            user_id: The ID of the user making the request
            tool_parameters: Dictionary containing:
                - prompt: Text description of the image to generate
                - seed (optional): Random seed for reproducible generation
        Returns:
            List of messages containing the API response and generated image URLs
        Raises:
            RequestException: If there is an error communicating with the API
        """
        if not tool_parameters.get("prompt"):
            return self.create_text_message("Error: prompt is required")
        headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "authorization": f"Bearer {self.runtime.credentials['siliconFlow_api_key']}",
        }
        # Prepare the payload with required parameters
        payload = {
            "model": MODEL_NAME,
            "prompt": tool_parameters["prompt"],  # 已验证存在
        }
        # Add optional seed if provided
        if "seed" in tool_parameters and tool_parameters["seed"] is not None:
            try:
                seed = int(tool_parameters["seed"])
                if 1 <= seed <= 9999999999:
                    payload["seed"] = seed
            except (ValueError, TypeError):
                pass  # 忽略无效的 seed 值
        try:
            # Make the API request
            response = requests.post(SILICONFLOW_API_URL, json=payload, headers=headers, timeout=30)
            response.raise_for_status()
            
            # Process the response
            res = response.json()
            result = [self.create_json_message(res)]
            
            # Extract and save image URLs (valid for 1 hour)
            images = res.get("images", [])
            if not images:
                return self.create_text_message("No images were generated")
                
            for image in images:
                if image_url := image.get("url"):
                    result.append(
                        self.create_image_message(
                            image=image_url,
                            save_as=self.VariableKey.IMAGE.value
                        )
                    )
            
            return result
        except RequestException as e:
            return self.create_text_message(f"Error generating image: {str(e)}")
        except Exception as e:
            return self.create_text_message(f"Unexpected error: {str(e)}") 