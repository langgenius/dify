from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import AceDataSunoClient, AceDataSunoError


class SunoUploadReferenceAudioTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        audio_url = tool_parameters.get("audio_url")
        if not isinstance(audio_url, str) or not audio_url.strip():
            raise ValueError("`audio_url` is required.")
        audio_url = audio_url.strip()

        client = AceDataSunoClient(bearer_token=str(self.runtime.credentials["acedata_bearer_token"]))
        try:
            result = client.upload_reference_audio(audio_url=audio_url, timeout_s=600)
        except AceDataSunoError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        yield self.create_variable_message("success", True)
        yield self.create_variable_message("task_id", result.task_id)
        yield self.create_variable_message("trace_id", result.trace_id)
        yield self.create_variable_message("data", result.data)
