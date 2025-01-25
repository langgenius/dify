import io
from typing import Any, Union

import requests

from core.file.enums import FileType
from core.file.file_manager import download
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

from .utils import get_base_url, get_common_params, handle_api_error, handle_image_response


class ImageEditTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        image = tool_parameters.get("image")
        if image.type != FileType.IMAGE:
            return [self.create_text_message("Not a valid image file")]

        try:
            params = get_common_params(tool_parameters)
            params["strength"] = tool_parameters.get("strength", 0.75)

            image_binary = io.BytesIO(download(image))
            files = {"image": ("image.png", image_binary, "image/png")}

            base_url = get_base_url(self.runtime.credentials["base_url"])
            response = requests.post(
                f"{base_url}/v1-openai/images/edits",
                headers={"Authorization": f"Bearer {self.runtime.credentials['api_key']}"},
                data=params,
                files=files,
                verify=self.runtime.credentials.get("tls_verify", True),
            )

            if not response.ok:
                return self.create_text_message(handle_api_error(response))

            result = []
            return handle_image_response(result, response, self)

        except ValueError as e:
            return self.create_text_message(str(e))
        except Exception as e:
            return self.create_text_message(f"An error occurred: {str(e)}")
