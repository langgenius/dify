from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypedDict

from configs import dify_config
from constants import DEFAULT_FILE_NUMBER_LIMITS

if TYPE_CHECKING:
    from models.model import App


class FeatureToggleDict(TypedDict):
    enabled: bool


class SystemParametersDict(TypedDict):
    image_file_size_limit: int
    video_file_size_limit: int
    audio_file_size_limit: int
    file_size_limit: int
    workflow_file_upload_limit: int


class AppParametersDict(TypedDict):
    opening_statement: str | None
    suggested_questions: list[str]
    suggested_questions_after_answer: FeatureToggleDict
    speech_to_text: FeatureToggleDict
    text_to_speech: FeatureToggleDict
    retriever_resource: FeatureToggleDict
    annotation_reply: FeatureToggleDict
    more_like_this: FeatureToggleDict
    user_input_form: list[dict[str, Any]]
    sensitive_word_avoidance: dict[str, Any]
    file_upload: dict[str, Any]
    system_parameters: SystemParametersDict


def get_parameters_from_feature_dict(
    *, features_dict: Mapping[str, Any], user_input_form: list[dict[str, Any]]
) -> AppParametersDict:
    """
    Mapping from feature dict to webapp parameters
    """
    return {
        "opening_statement": features_dict.get("opening_statement"),
        "suggested_questions": features_dict.get("suggested_questions", []),
        "suggested_questions_after_answer": features_dict.get("suggested_questions_after_answer", {"enabled": False}),
        "speech_to_text": features_dict.get("speech_to_text", {"enabled": False}),
        "text_to_speech": features_dict.get("text_to_speech", {"enabled": False}),
        "retriever_resource": features_dict.get("retriever_resource", {"enabled": False}),
        "annotation_reply": features_dict.get("annotation_reply", {"enabled": False}),
        "more_like_this": features_dict.get("more_like_this", {"enabled": False}),
        "user_input_form": user_input_form,
        "sensitive_word_avoidance": features_dict.get(
            "sensitive_word_avoidance", {"enabled": False, "type": "", "configs": []}
        ),
        "file_upload": features_dict.get(
            "file_upload",
            {
                "image": {
                    "enabled": False,
                    "number_limits": DEFAULT_FILE_NUMBER_LIMITS,
                    "detail": "high",
                    "transfer_methods": ["remote_url", "local_file"],
                }
            },
        ),
        "system_parameters": {
            "image_file_size_limit": dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT,
            "video_file_size_limit": dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT,
            "audio_file_size_limit": dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT,
            "file_size_limit": dify_config.UPLOAD_FILE_SIZE_LIMIT,
            "workflow_file_upload_limit": dify_config.WORKFLOW_FILE_UPLOAD_LIMIT,
        },
    }


class AppParametersUnavailableError(Exception):
    """Raised when an app cannot yet expose webapp parameters (no published config)."""


def get_app_parameters(app_model: "App") -> AppParametersDict:
    """Resolve the webapp parameters for any app type.

    Workflow / advanced-chat apps read their feature flags from the bound
    workflow; easy-UI apps (chat / agent-chat / completion) from their
    ``app_model_config``. An Agent App has neither a workflow nor a legacy
    ``app_model_config`` — its presentation features are not yet configurable,
    so every toggle defaults to disabled with a free-form chat input.
    """
    from models.model import AppMode

    features_dict: Mapping[str, Any]
    user_input_form: list[dict[str, Any]]

    if app_model.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
        workflow = app_model.workflow
        if workflow is None:
            raise AppParametersUnavailableError()
        features_dict = workflow.features_dict
        user_input_form = workflow.user_input_form(to_old_structure=True)
    elif app_model.app_model_config is not None:
        features_dict = app_model.app_model_config.to_dict()
        user_input_form = features_dict.get("user_input_form", [])
    elif app_model.mode == AppMode.AGENT:
        features_dict = {}
        user_input_form = []
    else:
        raise AppParametersUnavailableError()

    return get_parameters_from_feature_dict(features_dict=features_dict, user_input_form=user_input_form)
