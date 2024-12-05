import json
from typing import Any

import requests

from core.file.enums import FileType
from core.file.file_manager import download
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class AzureASRTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> list[ToolInvokeMessage]:
        file = tool_parameters.get("audio_file")
        if file.type != FileType.AUDIO:
            return [self.create_text_message("not a valid audio file")]
        audio_binary = download(file)

        resp = requests.post(
            "https://{}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version={}".format(
                self.runtime.credentials.get("azure_speech_region"),
                self.runtime.credentials.get("azure_speech_api_version"),
            ),
            headers={
                "Ocp-Apim-Subscription-Key": self.runtime.credentials.get("azure_speech_api_key"),
            },
            files={"audio": audio_binary},
        )

        data: dict = resp.json()

        combinedPhrases = data.get("combinedPhrases", [])

        if len(combinedPhrases) == 0:
            raise Exception("No text detected, error: {}".format(json.dumps(data)))

        return [self.create_text_message(data.get("combinedPhrases", [])[0].get("text", ""))]
