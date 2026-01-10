from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import AceDataProducerClient, AceDataProducerError, parse_optional_float


class ProducerGenerateAudiosTool(Tool):
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

        title = tool_parameters.get("title")
        title = title.strip() if isinstance(title, str) and title.strip() else None

        audio_id = tool_parameters.get("audio_id")
        audio_id = audio_id.strip() if isinstance(audio_id, str) and audio_id.strip() else None

        continue_at = parse_optional_float(tool_parameters.get("continue_at"), field="continue_at")
        replace_section_start = parse_optional_float(
            tool_parameters.get("replace_section_start"), field="replace_section_start"
        )
        replace_section_end = parse_optional_float(
            tool_parameters.get("replace_section_end"), field="replace_section_end"
        )
        lyrics_strength = parse_optional_float(
            tool_parameters.get("lyrics_strength"), field="lyrics_strength"
        )
        sound_strength = parse_optional_float(tool_parameters.get("sound_strength"), field="sound_strength")
        cover_strength = parse_optional_float(tool_parameters.get("cover_strength"), field="cover_strength")
        weirdness = parse_optional_float(tool_parameters.get("weirdness"), field="weirdness")

        seed = tool_parameters.get("seed")
        seed = seed.strip() if isinstance(seed, str) and seed.strip() else None

        callback_url = tool_parameters.get("callback_url")
        callback_url = (
            callback_url.strip()
            if isinstance(callback_url, str) and callback_url.strip()
            else None
        )

        if custom is True:
            if not lyric and not instrumental:
                raise ValueError("When `custom` is true, provide `lyric` (unless instrumental).")
        else:
            if action == "generate" and not prompt:
                raise ValueError("`prompt` is required when action is `generate` and `custom` is false.")

        actions_requiring_audio_id = {
            "cover",
            "extend",
            "upload_cover",
            "upload_extend",
            "replace_section",
            "swap_vocals",
            "swap_instrumentals",
            "variation",
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
        if title:
            payload["title"] = title
        if audio_id:
            payload["audio_id"] = audio_id
        if continue_at is not None:
            payload["continue_at"] = continue_at
        if replace_section_start is not None:
            payload["replace_section_start"] = replace_section_start
        if replace_section_end is not None:
            payload["replace_section_end"] = replace_section_end
        if lyrics_strength is not None:
            payload["lyrics_strength"] = lyrics_strength
        if sound_strength is not None:
            payload["sound_strength"] = sound_strength
        if cover_strength is not None:
            payload["cover_strength"] = cover_strength
        if weirdness is not None:
            payload["weirdness"] = weirdness
        if seed:
            payload["seed"] = seed
        if callback_url:
            payload["callback_url"] = callback_url

        client = AceDataProducerClient(bearer_token=str(self.runtime.credentials["acedata_bearer_token"]))
        try:
            result = client.audios(payload=payload, timeout_s=1800)
        except AceDataProducerError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        for item in result.data:
            image_url = item.get("image_url")
            if isinstance(image_url, str) and image_url.strip():
                yield self.create_image_message(image_url.strip())

        yield self.create_variable_message("success", True)
        yield self.create_variable_message("task_id", result.task_id)
        yield self.create_variable_message("trace_id", result.trace_id)
        yield self.create_variable_message("data", result.data)

