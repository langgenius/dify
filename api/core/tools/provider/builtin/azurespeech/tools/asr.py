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
        definition: str = tool_parameters.get("definition", "")

        files: dict = {"audio": audio_binary}
        if definition:
            files["definition"] = definition
        resp = requests.post(
            "https://{}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version={}".format(
                self.runtime.credentials.get("azure_speech_region"),
                self.runtime.credentials.get("azure_speech_api_version"),
            ),
            headers={
                "Ocp-Apim-Subscription-Key": self.runtime.credentials.get("azure_speech_api_key"),
            },
            files=files,
        )

        data: dict = resp.json()

        combinedPhrases = data.get("combinedPhrases", [])

        if len(combinedPhrases) == 0:
            raise Exception(
                """No text detected.
                   Error: {}
                   Request: {}""".format(json.dumps(data), json.dumps(files))
            )

        return [
            self.create_text_message(data.get("combinedPhrases", [])[0].get("text", "")),
            self.create_json_message(data),
        ]
