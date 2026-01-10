from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import AceDataSunoClient, AceDataSunoError, parse_optional_float


class SunoCreatePersonaTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        audio_id = tool_parameters.get("audio_id")
        if not isinstance(audio_id, str) or not audio_id.strip():
            raise ValueError("`audio_id` is required.")
        audio_id = audio_id.strip()

        name = tool_parameters.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("`name` is required.")
        name = name.strip()

        description = tool_parameters.get("description")
        description = description.strip() if isinstance(description, str) and description.strip() else None

        vox_audio_id = tool_parameters.get("vox_audio_id")
        vox_audio_id = vox_audio_id.strip() if isinstance(vox_audio_id, str) and vox_audio_id.strip() else None

        vocal_start = parse_optional_float(tool_parameters.get("vocal_start"), field="vocal_start")
        vocal_end = parse_optional_float(tool_parameters.get("vocal_end"), field="vocal_end")

        client = AceDataSunoClient(bearer_token=str(self.runtime.credentials["acedata_bearer_token"]))
        try:
            result = client.persona(
                audio_id=audio_id,
                name=name,
                description=description,
                vox_audio_id=vox_audio_id,
                vocal_start=vocal_start,
                vocal_end=vocal_end,
                timeout_s=600,
            )
        except AceDataSunoError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        yield self.create_variable_message("success", True)
        yield self.create_variable_message("task_id", result.task_id)
        yield self.create_variable_message("trace_id", result.trace_id)
        yield self.create_variable_message("data", result.data)
