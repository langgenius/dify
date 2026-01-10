from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import AceDataSunoClient, AceDataSunoError, parse_optional_float


class SunoGenerateAudiosTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        action = tool_parameters.get("action")
        if not isinstance(action, str) or not action.strip():
            raise ValueError("`action` is required.")
        action = action.strip()

        prompt = tool_parameters.get("prompt")
        prompt = prompt.strip() if isinstance(prompt, str) and prompt.strip() else None

        model = tool_parameters.get("model")
        model = model.strip() if isinstance(model, str) and model.strip() else None

        custom = tool_parameters.get("custom")
        if custom is not None and not isinstance(custom, bool):
            raise ValueError("`custom` must be a boolean.")

        instrumental = tool_parameters.get("instrumental")
        if instrumental is not None and not isinstance(instrumental, bool):
            raise ValueError("`instrumental` must be a boolean.")

        lyric = tool_parameters.get("lyric")
        lyric = lyric.strip() if isinstance(lyric, str) and lyric.strip() else None

        lyric_prompt = tool_parameters.get("lyric_prompt")
        lyric_prompt = (
            lyric_prompt.strip() if isinstance(lyric_prompt, str) and lyric_prompt.strip() else None
        )

        title = tool_parameters.get("title")
        title = title.strip() if isinstance(title, str) and title.strip() else None

        style = tool_parameters.get("style")
        style = style.strip() if isinstance(style, str) and style.strip() else None

        style_negative = tool_parameters.get("style_negative")
        style_negative = (
            style_negative.strip()
            if isinstance(style_negative, str) and style_negative.strip()
            else None
        )

        audio_id = tool_parameters.get("audio_id")
        audio_id = audio_id.strip() if isinstance(audio_id, str) and audio_id.strip() else None

        continue_at = parse_optional_float(tool_parameters.get("continue_at"), field="continue_at")
        audio_weight = parse_optional_float(tool_parameters.get("audio_weight"), field="audio_weight")

        persona_id = tool_parameters.get("persona_id")
        persona_id = persona_id.strip() if isinstance(persona_id, str) and persona_id.strip() else None

        vocal_gender = tool_parameters.get("vocal_gender")
        vocal_gender = (
            vocal_gender.strip()
            if isinstance(vocal_gender, str) and vocal_gender.strip()
            else None
        )
        if vocal_gender is not None and vocal_gender not in {"f", "m"}:
            raise ValueError("`vocal_gender` must be 'f' or 'm'.")

        callback_url = tool_parameters.get("callback_url")
        callback_url = (
            callback_url.strip()
            if isinstance(callback_url, str) and callback_url.strip()
            else None
        )

        if custom is True:
            if not lyric and not lyric_prompt and not instrumental:
                raise ValueError("When `custom` is true, provide `lyric` or `lyric_prompt` (unless instrumental).")
        else:
            if not prompt:
                raise ValueError("`prompt` is required when `custom` is false.")

        actions_requiring_audio_id = {
            "extend",
            "upload_extend",
            "cover",
            "upload_cover",
            "stems",
            "all_stems",
            "concat",
            "remaster",
            "replace_section",
        }
        if action in actions_requiring_audio_id and not audio_id:
            raise ValueError(f"`audio_id` is required when action is {action}.")

        payload: dict[str, Any] = {"action": action}
        if prompt:
            payload["prompt"] = prompt
        if model:
            payload["model"] = model
        if custom is not None:
            payload["custom"] = custom
        if instrumental is not None:
            payload["instrumental"] = instrumental
        if lyric:
            payload["lyric"] = lyric
        if lyric_prompt:
            payload["lyric_prompt"] = lyric_prompt
        if title:
            payload["title"] = title
        if style:
            payload["style"] = style
        if style_negative:
            payload["style_negative"] = style_negative
        if audio_id:
            payload["audio_id"] = audio_id
        if continue_at is not None:
            payload["continue_at"] = continue_at
        if audio_weight is not None:
            payload["audio_weight"] = audio_weight
        if persona_id:
            payload["persona_id"] = persona_id
        if vocal_gender:
            payload["vocal_gender"] = vocal_gender
        if callback_url:
            payload["callback_url"] = callback_url

        client = AceDataSunoClient(bearer_token=str(self.runtime.credentials["acedata_bearer_token"]))
        try:
            result = client.generate_audios(payload=payload, timeout_s=1800)
        except AceDataSunoError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        for image_url in result.image_urls:
            yield self.create_image_message(image_url)

        yield self.create_variable_message("success", True)
        yield self.create_variable_message("task_id", result.task_id)
        yield self.create_variable_message("trace_id", result.trace_id)
        yield self.create_variable_message("data", result.data)
