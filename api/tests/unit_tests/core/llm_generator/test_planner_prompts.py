"""
Unit tests for the Planner Prompts.

Tests cover:
- Tool formatting for planner context
- Edge cases with missing fields
- Empty tool lists
"""


from core.workflow.generator.prompts.planner_prompts import format_tools_for_planner


class TestFormatToolsForPlanner:
    """Tests for format_tools_for_planner function."""

    def test_empty_tools_returns_default_message(self):
        """Test empty tools list returns default message."""
        result = format_tools_for_planner([])

        assert result == "No external tools available."

    def test_none_tools_returns_default_message(self):
        """Test None tools list returns default message."""
        result = format_tools_for_planner(None)

        assert result == "No external tools available."

    def test_single_tool_formatting(self):
        """Test single tool is formatted correctly."""
        tools = [
            {
                "provider_id": "google",
                "tool_key": "search",
                "tool_label": "Google Search",
                "tool_description": "Search the web using Google",
            }
        ]
        result = format_tools_for_planner(tools)

        assert "[google/search]" in result
        assert "Google Search" in result
        assert "Search the web using Google" in result

    def test_multiple_tools_formatting(self):
        """Test multiple tools are formatted correctly."""
        tools = [
            {
                "provider_id": "google",
                "tool_key": "search",
                "tool_label": "Search",
                "tool_description": "Web search",
            },
            {
                "provider_id": "slack",
                "tool_key": "send_message",
                "tool_label": "Send Message",
                "tool_description": "Send a Slack message",
            },
        ]
        result = format_tools_for_planner(tools)

        lines = result.strip().split("\n")
        assert len(lines) == 2
        assert "[google/search]" in result
        assert "[slack/send_message]" in result

    def test_tool_without_provider_uses_key_only(self):
        """Test tool without provider_id uses tool_key only."""
        tools = [
            {
                "tool_key": "my_tool",
                "tool_label": "My Tool",
                "tool_description": "A custom tool",
            }
        ]
        result = format_tools_for_planner(tools)

        # Should format as [my_tool] without provider prefix
        assert "[my_tool]" in result
        assert "My Tool" in result

    def test_tool_with_tool_name_fallback(self):
        """Test tool uses tool_name when tool_key is missing."""
        tools = [
            {
                "tool_name": "fallback_tool",
                "description": "Fallback description",
            }
        ]
        result = format_tools_for_planner(tools)

        assert "fallback_tool" in result
        assert "Fallback description" in result

    def test_tool_with_missing_description(self):
        """Test tool with missing description doesn't crash."""
        tools = [
            {
                "provider_id": "test",
                "tool_key": "tool1",
                "tool_label": "Tool 1",
            }
        ]
        result = format_tools_for_planner(tools)

        assert "[test/tool1]" in result
        assert "Tool 1" in result

    def test_tool_with_all_missing_fields(self):
        """Test tool with all fields missing uses defaults."""
        tools = [{}]
        result = format_tools_for_planner(tools)

        # Should not crash, may produce minimal output
        assert isinstance(result, str)

    def test_tool_uses_provider_fallback(self):
        """Test tool uses 'provider' when 'provider_id' is missing."""
        tools = [
            {
                "provider": "openai",
                "tool_key": "dalle",
                "tool_label": "DALL-E",
                "tool_description": "Generate images",
            }
        ]
        result = format_tools_for_planner(tools)

        assert "[openai/dalle]" in result

    def test_tool_label_fallback_to_key(self):
        """Test tool_label falls back to tool_key when missing."""
        tools = [
            {
                "provider_id": "test",
                "tool_key": "my_key",
                "tool_description": "Description here",
            }
        ]
        result = format_tools_for_planner(tools)

        # Label should fallback to key
        assert "my_key" in result
        assert "Description here" in result


class TestPlannerPromptConstants:
    """Tests for planner prompt constant availability."""

    def test_planner_system_prompt_exists(self):
        """Test PLANNER_SYSTEM_PROMPT is defined."""
        from core.workflow.generator.prompts.planner_prompts import PLANNER_SYSTEM_PROMPT

        assert PLANNER_SYSTEM_PROMPT is not None
        assert len(PLANNER_SYSTEM_PROMPT) > 0
        assert "{tools_summary}" in PLANNER_SYSTEM_PROMPT

    def test_planner_user_prompt_exists(self):
        """Test PLANNER_USER_PROMPT is defined."""
        from core.workflow.generator.prompts.planner_prompts import PLANNER_USER_PROMPT

        assert PLANNER_USER_PROMPT is not None
        assert "{instruction}" in PLANNER_USER_PROMPT

    def test_planner_system_prompt_has_required_sections(self):
        """Test PLANNER_SYSTEM_PROMPT has required XML sections."""
        from core.workflow.generator.prompts.planner_prompts import PLANNER_SYSTEM_PROMPT

        assert "<role>" in PLANNER_SYSTEM_PROMPT
        assert "<task>" in PLANNER_SYSTEM_PROMPT
        assert "<available_tools>" in PLANNER_SYSTEM_PROMPT
        assert "<response_format>" in PLANNER_SYSTEM_PROMPT
