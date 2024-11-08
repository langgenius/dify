import mimetypes
import os
import re
import urllib.parse
from collections.abc import Mapping
from typing import Any
from uuid import uuid4

import httpx
from pydantic import BaseModel

from configs import dify_config


class FileInfo(BaseModel):
    filename: str
    extension: str
    mimetype: str
    size: int


def guess_file_info_from_response(response: httpx.Response):
    url = str(response.url)
    # Try to extract filename from URL
    parsed_url = urllib.parse.urlparse(url)
    url_path = parsed_url.path
    filename = os.path.basename(url_path)

    # If filename couldn't be extracted, use Content-Disposition header
    if not filename:
        content_disposition = response.headers.get("Content-Disposition")
        if content_disposition:
            filename_match = re.search(r'filename="?(.+)"?', content_disposition)
            if filename_match:
                filename = filename_match.group(1)

    # If still no filename, generate a unique one
    if not filename:
        unique_name = str(uuid4())
        filename = f"{unique_name}"

    # Guess MIME type from filename first, then URL
    mimetype, _ = mimetypes.guess_type(filename)
    if mimetype is None:
        mimetype, _ = mimetypes.guess_type(url)
    if mimetype is None:
        # If guessing fails, use Content-Type from response headers
        mimetype = response.headers.get("Content-Type", "application/octet-stream")

    extension = os.path.splitext(filename)[1]

    # Ensure filename has an extension
    if not extension:
        extension = mimetypes.guess_extension(mimetype) or ".bin"
        filename = f"{filename}{extension}"

    return FileInfo(
        filename=filename,
        extension=extension,
        mimetype=mimetype,
        size=int(response.headers.get("Content-Length", -1)),
    )


def get_parameters_from_feature_dict(*, features_dict: Mapping[str, Any], user_input_form: list[dict[str, Any]]):
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
                    "number_limits": 3,
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
