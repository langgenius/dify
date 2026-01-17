import time
from unittest.mock import patch

import pytest

from core.workflow.generator.logging import GenerationLogger, log_phase


class TestGenerationLogger:
    def test_init_captures_context(self):
        gen_logger = GenerationLogger("tenant_123", "Create a workflow")
        assert gen_logger.tenant_id == "tenant_123"
        assert gen_logger.metrics["tenant_id"] == "tenant_123"
        assert gen_logger.metrics["instruction_length"] == 17

    def test_instruction_preview_truncation(self):
        long_instruction = "a" * 150
        gen_logger = GenerationLogger("tenant_123", long_instruction)
        assert gen_logger.instruction_preview == "a" * 100 + "..."

    def test_log_phase_start(self):
        gen_logger = GenerationLogger("tenant_123", "test")
        with patch("core.workflow.generator.logging.logger") as mock_logger:
            gen_logger.log_phase_start("planner")
            mock_logger.info.assert_called_once()
            call_args = mock_logger.info.call_args
            assert call_args[0][0] == "workflow_generation_phase_start"
            assert call_args[1]["extra"]["phase"] == "planner"

    def test_log_phase_end_calculates_duration(self):
        gen_logger = GenerationLogger("tenant_123", "test")
        gen_logger.metrics["planner_start"] = time.time() - 1  # 1 second ago
        with patch("core.workflow.generator.logging.logger") as mock_logger:
            gen_logger.log_phase_end("planner", success=True)
            call_args = mock_logger.info.call_args
            duration = call_args[1]["extra"]["duration_ms"]
            assert duration >= 1000  # At least 1 second

    def test_log_retry(self):
        gen_logger = GenerationLogger("tenant_123", "test")
        with patch("core.workflow.generator.logging.logger") as mock_logger:
            gen_logger.log_retry(2, "validation_failed")
            mock_logger.warning.assert_called_once()
            call_args = mock_logger.warning.call_args
            assert call_args[1]["extra"]["attempt"] == 2
            assert call_args[1]["extra"]["reason"] == "validation_failed"

    def test_log_completion_success(self):
        gen_logger = GenerationLogger("tenant_123", "test")
        with patch("core.workflow.generator.logging.logger") as mock_logger:
            gen_logger.log_completion(success=True)
            mock_logger.info.assert_called()
            call_args = mock_logger.info.call_args
            assert call_args[1]["extra"]["success"] is True

    def test_log_completion_failure(self):
        gen_logger = GenerationLogger("tenant_123", "test")
        with patch("core.workflow.generator.logging.logger") as mock_logger:
            gen_logger.log_completion(success=False)
            mock_logger.error.assert_called()

    def test_log_error(self):
        gen_logger = GenerationLogger("tenant_123", "test")
        with patch("core.workflow.generator.logging.logger") as mock_logger:
            gen_logger.log_error("VALIDATION_FAILED", "Node is invalid")
            mock_logger.error.assert_called_once()
            call_args = mock_logger.error.call_args
            assert call_args[1]["extra"]["error_code"] == "VALIDATION_FAILED"


class TestLogPhaseContextManager:
    def test_log_phase_success(self):
        gen_logger = GenerationLogger("tenant_123", "test")
        with patch.object(gen_logger, "log_phase_start") as mock_start:
            with patch.object(gen_logger, "log_phase_end") as mock_end:
                with log_phase(gen_logger, "builder"):
                    pass
                mock_start.assert_called_once_with("builder")
                mock_end.assert_called_once_with("builder", success=True)

    def test_log_phase_failure(self):
        gen_logger = GenerationLogger("tenant_123", "test")
        with patch.object(gen_logger, "log_phase_start"):
            with patch.object(gen_logger, "log_phase_end") as mock_end:
                with pytest.raises(ValueError):
                    with log_phase(gen_logger, "builder"):
                        raise ValueError("test error")
                mock_end.assert_called_once()
                call_args = mock_end.call_args
                assert call_args[1]["success"] is False
                assert "test error" in call_args[1]["error"]
