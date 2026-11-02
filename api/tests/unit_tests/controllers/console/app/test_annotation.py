from configs import dify_config
from controllers.console.app import annotation as annotation_module
from tasks.annotation.batch_import_annotations_task import batch_import_annotations_task


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


class TestAnnotationImportTaskOptimization:
    """Test optimizations in batch import task."""

    def test_task_is_registered_with_queue(self):
        """Test that task is registered with the correct queue."""
        assert batch_import_annotations_task.queue == "dataset"


class TestConfigurationValues:
    """Test that security configuration values are properly set."""

    def test_rate_limit_configs_exist(self):
        """Test that rate limit configurations are defined."""
        assert hasattr(dify_config, "ANNOTATION_IMPORT_RATE_LIMIT_PER_MINUTE")
        assert hasattr(dify_config, "ANNOTATION_IMPORT_RATE_LIMIT_PER_HOUR")

        assert dify_config.ANNOTATION_IMPORT_RATE_LIMIT_PER_MINUTE > 0
        assert dify_config.ANNOTATION_IMPORT_RATE_LIMIT_PER_HOUR > 0

    def test_file_size_limit_config_exists(self):
        """Test that file size limit configuration is defined."""
        assert hasattr(dify_config, "ANNOTATION_IMPORT_FILE_SIZE_LIMIT")
        assert dify_config.ANNOTATION_IMPORT_FILE_SIZE_LIMIT > 0
        assert dify_config.ANNOTATION_IMPORT_FILE_SIZE_LIMIT <= 10  # Reasonable max (10MB)

    def test_record_limit_configs_exist(self):
        """Test that record limit configurations are defined."""
        assert hasattr(dify_config, "ANNOTATION_IMPORT_MAX_RECORDS")
        assert hasattr(dify_config, "ANNOTATION_IMPORT_MIN_RECORDS")

        assert dify_config.ANNOTATION_IMPORT_MAX_RECORDS > 0
        assert dify_config.ANNOTATION_IMPORT_MIN_RECORDS > 0
        assert dify_config.ANNOTATION_IMPORT_MIN_RECORDS < dify_config.ANNOTATION_IMPORT_MAX_RECORDS

    def test_concurrency_limit_config_exists(self):
        """Test that concurrency limit configuration is defined."""
        assert hasattr(dify_config, "ANNOTATION_IMPORT_MAX_CONCURRENT")
        assert dify_config.ANNOTATION_IMPORT_MAX_CONCURRENT > 0
        assert dify_config.ANNOTATION_IMPORT_MAX_CONCURRENT <= 10  # Reasonable upper bound


def test_annotation_count_response() -> None:
    assert annotation_module.AnnotationCountResponse(count=10).count == 10
