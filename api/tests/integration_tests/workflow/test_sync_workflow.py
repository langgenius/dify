"""
This test file is used to verify the compatibility of Workflow before and after supporting multiple file types.
"""

import json

from models import Workflow

OLD_VERSION_WORKFLOW_FEATURES = {
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

NEW_VERSION_WORKFLOW_FEATURES = {
    "file_upload": {
        "enabled": True,
        "allowed_file_types": ["image"],
        "allowed_extensions": [],
        "allowed_upload_methods": ["remote_url", "local_file"],
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


def test_workflow_features():
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
