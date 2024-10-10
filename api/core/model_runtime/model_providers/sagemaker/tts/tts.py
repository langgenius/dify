import concurrent.futures
import copy
import json
import logging
from enum import Enum
from typing import Any, Optional

import boto3
import requests

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.model_providers.__base.tts_model import TTSModel

logger = logging.getLogger(__name__)


class TTSModelType(Enum):
    PresetVoice = "PresetVoice"
    CloneVoice = "CloneVoice"
    CloneVoice_CrossLingual = "CloneVoice_CrossLingual"
    InstructVoice = "InstructVoice"


class SageMakerText2SpeechModel(TTSModel):
    sagemaker_client: Any = None
    s3_client: Any = None
    comprehend_client: Any = None

    def __init__(self):
        # preset voices, need support custom voice
        self.model_voices = {
            "__default": {
                "all": [
                    {"name": "Default", "value": "default"},
                ]
            },
            "CosyVoice": {
                "zh-Hans": [
                    {"name": "中文男", "value": "中文男"},
                    {"name": "中文女", "value": "中文女"},
                    {"name": "粤语女", "value": "粤语女"},
                ],
                "zh-Hant": [
                    {"name": "中文男", "value": "中文男"},
                    {"name": "中文女", "value": "中文女"},
                    {"name": "粤语女", "value": "粤语女"},
                ],
                "en-US": [
                    {"name": "英文男", "value": "英文男"},
                    {"name": "英文女", "value": "英文女"},
                ],
                "ja-JP": [
                    {"name": "日语男", "value": "日语男"},
                ],
                "ko-KR": [
                    {"name": "韩语女", "value": "韩语女"},
                ],
            },
        }

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        pass

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

    def _invoke(
        self, model: str, tenant_id: str, credentials: dict, content_text: str, voice: str, user: Optional[str] = None
    ):
        """
        _invoke text2speech model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param voice: model timbre
        :param content_text: text content to be translated
        :param user: unique user id
        :return: text translated to audio file
        """
        if not self.sagemaker_client:
            access_key = credentials.get("aws_access_key_id")
            secret_key = credentials.get("aws_secret_access_key")
            aws_region = credentials.get("aws_region")
            if aws_region:
                if access_key and secret_key:
                    self.sagemaker_client = boto3.client(
                        "sagemaker-runtime",
                        aws_access_key_id=access_key,
                        aws_secret_access_key=secret_key,
                        region_name=aws_region,
                    )
                    self.s3_client = boto3.client(
                        "s3", aws_access_key_id=access_key, aws_secret_access_key=secret_key, region_name=aws_region
                    )
                    self.comprehend_client = boto3.client(
                        "comprehend",
                        aws_access_key_id=access_key,
                        aws_secret_access_key=secret_key,
                        region_name=aws_region,
                    )
                else:
                    self.sagemaker_client = boto3.client("sagemaker-runtime", region_name=aws_region)
                    self.s3_client = boto3.client("s3", region_name=aws_region)
                    self.comprehend_client = boto3.client("comprehend", region_name=aws_region)
            else:
                self.sagemaker_client = boto3.client("sagemaker-runtime")
                self.s3_client = boto3.client("s3")
                self.comprehend_client = boto3.client("comprehend")

        model_type = credentials.get("audio_model_type", "PresetVoice")
        prompt_text = credentials.get("prompt_text")
        prompt_audio = credentials.get("prompt_audio")
        instruct_text = credentials.get("instruct_text")
        sagemaker_endpoint = credentials.get("sagemaker_endpoint")
        payload = self._build_tts_payload(model_type, content_text, voice, prompt_text, prompt_audio, instruct_text)

        return self._tts_invoke_streaming(model_type, payload, sagemaker_endpoint)

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity | None:
        """
        used to define customizable model schema
        """
        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.TTS,
            model_properties={},
            parameter_rules=[],
        )

        return entity

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the error type thrown to the caller
        The value is the error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke error mapping
        """
        return {
            InvokeConnectionError: [InvokeConnectionError],
            InvokeServerUnavailableError: [InvokeServerUnavailableError],
            InvokeRateLimitError: [InvokeRateLimitError],
            InvokeAuthorizationError: [InvokeAuthorizationError],
            InvokeBadRequestError: [InvokeBadRequestError, KeyError, ValueError],
        }

    def _get_model_default_voice(self, model: str, credentials: dict) -> Any:
        return ""

    def _get_model_word_limit(self, model: str, credentials: dict) -> int:
        return 15

    def _get_model_audio_type(self, model: str, credentials: dict) -> str:
        return "mp3"

    def _get_model_workers_limit(self, model: str, credentials: dict) -> int:
        return 5

    def get_tts_model_voices(self, model: str, credentials: dict, language: Optional[str] = None) -> list:
        audio_model_name = "CosyVoice"
        for key, voices in self.model_voices.items():
            if key in audio_model_name:
                if language and language in voices:
                    return voices[language]
                elif "all" in voices:
                    return voices["all"]

        return self.model_voices["__default"]["all"]

    def _invoke_sagemaker(self, payload: dict, endpoint: str):
        response_model = self.sagemaker_client.invoke_endpoint(
            EndpointName=endpoint,
            Body=json.dumps(payload),
            ContentType="application/json",
        )
        json_str = response_model["Body"].read().decode("utf8")
        json_obj = json.loads(json_str)
        return json_obj

    def _tts_invoke_streaming(self, model_type: str, payload: dict, sagemaker_endpoint: str) -> Any:
        """
        _tts_invoke_streaming text2speech model

        :param model: model name
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param voice: model timbre
        :return: text translated to audio file
        """
        try:
            lang_tag = ""
            if model_type == TTSModelType.CloneVoice_CrossLingual.value:
                lang_tag = payload.pop("lang_tag")

            word_limit = self._get_model_word_limit(model="", credentials={})
            content_text = payload.get("tts_text")
            if len(content_text) > word_limit:
                split_sentences = self._split_text_into_sentences(content_text, max_length=word_limit)
                sentences = [f"{lang_tag}{s}" for s in split_sentences if len(s)]
                len_sent = len(sentences)
                executor = concurrent.futures.ThreadPoolExecutor(max_workers=min(4, len_sent))
                payloads = [copy.deepcopy(payload) for i in range(len_sent)]
                for idx in range(len_sent):
                    payloads[idx]["tts_text"] = sentences[idx]

                futures = [
                    executor.submit(
                        self._invoke_sagemaker,
                        payload=payload,
                        endpoint=sagemaker_endpoint,
                    )
                    for payload in payloads
                ]

                for future in futures:
                    resp = future.result()
                    audio_bytes = requests.get(resp.get("s3_presign_url")).content
                    for i in range(0, len(audio_bytes), 1024):
                        yield audio_bytes[i : i + 1024]
            else:
                resp = self._invoke_sagemaker(payload, sagemaker_endpoint)
                audio_bytes = requests.get(resp.get("s3_presign_url")).content

                for i in range(0, len(audio_bytes), 1024):
                    yield audio_bytes[i : i + 1024]
        except Exception as ex:
            raise InvokeBadRequestError(str(ex))
