from __future__ import annotations

from controllers.console.app import annotation as annotation_module


def test_annotation_reply_payload_valid():
    """Test AnnotationReplyPayload with valid data."""
    payload = annotation_module.AnnotationReplyPayload(
        score_threshold=0.5,
        embedding_provider_name="openai",
        embedding_model_name="text-embedding-3-small",
    )
    assert payload.score_threshold == 0.5
    assert payload.embedding_provider_name == "openai"
    assert payload.embedding_model_name == "text-embedding-3-small"


def test_annotation_setting_update_payload_valid():
    """Test AnnotationSettingUpdatePayload with valid data."""
    payload = annotation_module.AnnotationSettingUpdatePayload(
        score_threshold=0.75,
    )
    assert payload.score_threshold == 0.75


def test_annotation_list_query_defaults():
    """Test AnnotationListQuery with default parameters."""
    query = annotation_module.AnnotationListQuery()
    assert query.page == 1
    assert query.limit == 20
    assert query.keyword == ""


def test_annotation_list_query_custom_page():
    """Test AnnotationListQuery with custom page."""
    query = annotation_module.AnnotationListQuery(page=3, limit=50)
    assert query.page == 3
    assert query.limit == 50


def test_annotation_list_query_with_keyword():
    """Test AnnotationListQuery with keyword."""
    query = annotation_module.AnnotationListQuery(keyword="test")
    assert query.keyword == "test"


def test_create_annotation_payload_with_message_id():
    """Test CreateAnnotationPayload with message ID."""
    payload = annotation_module.CreateAnnotationPayload(
        message_id="550e8400-e29b-41d4-a716-446655440000",
        question="What is AI?",
    )
    assert payload.message_id == "550e8400-e29b-41d4-a716-446655440000"
    assert payload.question == "What is AI?"


def test_create_annotation_payload_with_text():
    """Test CreateAnnotationPayload with text content."""
    payload = annotation_module.CreateAnnotationPayload(
        question="What is ML?",
        answer="Machine learning is...",
    )
    assert payload.question == "What is ML?"
    assert payload.answer == "Machine learning is..."


def test_update_annotation_payload():
    """Test UpdateAnnotationPayload."""
    payload = annotation_module.UpdateAnnotationPayload(
        question="Updated question",
        answer="Updated answer",
    )
    assert payload.question == "Updated question"
    assert payload.answer == "Updated answer"


def test_annotation_reply_status_query_enable():
    """Test AnnotationReplyStatusQuery with enable action."""
    query = annotation_module.AnnotationReplyStatusQuery(action="enable")
    assert query.action == "enable"


def test_annotation_reply_status_query_disable():
    """Test AnnotationReplyStatusQuery with disable action."""
    query = annotation_module.AnnotationReplyStatusQuery(action="disable")
    assert query.action == "disable"


def test_annotation_file_payload_valid():
    """Test AnnotationFilePayload with valid message ID."""
    payload = annotation_module.AnnotationFilePayload(message_id="550e8400-e29b-41d4-a716-446655440000")
    assert payload.message_id == "550e8400-e29b-41d4-a716-446655440000"
