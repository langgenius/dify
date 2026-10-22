"""
This unit test verifies Workflow compatibility before and after supporting multiple file types.
"""

import json

import pytest
from pydantic import JsonValue

from models import Workflow

OLD_VERSION_WORKFLOW_FEATURES: dict[str, JsonValue] = {
    "file_upload": {
        "image": {
            "enabled": True,
            "number_limits": 6,
            "transfer_methods": ["remote_url", "local_file"],
        }
    },
    "opening_statement": "",
    "retriever_resource": {"enabled": True},
    "sensitive_word_avoidance": {"enabled": False},
    "speech_to_text": {"enabled": False},
    "suggested_questions": [],
    "suggested_questions_after_answer": {"enabled": False},
    "text_to_speech": {"enabled": False, "language": "", "voice": ""},
}

NEW_VERSION_WORKFLOW_FEATURES: dict[str, JsonValue] = {
    "file_upload": {
        "enabled": True,
        "allowed_file_types": ["image"],
        "allowed_file_extensions": [],
        "allowed_file_upload_methods": ["remote_url", "local_file"],
        "number_limits": 6,
    },
    "opening_statement": "",
    "retriever_resource": {"enabled": True},
    "sensitive_word_avoidance": {"enabled": False},
    "speech_to_text": {"enabled": False},
    "suggested_questions": [],
    "suggested_questions_after_answer": {"enabled": False},
    "text_to_speech": {"enabled": False, "language": "", "voice": ""},
}


def test_workflow_features() -> None:
    workflow = Workflow(
        tenant_id="",
        app_id="",
        type="",
        version="",
        graph="",
        features=json.dumps(OLD_VERSION_WORKFLOW_FEATURES),
        created_by="",
        environment_variables=[],
        conversation_variables=[],
    )

    assert workflow.features_dict == NEW_VERSION_WORKFLOW_FEATURES


@pytest.mark.parametrize(
    "image",
    [{"enabled": True}, {"enabled": True, "number_limits": 3}, {"enabled": True, "number_limits": 6}],
)
@pytest.mark.parametrize("accessor", ["features_dict", "normalized_features_dict"])
@pytest.mark.parametrize("enabled", [True, False])
def test_workflow_features_preserve_top_level_file_upload_config(
    image: dict[str, JsonValue], accessor: str, enabled: bool
) -> None:
    workflow = Workflow(
        features=json.dumps(
            {
                "file_upload": {
                    "enabled": enabled,
                    "number_limits": 10,
                    "allowed_file_upload_methods": ["local_file"],
                    "image": image,
                }
            }
        )
    )

    file_upload = getattr(workflow, accessor)["file_upload"]

    assert file_upload["enabled"] is enabled
    assert file_upload["number_limits"] == 10
    assert file_upload["allowed_file_upload_methods"] == ["local_file"]
    assert "image" not in file_upload


def test_workflow_features_default_legacy_file_upload_limit() -> None:
    workflow = Workflow(features=json.dumps({"file_upload": {"image": {"enabled": True}}}))

    assert workflow.features_dict["file_upload"]["number_limits"] == 3
