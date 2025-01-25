from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

from .utils import get_base_url, get_common_params, handle_api_error, handle_image_response


class TextToImageTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        try:
            params = get_common_params(tool_parameters)
            base_url = get_base_url(self.runtime.credentials["base_url"])
            response = requests.post(
                f"{base_url}/v1-openai/images/generations",
                headers={"Authorization": f"Bearer {self.runtime.credentials['api_key']}"},
                json=params,
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
