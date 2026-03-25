import json
from types import SimpleNamespace

from models.workflow import Workflow
from services.workflow_restore import apply_published_workflow_snapshot_to_draft

LEGACY_FEATURES = {
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

NORMALIZED_FEATURES = {
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


def _create_workflow(*, workflow_id: str, version: str, features: dict[str, object]) -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id="tenant-id",
        app_id="app-id",
        type="workflow",
        version=version,
        graph=json.dumps({"nodes": [], "edges": []}),
        features=json.dumps(features),
        created_by="account-id",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def test_apply_published_workflow_snapshot_to_draft_copies_serialized_features_without_mutating_source() -> None:
    source_workflow = _create_workflow(
        workflow_id="published-workflow-id",
        version="2026-03-19T00:00:00",
        features=LEGACY_FEATURES,
    )

    draft_workflow, is_new_draft = apply_published_workflow_snapshot_to_draft(
        tenant_id="tenant-id",
        app_id="app-id",
        source_workflow=source_workflow,
        draft_workflow=None,
        account=SimpleNamespace(id="account-id"),
        updated_at_factory=lambda: source_workflow.updated_at,
    )

    assert is_new_draft is True
    assert source_workflow.serialized_features == json.dumps(LEGACY_FEATURES)
    assert source_workflow.normalized_features_dict == NORMALIZED_FEATURES
    assert draft_workflow.serialized_features == json.dumps(LEGACY_FEATURES)
