"""Tests for streaming stage event types."""

from core.workflow.generator.types.streaming import (
    STAGE_BUILDING,
    STAGE_PLANNING,
    STAGE_VALIDATING,
    StageEvent,
    format_sse_event,
    get_stage_message,
)


class TestStageEvent:
    """Tests for StageEvent model."""

    def test_stage_event_planning(self):
        """Test creating a planning stage event."""
        event = StageEvent(stage=STAGE_PLANNING, message="Analyzing requirements...")
        assert event.stage == "planning"
        assert event.message == "Analyzing requirements..."

    def test_stage_event_building(self):
        """Test creating a building stage event."""
        event = StageEvent(stage=STAGE_BUILDING, message="Generating workflow...")
        assert event.stage == "building"
        assert event.message == "Generating workflow..."

    def test_stage_event_validating(self):
        """Test creating a validating stage event."""
        event = StageEvent(stage=STAGE_VALIDATING, message="Validating...")
        assert event.stage == "validating"
        assert event.message == "Validating..."


class TestFormatSSEEvent:
    """Tests for SSE event formatting."""

    def test_format_stage_event(self):
        """Test formatting a stage event as SSE."""
        event = StageEvent(stage=STAGE_PLANNING, message="Analyzing...")
        result = format_sse_event("stage", event.model_dump())
        assert result == 'data: {"event": "stage", "stage": "planning", "message": "Analyzing..."}\n\n'

    def test_format_complete_event(self):
        """Test formatting a complete event as SSE."""
        data = {"intent": "generate", "nodes": [], "edges": []}
        result = format_sse_event("complete", data)
        assert 'data: {"event": "complete"' in result
        assert '"intent": "generate"' in result

    def test_format_error_event(self):
        """Test formatting an error event as SSE."""
        data = {"error": "Something went wrong", "error_code": "BUILDING_FAILED"}
        result = format_sse_event("error", data)
        assert 'data: {"event": "error"' in result
        assert '"error": "Something went wrong"' in result


class TestGetStageMessage:
    """Tests for get_stage_message localization."""

    def test_default_returns_english(self):
        """Test that default language returns English message."""
        result = get_stage_message(STAGE_PLANNING)
        assert result == "Analyzing requirements..."

    def test_explicit_english(self):
        """Test explicit English language code."""
        result = get_stage_message(STAGE_BUILDING, "en")
        assert result == "Generating workflow..."

    def test_chinese_zh_hans(self):
        """Test Chinese (Simplified) language code."""
        result = get_stage_message(STAGE_VALIDATING, "zh-Hans")
        assert result == "正在验证..."

    def test_chinese_zh_cn(self):
        """Test Chinese (China) language code."""
        result = get_stage_message(STAGE_PLANNING, "zh-CN")
        assert result == "正在分析需求..."

    def test_unknown_stage_fallback(self):
        """Test fallback behavior for unknown stage."""
        result = get_stage_message("unknown", "en")
        assert result == "unknown"
