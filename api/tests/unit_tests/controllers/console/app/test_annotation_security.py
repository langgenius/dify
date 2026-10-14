"""Annotation import queue and security configuration contracts."""

from configs import dify_config
from tasks.annotation.batch_import_annotations_task import batch_import_annotations_task


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
