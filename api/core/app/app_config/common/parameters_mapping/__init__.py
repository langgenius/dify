from collections.abc import Mapping
from typing import Any

from configs import dify_config
from constants import DEFAULT_FILE_NUMBER_LIMITS


def get_parameters_from_feature_dict(
    *, features_dict: Mapping[str, Any], user_input_form: list[dict[str, Any]]
) -> Mapping[str, Any]:
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
