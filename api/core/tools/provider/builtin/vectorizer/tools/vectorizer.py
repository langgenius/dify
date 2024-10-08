from typing import Any, Union

from httpx import post

from core.file.enums import FileType
from core.file.file_manager import _get_url_or_b64_data
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolParameterValidationError, ToolProviderCredentialValidationError
from core.tools.tool.builtin_tool import BuiltinTool


class VectorizerTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        api_key_name = self.runtime.credentials.get("api_key_name", "")
        api_key_value = self.runtime.credentials.get("api_key_value", "")
        mode = tool_parameters.get("mode", "test")

        if not api_key_name or not api_key_value:
            raise ToolProviderCredentialValidationError("Please input api key name and value")
    
        image = tool_parameters.get("image")
        if not image or image.type != FileType.IMAGE:
            raise ToolParameterValidationError("Not a valid image")
        
        image_data = _get_url_or_b64_data(image)
        payload = {"mode": mode}
        if image_data.startswith("http"):
            payload["image.url"] = image_data
        else:
            image_data = image_data.split("base64,")[-1]
            payload["image.base64"] = image_data

        response = post(
            "https://vectorizer.ai/api/v1/vectorize",
            data=payload,
            auth=(api_key_name, api_key_value),
            timeout=30,
        )

        if response.status_code != 200:
            raise Exception(response.text)

        return [
            self.create_text_message("the vectorized svg is saved as an image."),
            self.create_blob_message(blob=response.content, meta={"mime_type": "image/svg+xml"}),
        ]
