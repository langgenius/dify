"""
Text Classification Tool

Invokes the NeuroSD classification API to classify text into service and type categories.
"""

import json
from collections.abc import Generator
from typing import Any

from core.helper import ssrf_proxy
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError

DEFAULT_API_URL = "http://172.17.0.1:8000"
CLASSIFICATION_TIMEOUT = (10, 60)  # (connect_timeout, read_timeout)


class ClassifyTextTool(BuiltinTool):
    """
    Tool for classifying text using the NeuroSD neural network API.

    Returns the predicted service and type for the input text.
    """

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Invoke the classification API.

        :param user_id: The user ID
        :param tool_parameters: Parameters containing 'text' and optionally 'api_url'
        :return: Generator yielding ToolInvokeMessage with classification results
        :raises ToolInvokeError: If the API call fails
        """
        text = tool_parameters.get("text", "").strip()
        if not text:
            raise ToolInvokeError("Text parameter is required and cannot be empty")

        api_url = tool_parameters.get("api_url", DEFAULT_API_URL).rstrip("/")
        predict_url = f"{api_url}/predict"

        try:
            response = ssrf_proxy.post(
                predict_url,
                json={"text": text},
                headers={"Content-Type": "application/json"},
                timeout=CLASSIFICATION_TIMEOUT,
            )

            if response.status_code != 200:
                error_msg = f"Classification API returned status {response.status_code}"
                try:
                    error_detail = response.json().get("detail", response.text)
                    error_msg = f"{error_msg}: {error_detail}"
                except Exception:
                    error_msg = f"{error_msg}: {response.text}"
                raise ToolInvokeError(error_msg)

            result = response.json()

            # Create a formatted response
            service = result.get("service", "Unknown")
            type_name = result.get("type", "Unknown")

            # Yield JSON message for structured data
            yield self.create_json_message({
                "service": service,
                "type": type_name,
            })

            # Yield text message for display
            formatted_text = (
                f"Результат классификации:\n"
                f"• Сервис: {service}\n"
                f"• Тип: {type_name}"
            )
            yield self.create_text_message(formatted_text)

        except ToolInvokeError:
            raise
        except Exception as e:
            raise ToolInvokeError(f"Failed to call classification API: {e}") from e
