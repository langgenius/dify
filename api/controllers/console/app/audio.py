import logging
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, RootModel
from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import HTTPException, InternalServerError

import services
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.common.wraps import enforce_rbac_access
from controllers.console import console_ns
from controllers.console.agent.app_helpers import resolve_agent_runtime_app_model
from controllers.console.app.error import (
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
from controllers.console.app.wraps import get_app_model, with_session
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from extensions.ext_database import db
from fields.base import ResponseModel
from graphon.model_runtime.errors.invoke import InvokeError
from libs.helper import dump_response
from libs.login import current_user, login_required
from models import Account, App, AppMode
from models.agent import AgentConfigDraftType
from models.agent_config_entities import AgentSoulConfig
from services.agent.composer_service import AgentComposerService
from services.app_ref_service import AppRefService
from services.audio_service import AudioService
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
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


def _transcribe_audio_to_text(
    *,
    app_model: App,
    file: FileStorage | None,
    agent_soul: AgentSoulConfig | None = None,
) -> dict[str, str]:
    try:
        if agent_soul is None:
            response = AudioService.transcript_asr(
                app_model=app_model,
                file=file,
                end_user=None,
            )
        else:
            response = AudioService.transcript_agent_asr(
                app_model=app_model,
                agent_soul=agent_soul,
                file=file,
                end_user=None,
            )
        return dump_response(AudioTranscriptResponse, response)
    except services.errors.app_model_config.AppModelConfigBrokenError:
        logger.exception("App model config broken.")
        raise AppUnavailableError()
    except NoAudioUploadedServiceError:
        raise NoAudioUploadedError()
    except AudioTooLargeServiceError as e:
        raise AudioTooLargeError(str(e))
    except UnsupportedAudioTypeServiceError:
        raise UnsupportedAudioTypeError()
    except ProviderNotSupportSpeechToTextServiceError:
        raise ProviderNotSupportSpeechToTextError()
    except SpeechToTextDisabledServiceError:
        raise SpeechToTextDisabledError()
    except ProviderTokenNotInitError as ex:
        raise ProviderNotInitializeError(ex.description)
    except QuotaExceededError:
        raise ProviderQuotaExceededError()
    except ModelCurrentlyNotSupportError:
        raise ProviderModelCurrentlyNotSupportError()
    except InvokeError as e:
        raise CompletionRequestError(e.description)
    except HTTPException:
        raise
    except ValueError:
        raise
    except Exception as e:
        logger.exception("Failed to transcribe audio to text")
        raise InternalServerError() from e


@console_ns.route("/apps/<uuid:app_id>/audio-to-text")
class ChatMessageAudioApi(Resource):
    @console_ns.doc("chat_message_audio_transcript")
    @console_ns.doc(description="Transcript audio to text for chat messages")
    @console_ns.doc(
        consumes=["multipart/form-data"],
        params={"app_id": "App ID", "file": _AUDIO_TRANSCRIPT_FILE_PARAM},
    )
    @console_ns.response(
        200,
        "Audio transcription successful",
        console_ns.models[AudioTranscriptResponse.__name__],
    )
    @console_ns.response(400, "Bad request - No audio uploaded or unsupported type")
    @console_ns.response(413, "Audio file too large")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=_CONSOLE_AUDIO_TRANSCRIPT_APP_MODES)
    def post(self, app_model: App):
        return _transcribe_audio_to_text(app_model=app_model, file=request.files.get("file"))


@console_ns.route("/agent/<uuid:agent_id>/audio-to-text")
class AgentChatMessageAudioApi(Resource):
    @console_ns.doc("agent_chat_message_audio_transcript")
    @console_ns.doc(description="Transcribe audio using the current Agent debug configuration")
    @console_ns.doc(
        consumes=["multipart/form-data"],
        params={"agent_id": "Agent ID", **_AGENT_AUDIO_TRANSCRIPT_PARAMS},
    )
    @console_ns.response(
        200,
        "Audio transcription successful",
        console_ns.models[AudioTranscriptResponse.__name__],
    )
    @console_ns.response(400, "Bad request - Speech to text disabled or unsupported audio")
    @console_ns.response(404, "Agent or build draft not found")
    @console_ns.response(413, "Audio file too large")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    @with_session
    def post(
        self,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        agent_id: UUID,
    ):
        payload = AgentAudioTranscriptFormPayload.model_validate(request.form.to_dict(flat=True))
        app_model = resolve_agent_runtime_app_model(tenant_id=current_tenant_id, agent_id=agent_id)
        # Agent routes expose Agent ids, while APP RBAC is keyed by the resolved runtime App id.
        enforce_rbac_access(
            tenant_id=current_tenant_id,
            account_id=current_user.id,
            resource_type=RBACResourceScope.APP,
            scene=RBACPermission.APP_TEST_AND_RUN,
            path_args={"app_id": app_model.id},
        )
        agent_soul = AgentComposerService.load_agent_soul_for_debug(
            tenant_id=current_tenant_id,
            agent_id=str(agent_id),
            account_id=current_user.id,
            draft_type=payload.draft_type,
            session=session,
        )
        return _transcribe_audio_to_text(
            app_model=app_model,
            agent_soul=agent_soul,
            file=request.files.get("file"),
        )


@console_ns.route("/apps/<uuid:app_id>/text-to-audio")
class ChatMessageTextApi(Resource):
    @console_ns.doc("chat_message_text_to_speech")
    @console_ns.doc(description="Convert text to speech for chat messages")
    @console_ns.doc(params={"app_id": "App ID"})
    @console_ns.expect(console_ns.models[TextToSpeechPayload.__name__])
    # TTS returns provider audio bytes, so the success response is intentionally schema-less.
    @console_ns.response(200, "Text to speech conversion successful")
    @console_ns.response(400, "Bad request - Invalid parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def post(self, app_model: App):
        try:
            payload = TextToSpeechPayload.model_validate(console_ns.payload)
            message_ref = None
            if payload.message_id:
                app_ref = AppRefService.create_app_ref(app_model)
                message_ref = AppRefService.create_message_ref(
                    app_ref,
                    payload.message_id,
                    account_id=current_user.id,
                )

            # response-contract:ignore
            return AudioService.transcript_tts(
                app_model=app_model,
                session=db.session(),
                text=payload.text,
                voice=payload.voice,
                message_ref=message_ref,
                is_draft=True,
            )
        except services.errors.app_model_config.AppModelConfigBrokenError:
            logger.exception("App model config broken.")
            raise AppUnavailableError()
        except NoAudioUploadedServiceError:
            raise NoAudioUploadedError()
        except AudioTooLargeServiceError as e:
            raise AudioTooLargeError(str(e))
        except UnsupportedAudioTypeServiceError:
            raise UnsupportedAudioTypeError()
        except ProviderNotSupportSpeechToTextServiceError:
            raise ProviderNotSupportSpeechToTextError()
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except ValueError as e:
            raise e
        except Exception as e:
            logger.exception("Failed to handle post request to ChatMessageTextApi")
            raise InternalServerError()


@console_ns.route("/apps/<uuid:app_id>/text-to-audio/voices")
class TextModesApi(Resource):
    @console_ns.doc("get_text_to_speech_voices")
    @console_ns.doc(description="Get available TTS voices for a specific language")
    @console_ns.doc(params={"app_id": "App ID", **query_params_from_model(TextToSpeechVoiceQuery)})
    @console_ns.response(
        200,
        "TTS voices retrieved successfully",
        console_ns.models[TextToSpeechVoiceListResponse.__name__],
    )
    @console_ns.response(400, "Invalid language parameter")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model
    def get(self, app_model: App):
        try:
            args = TextToSpeechVoiceQuery.model_validate(request.args.to_dict(flat=True))

            response = AudioService.transcript_tts_voices(
                tenant_id=app_model.tenant_id,
                language=args.language,
            )

            return dump_response(TextToSpeechVoiceListResponse, response)
        except services.errors.audio.ProviderNotSupportTextToSpeechLanageServiceError:
            raise AppUnavailableError("Text to audio voices language parameter loss.")
        except NoAudioUploadedServiceError:
            raise NoAudioUploadedError()
        except AudioTooLargeServiceError as e:
            raise AudioTooLargeError(str(e))
        except UnsupportedAudioTypeServiceError:
            raise UnsupportedAudioTypeError()
        except ProviderNotSupportSpeechToTextServiceError:
            raise ProviderNotSupportSpeechToTextError()
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except ValueError as e:
            raise e
        except Exception as e:
            logger.exception("Failed to handle get request to TextModesApi")
            raise InternalServerError()
