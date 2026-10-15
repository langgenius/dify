import logging
from collections.abc import Callable
from functools import wraps
from http import HTTPStatus
from uuid import UUID

from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, RootModel

from controllers.common.audio_response import audio_binary_response
from controllers.common.errors import InternalServerError, NotFoundError
from controllers.common.rbac import AgentId, PlainApp, RBACCheck, enforce_rbac_checks
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import (
    AppNotFoundError,
    AppUnavailableError,
    AudioTooLargeError,
    CompletionRequestError,
    NoAudioUploadedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderNotSupportSpeechToTextError,
    ProviderNotSupportTextToSpeechError,
    ProviderQuotaExceededError,
    SpeechToTextDisabledError,
    UnsupportedAudioTypeError,
)
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, model_validate
from core.base.tts.audio_mime import SUPPORTED_TTS_AUDIO_MIME_TYPES
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from enums.account import TenantAccountRole
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from graphon.model_runtime.errors.invoke import InvokeError
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.flask_restx_compat import BINARY_RESPONSE_MEDIA_TYPES_VENDOR_KEY
from libs.helper import dump_response
from machinery.context import RequestContext
from models import AppMode
from models.agent import AgentConfigDraftType
from services.agent.errors import AgentVersionNotFoundError
from services.app.agent_app_contracts import AgentAppNotFoundError
from services.app.console_service import ConsoleAppNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.audio_types import AudioAppRef, AudioDraftType, AudioUpload
from services.entities.message_entities import MessageAccount
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    ProviderNotSupportTextToSpeechServiceError,
    SpeechToTextDisabledServiceError,
    UnsupportedAudioTypeServiceError,
)

logger = logging.getLogger(__name__)


class TextToSpeechPayload(BaseModel):
    message_id: str | None = Field(default=None, description="Message ID")
    text: str = Field(..., description="Text to convert")
    voice: str | None = Field(default=None, description="Voice name")
    streaming: bool | None = Field(default=None, description="Whether to stream audio")


class TextToSpeechVoiceQuery(BaseModel):
    language: str = Field(..., description="Language code")


class AudioTranscriptResponse(ResponseModel):
    text: str = Field(description="Transcribed text from audio")


class AgentAudioTranscriptFormPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft_type: AgentConfigDraftType = AgentConfigDraftType.DRAFT


class TextToSpeechVoiceResponse(ResponseModel):
    # see api/core/plugin/impl/model.py
    name: str = Field(description="Voice display name")
    value: str = Field(description="Voice identifier")


class TextToSpeechVoiceListResponse(RootModel[list[TextToSpeechVoiceResponse]]):
    root: list[TextToSpeechVoiceResponse] = Field(description="Available voices")


register_schema_models(console_ns, AgentAudioTranscriptFormPayload, TextToSpeechPayload, TextToSpeechVoiceQuery)
register_response_schema_models(
    console_ns,
    AudioTranscriptResponse,
    TextToSpeechVoiceResponse,
    TextToSpeechVoiceListResponse,
)

_AUDIO_TRANSCRIPT_FILE_PARAM = {
    "description": "MP3 audio to transcribe",
    "in": "formData",
    "type": "file",
    "required": True,
}
_AGENT_AUDIO_TRANSCRIPT_PARAMS = {
    "file": _AUDIO_TRANSCRIPT_FILE_PARAM,
    "draft_type": {
        "description": "Agent debug config source",
        "in": "formData",
        "type": "string",
        "enum": [draft_type.value for draft_type in AgentConfigDraftType],
        "default": AgentConfigDraftType.DRAFT.value,
        "required": False,
    },
}
_CONSOLE_AUDIO_TRANSCRIPT_APP_MODES = [
    AppMode.CHAT,
    AppMode.AGENT_CHAT,
    AppMode.ADVANCED_CHAT,
    AppMode.AGENT,
]


def _audio_errors[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return view(*args, **kwargs)
        except AppDefinitionUnavailableError as error:
            raise AppUnavailableError() from error
        except AppModelConfigBrokenError as error:
            logger.exception("App model config broken.")
            raise AppUnavailableError() from error
        except AgentAppNotFoundError as error:
            raise NotFoundError(str(error) or "Agent not found.") from error
        except NoAudioUploadedServiceError as error:
            raise NoAudioUploadedError() from error
        except AudioTooLargeServiceError as error:
            raise AudioTooLargeError(str(error)) from error
        except UnsupportedAudioTypeServiceError as error:
            raise UnsupportedAudioTypeError() from error
        except ProviderNotSupportSpeechToTextServiceError as error:
            raise ProviderNotSupportSpeechToTextError() from error
        except SpeechToTextDisabledServiceError as error:
            raise SpeechToTextDisabledError() from error
        except ProviderNotSupportTextToSpeechServiceError as error:
            raise ProviderNotSupportTextToSpeechError() from error
        except ProviderTokenNotInitError as error:
            raise ProviderNotInitializeError(error.description) from error
        except QuotaExceededError as error:
            raise ProviderQuotaExceededError() from error
        except ModelCurrentlyNotSupportError as error:
            raise ProviderModelCurrentlyNotSupportError() from error
        except InvokeError as error:
            raise CompletionRequestError(error.description) from error
        except (BaseHTTPException, ValueError):
            raise
        except Exception as error:
            logger.exception("Console audio operation failed")
            raise InternalServerError() from error

    return decorated


def _get_audio_app(context: RequestContext, app_id: UUID) -> AudioAppRef:
    try:
        app = application_services().apps.console.get_reference(context, str(app_id))
    except ConsoleAppNotFoundError as error:
        raise AppNotFoundError() from error
    return AudioAppRef(app_id=app.id, tenant_id=context.active_workspace_id, app_mode=app.mode)


def _get_agent_audio_app(context: RequestContext, agent_id: UUID, *, create: bool) -> AudioAppRef:
    access = application_services().agent_apps.access
    try:
        app_id = (
            access.resolve_runtime_app_id(context, str(agent_id))
            if create
            else access.resolve_existing_runtime_app_id(context, str(agent_id))
        )
    except AgentAppNotFoundError as error:
        raise NotFoundError(str(error) or "Agent not found.") from error
    return AudioAppRef(app_id=app_id, tenant_id=context.active_workspace_id, app_mode=AppMode.AGENT)


@_audio_errors
def _transcribe_audio_to_text(*, app: AudioAppRef, audio: AudioUpload | None) -> dict[str, object]:
    response = application_services().app_audio.transcript_asr(app=app, audio=audio)
    return dump_response(AudioTranscriptResponse, response)


@_audio_errors
def _transcribe_agent_audio_to_text(
    *,
    app: AudioAppRef,
    agent_id: UUID,
    context: RequestContext,
    draft_type: AudioDraftType,
    audio: AudioUpload | None,
) -> dict[str, object]:
    response = application_services().app_audio.transcript_agent_asr(
        app=app,
        agent_id=str(agent_id),
        actor=MessageAccount(context.account_id),
        draft_type=draft_type,
        audio=audio,
    )
    return dump_response(AudioTranscriptResponse, response)


@console_ns.route("/apps/<uuid:app_id>/audio-to-text")
class ChatMessageAudioApi(Resource):
    @error_responses(
        AgentVersionNotFoundError,
        AppNotFoundError,
        AppUnavailableError,
        AudioTooLargeError,
        CompletionRequestError,
        NoAudioUploadedError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderNotSupportSpeechToTextError,
        ProviderQuotaExceededError,
        SpeechToTextDisabledError,
        UnsupportedAudioTypeError,
    )
    @console_ns.doc("chat_message_audio_transcript")
    @console_ns.doc(description="Transcript audio to text for chat messages")
    @console_ns.doc(
        consumes=["multipart/form-data"],
        params={"app_id": "App ID", "file": _AUDIO_TRANSCRIPT_FILE_PARAM},
    )
    @console_ns.response(
        HTTPStatus.OK,
        "Audio transcription successful",
        console_ns.models[AudioTranscriptResponse.__name__],
    )
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Bad request - No audio uploaded or unsupported type")
    @console_ns.response(HTTPStatus.NOT_FOUND, "App not found or its mode does not support audio transcription")
    @console_ns.response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Audio file too large")
    @console_account_admission()
    def post(self, context: RequestContext, app_id: UUID) -> dict[str, object]:
        app = _get_audio_app(context, app_id)
        if AppMode.value_of(app.app_mode) not in _CONSOLE_AUDIO_TRANSCRIPT_APP_MODES:
            mode_values = {mode.value for mode in _CONSOLE_AUDIO_TRANSCRIPT_APP_MODES}
            raise AppNotFoundError(f"App mode is not in the supported list: {mode_values}")
        file = request.files.get("file")
        audio = AudioUpload(stream=file.stream, mime_type=file.mimetype) if file is not None else None
        return _transcribe_audio_to_text(app=app, audio=audio)


@console_ns.route("/agent/<uuid:agent_id>/audio-to-text")
class AgentChatMessageAudioApi(Resource):
    @error_responses(
        AppUnavailableError,
        AudioTooLargeError,
        CompletionRequestError,
        NoAudioUploadedError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderNotSupportSpeechToTextError,
        ProviderQuotaExceededError,
        SpeechToTextDisabledError,
        UnsupportedAudioTypeError,
    )
    @console_ns.doc("agent_chat_message_audio_transcript")
    @console_ns.doc(description="Transcribe audio using the current Agent debug configuration")
    @console_ns.doc(
        consumes=["multipart/form-data"],
        params={"agent_id": "Agent ID", **_AGENT_AUDIO_TRANSCRIPT_PARAMS},
    )
    @console_ns.response(
        HTTPStatus.OK,
        "Audio transcription successful",
        console_ns.models[AudioTranscriptResponse.__name__],
    )
    @console_ns.response(
        HTTPStatus.BAD_REQUEST, "Bad request - Speech to text disabled, unsupported audio, or invalid debug source"
    )
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.NOT_FOUND, "Agent or build draft not found")
    @console_ns.response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Audio file too large")
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR})
    )
    def post(self, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        payload = AgentAudioTranscriptFormPayload.model_validate(request.form.to_dict(flat=True))
        app = _get_agent_audio_app(context, agent_id, create=True)
        # Agent routes expose Agent ids, while APP RBAC is keyed by the resolved runtime App id.
        enforce_rbac_checks(
            tenant_id=context.active_workspace_id,
            account_id=context.account_id,
            checks=[RBACCheck(RBACPermission.APP_TEST_AND_RUN, PlainApp())],
            path_args={"app_id": app.app_id},
        )
        file = request.files.get("file")
        audio = AudioUpload(stream=file.stream, mime_type=file.mimetype) if file is not None else None
        return _transcribe_agent_audio_to_text(
            app=app,
            agent_id=agent_id,
            context=context,
            draft_type="debug_build" if payload.draft_type == AgentConfigDraftType.DEBUG_BUILD else "draft",
            audio=audio,
        )


@_audio_errors
def _text_to_speech(*, payload: TextToSpeechPayload, app: AudioAppRef, context: RequestContext) -> Response | None:
    output = application_services().app_audio.transcript_tts(
        app=app,
        actor=MessageAccount(context.account_id),
        text=payload.text,
        voice=payload.voice,
        message_id=payload.message_id,
        is_draft=True,
    )
    return audio_binary_response(output)


@console_ns.route("/apps/<uuid:app_id>/text-to-audio")
class ChatMessageTextApi(Resource):
    @error_responses(
        AppNotFoundError,
        AppUnavailableError,
        CompletionRequestError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderNotSupportTextToSpeechError,
        ProviderQuotaExceededError,
    )
    @console_ns.doc("chat_message_text_to_speech")
    @console_ns.doc(description="Convert text to speech for chat messages")
    @console_ns.doc(params={"app_id": "App ID"})
    @console_ns.expect(console_ns.models[TextToSpeechPayload.__name__])
    # TTS returns provider audio bytes, so the success response is intentionally schema-less.
    @console_ns.response(HTTPStatus.OK, "Text to speech conversion successful")
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Bad request - Invalid parameters")
    @console_ns.response(HTTPStatus.NOT_FOUND, "App not found")
    @console_ns.response(HTTPStatus.UNPROCESSABLE_ENTITY, "Invalid request payload")
    @console_account_admission()
    @model_validate(TextToSpeechPayload)
    def post(self, req_data: TextToSpeechPayload, context: RequestContext, app_id: UUID) -> Response | None:
        app = _get_audio_app(context, app_id)
        # response-contract:ignore audio_binary_response
        return _text_to_speech(payload=req_data, app=app, context=context)


@console_ns.route("/agent/<uuid:agent_id>/text-to-audio")
class AgentChatMessageTextApi(Resource):
    @error_responses(
        AppUnavailableError,
        CompletionRequestError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderNotSupportTextToSpeechError,
        ProviderQuotaExceededError,
    )
    @console_ns.doc("agent_chat_message_text_to_speech")
    @console_ns.doc(description="Preview an Agent TTS voice or read an Agent chat message")
    @console_ns.doc(params={"agent_id": "Agent ID"})
    @console_ns.doc(
        produces=list(SUPPORTED_TTS_AUDIO_MIME_TYPES),
        vendor={BINARY_RESPONSE_MEDIA_TYPES_VENDOR_KEY: list(SUPPORTED_TTS_AUDIO_MIME_TYPES)},
    )
    @console_ns.expect(console_ns.models[TextToSpeechPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Generated audio bytes in the provider audio format")
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid text or voice")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.NOT_FOUND, "Agent not found")
    @console_ns.response(HTTPStatus.UNPROCESSABLE_ENTITY, "Invalid request payload")
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=[RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId())],
    )
    @model_validate(TextToSpeechPayload)
    def post(self, req_data: TextToSpeechPayload, context: RequestContext, agent_id: UUID) -> Response | None:
        app = _get_agent_audio_app(context, agent_id, create=False)
        # response-contract:ignore audio_binary_response
        return _text_to_speech(payload=req_data, app=app, context=context)


@_audio_errors
def _get_text_to_speech_voices(*, tenant_id: str, language: str) -> list[dict[str, object]]:
    response = application_services().app_audio.get_voices(tenant_id=tenant_id, language=language)
    return TextToSpeechVoiceListResponse.model_validate(response).model_dump(mode="json")


@console_ns.route("/apps/<uuid:app_id>/text-to-audio/voices")
class TextModesApi(Resource):
    @error_responses(
        AppNotFoundError,
        CompletionRequestError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
    )
    @console_ns.doc("get_text_to_speech_voices")
    @console_ns.doc(description="Get available TTS voices for a specific language")
    @console_ns.doc(params={"app_id": "App ID", **query_params_from_model(TextToSpeechVoiceQuery)})
    @console_ns.response(
        HTTPStatus.OK,
        "TTS voices retrieved successfully",
        console_ns.models[TextToSpeechVoiceListResponse.__name__],
    )
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid language parameter")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.NOT_FOUND, "App not found")
    @console_ns.response(HTTPStatus.UNPROCESSABLE_ENTITY, "Invalid query parameters")
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp())])
    @model_validate(TextToSpeechVoiceQuery)
    def get(self, req_data: TextToSpeechVoiceQuery, context: RequestContext, app_id: UUID) -> list[dict[str, object]]:
        app = _get_audio_app(context, app_id)
        return _get_text_to_speech_voices(tenant_id=app.tenant_id, language=req_data.language)


@console_ns.route("/agent/<uuid:agent_id>/text-to-audio/voices")
class AgentTextToSpeechVoicesApi(Resource):
    @error_responses(
        CompletionRequestError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
    )
    @console_ns.doc("get_agent_text_to_speech_voices")
    @console_ns.doc(description="Get available TTS voices for an Agent and language")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(TextToSpeechVoiceQuery)})
    @console_ns.response(
        HTTPStatus.OK,
        "TTS voices retrieved successfully",
        console_ns.models[TextToSpeechVoiceListResponse.__name__],
    )
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid language parameter")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.NOT_FOUND, "Agent not found")
    @console_ns.response(HTTPStatus.UNPROCESSABLE_ENTITY, "Invalid query parameters")
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())])
    @model_validate(TextToSpeechVoiceQuery)
    def get(self, req_data: TextToSpeechVoiceQuery, context: RequestContext, agent_id: UUID) -> list[dict[str, object]]:
        app = _get_agent_audio_app(context, agent_id, create=False)
        return _get_text_to_speech_voices(tenant_id=app.tenant_id, language=req_data.language)
