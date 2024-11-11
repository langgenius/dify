import json
from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.did.did_appx import DIDApp
from core.tools.tool.builtin_tool import BuiltinTool


class AnimationsTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        app = DIDApp(api_key=self.runtime.credentials["did_api_key"], base_url=self.runtime.credentials["base_url"])

        driver_expressions_str = tool_parameters.get("driver_expressions")
        driver_expressions = json.loads(driver_expressions_str) if driver_expressions_str else None

        config = {
            "stitch": tool_parameters.get("stitch", True),
            "mute": tool_parameters.get("mute"),
            "result_format": tool_parameters.get("result_format") or "mp4",
        }
        config = {k: v for k, v in config.items() if v is not None and v != ""}

        options = {
            "source_url": tool_parameters["source_url"],
            "driver_url": tool_parameters.get("driver_url"),
            "config": config,
        }
        options = {k: v for k, v in options.items() if v is not None and v != ""}

        if not options.get("source_url"):
            raise ValueError("Source URL is required")

        if config.get("logo_url"):
            if not config.get("logo_x"):
                raise ValueError("Logo X position is required when logo URL is provided")
            if not config.get("logo_y"):
                raise ValueError("Logo Y position is required when logo URL is provided")

        animations_result = app.animations(params=options, wait=True)

        if not isinstance(animations_result, str):
            animations_result = json.dumps(animations_result, ensure_ascii=False, indent=4)

        if not animations_result:
            return self.create_text_message("D-ID animations request failed.")

        return self.create_text_message(animations_result)
