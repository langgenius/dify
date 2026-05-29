"""Unit tests for the tool catalogue helpers."""

from core.workflow.generator.tool_catalogue import ToolCatalogueEntry, format_tool_catalogue


def _entry(provider: str, tool: str, *, label: str = "", description: str = "") -> ToolCatalogueEntry:
    return ToolCatalogueEntry(
        provider_name=provider,
        provider_type="builtin",
        plugin_id="",
        tool_name=tool,
        tool_label=label,
        description=description,
    )


class TestFormatToolCatalogue:
    def test_empty_input_returns_empty_string(self):
        assert format_tool_catalogue([]) == ""

    def test_renders_provider_slash_tool_per_line(self):
        out = format_tool_catalogue(
            [
                _entry("google", "search", description="Search the web with Google."),
                _entry("time", "current_time", description="Return the current time."),
            ]
        )
        lines = out.split("\n")
        assert lines == [
            "- google/search — Search the web with Google.",
            "- time/current_time — Return the current time.",
        ]

    def test_includes_label_when_different_from_tool_name(self):
        out = format_tool_catalogue(
            [
                _entry("google", "search", label="Google Search", description="Search."),
            ]
        )
        assert out == "- google/search (Google Search) — Search."

    def test_omits_label_when_identical_to_tool_name(self):
        out = format_tool_catalogue(
            [
                _entry("time", "current_time", label="current_time", description="Now."),
            ]
        )
        assert out == "- time/current_time — Now."

    def test_truncates_long_descriptions(self):
        long_desc = "x" * 200
        out = format_tool_catalogue([_entry("p", "t", description=long_desc)])
        # Truncated to 117 chars + "..."
        assert out.endswith("...")
        assert len(out.split(" — ", 1)[1]) == 120

    def test_strips_newlines_from_descriptions(self):
        out = format_tool_catalogue([_entry("p", "t", description="line1\nline2\nline3")])
        assert "\n" not in out.split(" — ", 1)[1]
        assert "line1 line2 line3" in out
