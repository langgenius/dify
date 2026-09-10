"""Invoke the existing model runtime using plain audio values.

Provider credential queries retain their existing scoped-session behavior.
The InstalledApp runtime closes its configuration session before entering this
module; legacy callers continue to own their request session.
"""

import io

from core.app.entities.app_invoke_entities import get_credit_usage_app_type
from core.base.tts.audio_mime import get_model_audio_mime_type
from core.credit_usage import CreditUsageCreatedBy
from core.model_manager import ModelManager
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.protocols.tts_runtime import TTSModelVoice
from services.audio_types import AudioAppRef, AudioOutput
from services.errors.audio import (
    ProviderNotSupportSpeechToTextServiceError,
    ProviderNotSupportTextToSpeechServiceError,
)


def speech_to_text(*, app: AudioAppRef, content: bytes, end_user: str | None) -> str:
    model_manager = ModelManager.for_tenant(
        tenant_id=app.tenant_id,
        user_id=end_user,
        request_metadata={
            "app_type": get_credit_usage_app_type(app.app_mode),
            "created_by": CreditUsageCreatedBy.AUDIO,
        },
    )
    model_instance = model_manager.get_default_model_instance(tenant_id=app.tenant_id, model_type=ModelType.SPEECH2TEXT)
    if model_instance is None:
        raise ProviderNotSupportSpeechToTextServiceError()
    buffer = io.BytesIO(content)
    buffer.name = "temp.mp3"
    return model_instance.invoke_speech2text(file=buffer)


def text_to_speech(*, app: AudioAppRef, text: str, voice: str | None, end_user: str | None) -> AudioOutput:
    model_manager = ModelManager.for_tenant(
        tenant_id=app.tenant_id,
        user_id=end_user,
        request_metadata={
            "app_type": get_credit_usage_app_type(app.app_mode),
            "created_by": CreditUsageCreatedBy.AUDIO,
        },
    )
    model_instance = model_manager.get_default_model_instance(tenant_id=app.tenant_id, model_type=ModelType.TTS)
    if not voice:
        voices = model_instance.get_tts_voices()
        if not voices or not (voice := voices[0].get("value")):
            raise ValueError("Sorry, no voice available.")
    return AudioOutput(
        data=model_instance.invoke_tts(content_text=text, voice=voice),
        mime_type=get_model_audio_mime_type(model_instance),
    )


def get_voices(*, tenant_id: str, language: str) -> list[TTSModelVoice]:
    model_manager = ModelManager.for_tenant(
        tenant_id=tenant_id,
        request_metadata={"created_by": CreditUsageCreatedBy.AUDIO},
    )
    model_instance = model_manager.get_default_model_instance(tenant_id=tenant_id, model_type=ModelType.TTS)
    if model_instance is None:
        raise ProviderNotSupportTextToSpeechServiceError()
    return model_instance.get_tts_voices(language)
