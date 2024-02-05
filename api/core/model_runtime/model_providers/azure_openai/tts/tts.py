import hashlib
import uuid
import time
import os
import requests
from io import BytesIO
from functools import reduce
from pydub import AudioSegment
from typing import Optional, Any, Dict, Generator

from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.model_runtime.entities.model_entities import AIModelEntity
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.tts_model import TTSModel
from core.model_runtime.model_providers.azure_openai._common import _CommonAzureOpenAI
from core.model_runtime.model_providers.azure_openai._constant import TTS_MODELS, AzureBaseModel

from flask import Response, stream_with_context
from extensions.ext_storage import storage
import concurrent.futures
import aiohttp
import threading
from aiofiles import open as aiofiles_open


class AzureOpenAITTSModel(_CommonAzureOpenAI, TTSModel):
    """
    Model class for Azure OpenAI text to Speech model.
    """
    def __init__(self):
        self.tts_api_id = os.getenv('TTS_API_ID')
        self.tts_api_key = os.getenv('TTS_API_KEY')
        self.tts_api_secret = os.getenv('TTS_API_SECRET')
        self.tts_api_url = os.getenv('TTS_API_URI')

    def _invoke(self, model: str,  tenant_id: str, credentials: dict, content_text: str, voice: str, streaming: bool, user: Optional[str] = None):
        """
        Invoke tts model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param voice: model timbre
        :param streaming: output is streaming
        :param user: unique user id
        :return: text translated to audio file
        """
        audio_type = self._get_model_audio_type(model, credentials)
        if streaming:
            return Response(stream_with_context(self._tts_invoke_streaming(model=model,
                                                                           credentials=credentials,
                                                                           content_text=content_text,
                                                                           voice=voice,
                                                                           tenant_id=tenant_id,
                                                                           user=user)),
                            status=200, mimetype=f'audio/{audio_type}')
        else:
            return self._tts_invoke(model=model, credentials=credentials, content_text=content_text, voice=voice, user=user)

    def validate_credentials(self, model: str, credentials: dict):
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return: text translated to audio file
        """
        try:
            pass
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _prepare_request(self, content_text: str, voice: str, audio_type: str, user: Optional[str] = None) -> tuple:
        ts = str(int(round(time.time() * 1000)))
        nonce = uuid.uuid4().__str__()
        h = hashlib.sha256()
        content = "{}{}{}".format(self.tts_api_secret, ts, nonce)
        h.update(content.encode("utf-8"))

        headers: Dict[str, Any] = {
            'X-AI-ApiKey': self.tts_api_key,
            'X-AI-Timestamp': ts,
            'X-AI-Signature': h.hexdigest(),
            'X-AI-Nonce': nonce
        }

        tts_payload: Dict[str, Any] = {
            "common": {
                "product_id": self.tts_api_id,
                "user_id": user,
                "timestamp": ts
            },
            "task": {
                "voice_name": voice,
                "audio_format": f"{audio_type.upper()}",
                "speed": 1.0,
                "volume": 1.0,
                "pitch": 0,
                "sampling_rate": 8000,
                "stream_synthesis": False,
                "text": content_text,
                "text_type": "plain"
            }
        }
        return headers, tts_payload

    async def _tts_invoke_streaming1(self, model: str, tenant_id: str, content_text: str, voice: str, credentials: dict, user: Optional[str] = None) -> None:
        """
        Streaming Invoke tts model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param voice: model timbre
        :param content_text: text content to be translated
        :param user: unique user id
        :return: text translated to audio file
        """
        word_limit = self._get_model_word_limit(model, credentials)
        voice_name = self._get_model_default_voice(model, credentials)
        audio_type = self._get_model_audio_type(model, credentials)
        tts_file_id = self._get_file_name(content_text)
        file_path = f'storage/generate_files/{audio_type}/{tts_file_id}.{audio_type}'

        try:
            async with aiofiles_open(file_path, 'wb') as wav_file:
                sentences = list(self._split_text_into_sentences(text=content_text, limit=word_limit))
                async with aiohttp.ClientSession() as file_session:
                    for sentence in sentences:
                        headers, tts_payload = self._prepare_request(user=user, content_text=sentence, voice=voice_name, audio_type=audio_type)
                        async with file_session.post(url='{}/tts'.format(self.tts_api_url), json=tts_payload, headers=headers) as response:
                            if response.status == 200:
                                while True:
                                    chunk = await response.content.read()
                                    if not chunk:
                                        break
                                    await wav_file.write(chunk)

                            else:
                                response_object = await response.json()
                                raise InvokeBadRequestError(
                                    str(response_object.get('msg', 'TTS request failed without a specific message')))
            # else:
            #     asyncio.run(generate())

            # return send_file(file_path, as_attachment=True)
        except Exception as ex:
            os.remove(file_path)
            raise InvokeBadRequestError(str(ex))

    def _tts_invoke_streaming(self, model: str,  tenant_id: str, content_text: str, voice: str, credentials: dict, user: Optional[str] = None) -> any:
        """
        Invoke tts model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param voice: model timbre
        :param content_text: text content to be translated
        :param user: unique user id
        :return: text translated to audio file
        """
        word_limit = self._get_model_word_limit(model, credentials)
        if not voice:
            voice = self._get_model_default_voice(model, credentials)
        audio_type = self._get_model_audio_type(model, credentials)
        tts_file_id = self._get_file_name(content_text)
        file_path = f'generate_filesaudio/{tenant_id}/{tts_file_id}.{audio_type}'

        try:
            sentences = list(self._split_text_into_sentences(text=content_text, limit=word_limit))
            for sentence in sentences:
                headers, tts_payload = self._prepare_request(user=user, content_text=sentence, voice=voice, audio_type=audio_type)
                response = requests.post(url='{}/tts'.format(self.tts_api_url), json=tts_payload, headers=headers)
                if isinstance(response.content, bytes) and response.headers['Content-Type'] == f'audio/{audio_type}' and int(response.headers['Content-Length']) > 0:
                    # yield response.content
                    storage.save(file_path, response.content)
                else:
                    response_object = response.json()
                    raise InvokeBadRequestError(
                        str(response_object.get('msg', 'TTS request failed without a specific message')))
        except Exception as ex:
            raise InvokeBadRequestError(str(ex))

    def _tts_invoke(self, model: str, content_text: str, voice: str, credentials: dict, user: Optional[str] = None) -> Response:
        """
        Invoke tts model

        :param model: model name
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param voice: model timbre
        :param user: unique user id
        :return: text translated to audio file
        """
        word_limit = self._get_model_word_limit(model, credentials)
        if not voice:
            voice = self._get_model_default_voice(model, credentials)
        audio_type = self._get_model_audio_type(model, credentials)
        max_workers = self._get_model_workers_limit(model, credentials)

        try:
            sentences = list(self._split_text_into_sentences(text=content_text, limit=word_limit))
            audio_bytes_list = list()

            # Create a thread pool and map the function to the list of sentences
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = [executor.submit(self._process_sentence, sentence=sentence, user=user, voice=voice,
                                           audio_type=audio_type) for sentence in sentences]
                for future in futures:
                    try:
                        audio_bytes_list.append(future.result())
                    except Exception as ex:
                        raise InvokeBadRequestError(str(ex))

            audio_segments = [AudioSegment.from_file(BytesIO(audio_bytes), format=audio_type) for audio_bytes in
                              audio_bytes_list if audio_bytes]
            combined_segment = reduce(lambda x, y: x + y, audio_segments)
            buffer: BytesIO = BytesIO()
            combined_segment.export(buffer, format=audio_type)
            buffer.seek(0)
            return Response(buffer.read(), status=200, mimetype=f"audio/{audio_type}")
        except Exception as ex:
            raise InvokeBadRequestError(str(ex))

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        ai_model_entity = self._get_ai_model_entity(credentials.get('base_model_name'), model)
        return ai_model_entity.entity if ai_model_entity else None

    @staticmethod
    def _get_ai_model_entity(base_model_name: str, model: str) -> AzureBaseModel:
        for ai_model_entity in TTS_MODELS:
            if ai_model_entity.base_model_name == base_model_name:
                ai_model_entity.entity.model = model
                ai_model_entity.entity.label.en_US = model
                ai_model_entity.entity.label.zh_Hans = model
                return ai_model_entity

    def _process_sentence(self, sentence, user, voice, audio_type):
        """
        _tts_invoke openai text2speech model api

        :param sentence: text content to be translated
        :return: text translated to audio file
        """
        print(f"Processing sentence on thread {threading.current_thread().name}")
        headers, tts_payload = self._prepare_request(user=user, content_text=sentence, voice=voice,
                                                     audio_type=audio_type)
        response = requests.post(url='{}/tts'.format(self.tts_api_url), json=tts_payload, headers=headers)
        if isinstance(response.content, bytes) and response.headers['Content-Type'] == f'audio/{audio_type}':
            return response.content
        else:
            response_object = response.json()
            raise InvokeBadRequestError(
                str(response_object.get('msg', 'TTS request failed without a specific message')))
