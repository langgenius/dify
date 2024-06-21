import io
import logging
import re
import threading
from typing import Optional

from werkzeug.datastructures import FileStorage

from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from models.model import App, AppMode, AppModelConfig, Message
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    ProviderNotSupportTextToSpeechServiceError,
    UnsupportedAudioTypeServiceError,
)

FILE_SIZE = 30
FILE_SIZE_LIMIT = FILE_SIZE * 1024 * 1024
ALLOWED_EXTENSIONS = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm', 'amr']

logger = logging.getLogger(__name__)


class AudioService:
    @classmethod
    def transcript_asr(cls, app_model: App, file: FileStorage, end_user: Optional[str] = None):
        if app_model.mode in [AppMode.ADVANCED_CHAT.value, AppMode.WORKFLOW.value]:
            workflow = app_model.workflow
            if workflow is None:
                raise ValueError("Speech to text is not enabled")

            features_dict = workflow.features_dict
            if 'speech_to_text' not in features_dict or not features_dict['speech_to_text'].get('enabled'):
                raise ValueError("Speech to text is not enabled")
        else:
            app_model_config: AppModelConfig = app_model.app_model_config

            if not app_model_config.speech_to_text_dict['enabled']:
                raise ValueError("Speech to text is not enabled")

        if file is None:
            raise NoAudioUploadedServiceError()

        extension = file.mimetype
        if extension not in [f'audio/{ext}' for ext in ALLOWED_EXTENSIONS]:
            raise UnsupportedAudioTypeServiceError()

        file_content = file.read()
        file_size = len(file_content)

        if file_size > FILE_SIZE_LIMIT:
            message = f"Audio size larger than {FILE_SIZE} mb"
            raise AudioTooLargeServiceError(message)

        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=app_model.tenant_id,
            model_type=ModelType.SPEECH2TEXT
        )
        if model_instance is None:
            raise ProviderNotSupportSpeechToTextServiceError()

        buffer = io.BytesIO(file_content)
        buffer.name = 'temp.mp3'

        return {"text": model_instance.invoke_speech2text(file=buffer, user=end_user)}

    @classmethod
    def transcript_tts(cls, app_model: App, streaming: bool, text: Optional[str] = None,
                       voice: Optional[str] = None, end_user: Optional[str] = None, message_id: Optional[str] = None):
        import concurrent.futures
        import queue
        from collections.abc import Generator

        from flask import Response, stream_with_context

        from app import app
        from constants.constants import REDIS_MESSAGE_PREFIX
        from extensions.ext_database import db
        from extensions.ext_redis import redis_client

        look = redis_client.setnx(f"{REDIS_MESSAGE_PREFIX}lock:{message_id}", '1')
        if not look:
            return None
        redis_client.expire(f"{REDIS_MESSAGE_PREFIX}{message_id}", 1800)

        def invoke_tts(text: str, voice: Optional[str] = None):
            with app.app_context():
                if app_model.mode in [AppMode.ADVANCED_CHAT.value, AppMode.WORKFLOW.value]:
                    workflow = app_model.workflow
                    if workflow is None:
                        raise ValueError("TTS is not enabled")

                    features_dict = workflow.features_dict
                    if 'text_to_speech' not in features_dict or not features_dict['text_to_speech'].get('enabled'):
                        raise ValueError("TTS is not enabled")

                    voice = features_dict['text_to_speech'].get('voice') if voice is None else voice
                else:
                    text_to_speech_dict = app_model.app_model_config.text_to_speech_dict

                    if not text_to_speech_dict.get('enabled'):
                        raise ValueError("TTS is not enabled")

                    voice = text_to_speech_dict.get('voice') if voice is None else voice

                model_manager = ModelManager()
                model_instance = model_manager.get_default_model_instance(
                    tenant_id=app_model.tenant_id,
                    model_type=ModelType.TTS
                )
                try:
                    if not voice:
                        voices = model_instance.get_tts_voices()
                        if voices:
                            voice = voices[0].get('value')
                        else:
                            raise ValueError("Sorry, no voice available.")

                    return model_instance.invoke_tts(
                        content_text=text.strip(),
                        user=end_user,
                        streaming=streaming,
                        tenant_id=app_model.tenant_id,
                        voice=voice
                    )
                except Exception as e:
                    raise e

        def extract_sentence(org_text):
            pattern = r'[。.!?]'
            match = re.compile(pattern)
            tx = match.finditer(org_text)
            start = 0
            result = []
            for i in tx:
                end = i.regs[0][1]
                result.append(org_text[start:end])
                start = end
            return result, org_text[start:]

        if message_id:
            message = db.session.query(Message).filter(
                Message.id == message_id
            ).first()
            if message.answer == '' and message.status == 'normal':
                def generate():
                    future_queue = queue.Queue()
                    executor = concurrent.futures.ThreadPoolExecutor(max_workers=3)

                    def process_redis():

                        with app.app_context():
                            text_buff = []
                            times_count = 0
                            while True:
                                redis_result = redis_client.blpop(f"{REDIS_MESSAGE_PREFIX}{message_id}", timeout=2)
                                if redis_result is None:
                                    continue
                                txt = redis_result[1].decode('utf-8')
                                if txt == 'None':
                                    break
                                text_buff.append(str(txt))
                                count = redis_client.llen(f"{REDIS_MESSAGE_PREFIX}{message_id}")
                                for i in range(count - 1):
                                    redis_result = redis_client.blpop(f"{REDIS_MESSAGE_PREFIX}{message_id}", timeout=30)
                                    try:
                                        txt = redis_result[1].decode('utf-8')
                                        text_buff.append(txt)
                                        if txt == 'None':
                                            break
                                    except Exception:
                                        logger.error(redis_result)
                                        continue

                                tt = "".join(text_buff)
                                sens, temp_str = extract_sentence(tt)

                                if len(sens) > 0 and len(sens) > min(7, times_count):
                                    times_count += 1
                                    text_buff.clear()
                                    text_buff.append(temp_str)

                                    voice_text = "".join(sens)
                                    futures_result = executor.submit(invoke_tts, voice_text, voice)
                                    future_queue.put(futures_result)
                            if len(text_buff) > 0:
                                voice_text = "".join(text_buff)
                                futures_result = executor.submit(invoke_tts, voice_text, voice)
                                future_queue.put(futures_result)
                            future_queue.put(None)
                            redis_client.delete(f"{REDIS_MESSAGE_PREFIX}{message_id}")

                    threading.Thread(target=process_redis).start()
                    while True:
                        try:
                            futures = future_queue.get(timeout=160)
                            if futures is None:
                                executor.shutdown(wait=False)
                                break
                            yield from futures.result()
                        except Exception:
                            executor.shutdown(wait=False)
                            break

                return Response(stream_with_context(generate()))
            else:
                response = invoke_tts(message.answer, voice)
                if isinstance(response, Generator):
                    return Response(stream_with_context(response))
                return response
        else:
            try:
                return invoke_tts(text, voice)
            except Exception as e:
                raise e

    @classmethod
    def transcript_tts_voices(cls, tenant_id: str, language: str):
        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.TTS
        )
        if model_instance is None:
            raise ProviderNotSupportTextToSpeechServiceError()

        try:
            return model_instance.get_tts_voices(language)
        except Exception as e:
            raise e
