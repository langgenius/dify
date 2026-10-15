"""Prepare audio models in an isolated session before invoking the model runtime.

Provider discovery during preparation and quota accounting during invocation
remain owned by the existing model runtime; this boundary releases the model
preparation session before ASR, voice lookup, or TTS stream consumption.
"""

import io
from collections.abc import Mapping

from flask import current_app

from core.app.entities.app_invoke_entities import get_credit_usage_app_type
from core.base.tts.audio_mime import get_model_audio_mime_type
from core.credit_usage import CreditUsageCreatedBy
from core.model_manager import ModelInstance, ModelManager
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.protocols.tts_runtime import TTSModelVoice
from services.audio_types import AudioAppRef, AudioOutput


def _prepare_model(
    *,
    tenant_id: str,
    model_type: ModelType,
    end_user: str | None,
    request_metadata: Mapping[str, object],
) -> ModelInstance:
    # Default-model fallback may commit. Give preparation its own scoped session;
    # context teardown releases it without touching the caller's transaction.
    with current_app.app_context():
        model_manager = ModelManager.for_tenant(
            tenant_id=tenant_id,
            user_id=end_user,
            request_metadata=request_metadata,
        )
        return model_manager.get_default_model_instance(tenant_id=tenant_id, model_type=model_type)


def speech_to_text(*, app: AudioAppRef, content: bytes, end_user: str | None) -> str:
    model_instance = _prepare_model(
        tenant_id=app.tenant_id,
        model_type=ModelType.SPEECH2TEXT,
        end_user=end_user,
        request_metadata={
            "app_type": get_credit_usage_app_type(app.app_mode),
            "created_by": CreditUsageCreatedBy.AUDIO,
        },
    )
    buffer = io.BytesIO(content)
    buffer.name = "temp.mp3"
    return model_instance.invoke_speech2text(file=buffer)


def text_to_speech(*, app: AudioAppRef, text: str, voice: str | None, end_user: str | None) -> AudioOutput:
    model_instance = _prepare_model(
        tenant_id=app.tenant_id,
        model_type=ModelType.TTS,
        end_user=end_user,
        request_metadata={
            "app_type": get_credit_usage_app_type(app.app_mode),
            "created_by": CreditUsageCreatedBy.AUDIO,
        },
    )
    if not voice:
        voices = model_instance.get_tts_voices()
        if not voices or not (voice := voices[0].get("value")):
            raise ValueError("Sorry, no voice available.")
    return AudioOutput(
        data=model_instance.invoke_tts(content_text=text, voice=voice),
        mime_type=get_model_audio_mime_type(model_instance),
    )


def get_voices(*, tenant_id: str, language: str) -> list[TTSModelVoice]:
    model_instance = _prepare_model(
        tenant_id=tenant_id,
        model_type=ModelType.TTS,
        end_user=None,
        request_metadata={"created_by": CreditUsageCreatedBy.AUDIO},
    )
    return model_instance.get_tts_voices(language)
