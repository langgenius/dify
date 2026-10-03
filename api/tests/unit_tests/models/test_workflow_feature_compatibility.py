"""
This unit test verifies Workflow compatibility before and after supporting multiple file types.
"""

import json
from uuid import uuid4

import pytest
from pydantic import JsonValue
from sqlalchemy.orm import Session

from models import Workflow
from models.workflow import WorkflowType

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
    ("features", "expected"),
    [
        pytest.param({}, {}, id="missing-upload"),
        pytest.param({"file_upload": None}, {"file_upload": None}, id="null-upload"),
        pytest.param({"file_upload": False}, {"file_upload": False}, id="non-object-upload"),
        pytest.param({"file_upload": {}}, {"file_upload": {}}, id="missing-image"),
        pytest.param({"file_upload": {"image": None}}, {"file_upload": {"image": None}}, id="null-image"),
        pytest.param({"file_upload": {"image": False}}, {"file_upload": {"image": False}}, id="non-object-image"),
        pytest.param(
            {"file_upload": {"enabled": False, "image": {"enabled": False}}},
            {"file_upload": {"enabled": False, "image": {"enabled": False}}},
            id="disabled-image",
        ),
        pytest.param(OLD_VERSION_WORKFLOW_FEATURES, NEW_VERSION_WORKFLOW_FEATURES, id="legacy-image"),
        pytest.param(NEW_VERSION_WORKFLOW_FEATURES, NEW_VERSION_WORKFLOW_FEATURES, id="modern-upload"),
    ],
)
def test_normalized_features_preserves_stored_payload_without_dirtying_workflow(
    sqlite_session: Session,
    features: dict[str, JsonValue],
    expected: dict[str, JsonValue],
) -> None:
    stored_features = json.dumps(features)
    workflow = Workflow(
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        type=WorkflowType.CHAT,
        version="published",
        graph="{}",
        features=stored_features,
        created_by=str(uuid4()),
    )
    sqlite_session.add(workflow)
    sqlite_session.commit()

    assert workflow.normalized_features_dict == expected
    assert workflow.serialized_features == stored_features
    assert workflow not in sqlite_session.dirty

    sqlite_session.expire(workflow)
    assert workflow.serialized_features == stored_features
