import io
import os
from typing import Any

import fal_client

from core.file.enums import FileAttribute, FileType
from core.file.file_manager import download, get_attr
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class WizperTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        # Get parameters
        audio_file = tool_parameters.get("audio_file")
        task = tool_parameters.get("task", "transcribe")
        language = tool_parameters.get("language", "en")
        chunk_level = tool_parameters.get("chunk_level", "segment")
        version = tool_parameters.get("version", "3")

        if audio_file.type != FileType.AUDIO:
            return [self.create_text_message("Not a valid audio file.")]

        # Get the API key from credentials
        api_key = self.runtime.credentials["fal_api_key"]
        # Set the API key for fal_client
        os.environ["FAL_KEY"] = api_key

        # Upload the audio file using fal_client
        try:
            # Download the audio file content
            audio_binary = io.BytesIO(download(audio_file))
            mime_type = get_attr(file=audio_file, attr=FileAttribute.MIME_TYPE)

            # Get the file data
            file_data = audio_binary.getvalue()

            # Upload the file using fal_client
            audio_url = fal_client.upload(file_data, mime_type)

        except Exception as e:
            return [self.create_text_message(f"Error uploading audio file: {str(e)}")]

        # Prepare arguments for the API call
        arguments = {
            "audio_url": audio_url,
            "task": task,
            "language": language,
            "chunk_level": chunk_level,
            "version": version,
        }

        def on_queue_update(update):
            if isinstance(update, fal_client.InProgress):
                pass  # Handle progress updates if needed

        # Use fal_client.subscribe to submit and wait for the result
        result = fal_client.subscribe(
            "fal-ai/wizper",
            arguments=arguments,
            with_logs=False,
            on_queue_update=on_queue_update,
        )

        return self.create_json_message(result)
