from base64 import b64decode
from typing import Any

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


def get_base_url(base_url: str) -> str:
    return base_url.rstrip("/").removesuffix("/v1-openai")


def get_common_params(tool_parameters: dict[str, Any]) -> dict[str, Any]:
    return {
        "cfg_scale": float(tool_parameters.get("cfg_scale", 4.5)),
        "model": tool_parameters.get("model").strip(),
        "prompt": tool_parameters.get("prompt", "").strip(),
        "n": int(tool_parameters.get("n", 1)),
        "size": tool_parameters.get("size", "512x512"),
        "sample_method": tool_parameters.get("sample_method", "euler"),
        "sampling_steps": int(tool_parameters.get("sampling_steps", 20)),
        "schedule_method": tool_parameters.get("schedule_method", "discrete"),
        "guidance": float(tool_parameters.get("guidance", 3.5)),
        "seed": tool_parameters.get("seed"),
        "negative_prompt": tool_parameters.get("negative_prompt", "").strip(),
    }


def handle_api_error(response: requests.Response) -> str:
    try:
        error_data = response.json()
        return error_data.get("error", {}).get("message", f"Error: {response.status_code}")
    except requests.JSONDecodeError:
        return f"Error: {response.status_code} - {response.text[:200]}"


def handle_image_response(
    result: list[ToolInvokeMessage],
    response: requests.Response,
    tool: BuiltinTool,
) -> list[ToolInvokeMessage]:
    for image_data in response.json().get("data", []):
        if image_data.get("b64_json"):
            result.append(
                tool.create_blob_message(
                    blob=b64decode(image_data["b64_json"]),
                    meta={"mime_type": "image/png"},
                    save_as=tool.VariableKey.IMAGE.value,
                )
            )
    return result
