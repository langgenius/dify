from typing import Any

from httpx import post

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.stability.tools.base import BaseStabilityAuthorization
from core.tools.tool.builtin_tool import BuiltinTool


class StableDiffusionTool(BuiltinTool, BaseStabilityAuthorization):
    """
    This class is responsible for providing the stable diffusion tool.
    """

    model_endpoint_map: dict[str, str] = {
        "sd3": "https://api.stability.ai/v2beta/stable-image/generate/sd3",
        "sd3-turbo": "https://api.stability.ai/v2beta/stable-image/generate/sd3",
        "core": "https://api.stability.ai/v2beta/stable-image/generate/core",
    }

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
        Invoke the tool.
        """
        payload = {
            "prompt": tool_parameters.get("prompt", ""),
            "aspect_ratio": tool_parameters.get("aspect_ratio", "16:9") or tool_parameters.get("aspect_radio", "16:9"),
            "mode": "text-to-image",
            "seed": tool_parameters.get("seed", 0),
            "output_format": "png",
        }

        model = tool_parameters.get("model", "core")

        if model in {"sd3", "sd3-turbo"}:
            payload["model"] = tool_parameters.get("model")

        if model != "sd3-turbo":
            payload["negative_prompt"] = tool_parameters.get("negative_prompt", "")

        response = post(
            self.model_endpoint_map[tool_parameters.get("model", "core")],
            headers={
                "accept": "image/*",
                **self.generate_authorization_headers(self.runtime.credentials),
            },
            files={key: (None, str(value)) for key, value in payload.items()},
            timeout=(5, 30),
        )

        if not response.status_code == 200:
            raise Exception(response.text)

        return self.create_blob_message(
            blob=response.content, meta={"mime_type": "image/png"}, save_as=self.VariableKey.IMAGE.value
        )
