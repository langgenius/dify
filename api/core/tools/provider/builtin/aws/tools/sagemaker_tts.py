import json
from enum import Enum
from typing import Any, Optional, Union

import boto3  # type: ignore

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class TTSModelType(Enum):
    PresetVoice = "PresetVoice"
    CloneVoice = "CloneVoice"
    CloneVoice_CrossLingual = "CloneVoice_CrossLingual"
    InstructVoice = "InstructVoice"


class SageMakerTTSTool(BuiltinTool):
    sagemaker_client: Any = None
    sagemaker_endpoint: str | None = None
    s3_client: Any = None
    comprehend_client: Any = None

    def _detect_lang_code(self, content: str, map_dict: Optional[dict] = None):
        map_dict = {"zh": "<|zh|>", "en": "<|en|>", "ja": "<|jp|>", "zh-TW": "<|yue|>", "ko": "<|ko|>"}

        response = self.comprehend_client.detect_dominant_language(Text=content)
        language_code = response["Languages"][0]["LanguageCode"]
        return map_dict.get(language_code, "<|zh|>")

    def _build_tts_payload(
        self,
        model_type: str,
        content_text: str,
        model_role: str,
        prompt_text: str,
        prompt_audio: str,
        instruct_text: str,
    ):
        if model_type == TTSModelType.PresetVoice.value and model_role:
            return {"tts_text": content_text, "role": model_role}
        if model_type == TTSModelType.CloneVoice.value and prompt_text and prompt_audio:
            return {"tts_text": content_text, "prompt_text": prompt_text, "prompt_audio": prompt_audio}
        if model_type == TTSModelType.CloneVoice_CrossLingual.value and prompt_audio:
            lang_tag = self._detect_lang_code(content_text)
            return {"tts_text": f"{content_text}", "prompt_audio": prompt_audio, "lang_tag": lang_tag}
        if model_type == TTSModelType.InstructVoice.value and instruct_text and model_role:
            return {"tts_text": content_text, "role": model_role, "instruct_text": instruct_text}

        raise RuntimeError(f"Invalid params for {model_type}")

    def _invoke_sagemaker(self, payload: dict, endpoint: str):
        response_model = self.sagemaker_client.invoke_endpoint(
            EndpointName=endpoint,
            Body=json.dumps(payload),
            ContentType="application/json",
        )
        json_str = response_model["Body"].read().decode("utf8")
        json_obj = json.loads(json_str)
        return json_obj

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        try:
            if not self.sagemaker_client:
                aws_region = tool_parameters.get("aws_region")
                if aws_region:
                    self.sagemaker_client = boto3.client("sagemaker-runtime", region_name=aws_region)
                    self.s3_client = boto3.client("s3", region_name=aws_region)
                    self.comprehend_client = boto3.client("comprehend", region_name=aws_region)
                else:
                    self.sagemaker_client = boto3.client("sagemaker-runtime")
                    self.s3_client = boto3.client("s3")
                    self.comprehend_client = boto3.client("comprehend")

            if not self.sagemaker_endpoint:
                self.sagemaker_endpoint = tool_parameters.get("sagemaker_endpoint")

            tts_text = tool_parameters.get("tts_text")
            tts_infer_type = tool_parameters.get("tts_infer_type")

            voice = tool_parameters.get("voice")
            mock_voice_audio = tool_parameters.get("mock_voice_audio")
            mock_voice_text = tool_parameters.get("mock_voice_text")
            voice_instruct_prompt = tool_parameters.get("voice_instruct_prompt")
            payload = self._build_tts_payload(
                tts_infer_type, tts_text, voice, mock_voice_text, mock_voice_audio, voice_instruct_prompt
            )

            result = self._invoke_sagemaker(payload, self.sagemaker_endpoint)

            return self.create_text_message(text=result["s3_presign_url"])

        except Exception as e:
            return self.create_text_message(f"Exception {str(e)}")
