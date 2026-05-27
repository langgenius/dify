from commands.data_migration import (
    _print_auto_tools,
    _print_final_tool_selection,
    _prompt_additional_tools,
    _prompt_output_file,
    _prompt_tool_category,
    parse_index_selection,
)


def test_parse_index_selection_supports_all():
    assert parse_index_selection("all", ["a", "b", "c"]) == ["a", "b", "c"]


def test_parse_index_selection_supports_comma_indexes():
    assert parse_index_selection("1, 3", ["a", "b", "c"]) == ["a", "c"]


def test_prompt_tool_category_marks_auto_discovered_tools(monkeypatch):
    output_lines = []

    monkeypatch.setattr("commands.data_migration.click.echo", output_lines.append)
    monkeypatch.setattr("commands.data_migration.click.prompt", lambda *args, **kwargs: "")

    selected = _prompt_tool_category(
        "Custom API tools",
        [("weather", "weather", "tool-id"), ("calendar", "calendar", "calendar-id")],
        auto_tools={"weather": "tool-id"},
    )

    assert selected == []
    assert "1. [auto] weather (tool-id)" in output_lines
    assert "2. [ ] calendar (calendar-id)" in output_lines


def test_prompt_tool_category_marks_auto_by_detail_and_supports_multi_select(monkeypatch):
    monkeypatch.setattr("commands.data_migration.click.echo", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("commands.data_migration.click.prompt", lambda *args, **kwargs: "1,2")

    selected = _prompt_tool_category(
        "Workflow tools",
        [("tool-1", "embedded", "app-1"), ("tool-2", "other", "app-2")],
        auto_tools={"embedded": "app-1"},
    )

    assert selected == ["tool-1", "tool-2"]


def test_prompt_tool_category_marks_auto_by_value():
    output_lines = []

    from commands import data_migration

    original_echo = data_migration.click.echo
    original_prompt = data_migration.click.prompt
    data_migration.click.echo = output_lines.append
    data_migration.click.prompt = lambda *args, **kwargs: ""
    try:
        _prompt_tool_category(
            "Workflow tools",
            [("tool-1", "embedded_workflow_as_tool", "tool-1")],
            auto_tools={"embedded_workflow_as_tool": "tool-1"},
        )
    finally:
        data_migration.click.echo = original_echo
        data_migration.click.prompt = original_prompt

    assert "1. [auto] embedded_workflow_as_tool (tool-1)" in output_lines


def test_print_auto_tools_lists_each_category(monkeypatch):
    output_lines = []

    monkeypatch.setattr("commands.data_migration.click.echo", output_lines.append)

    _print_auto_tools(
        {
            "api_tools": {"weather": "3bac3aa9-dd87-4351-9459-a7099137b028"},
            "workflow_tools": {"embedded_workflow_as_tool": "e6024578-41b7-4fb5-a81f-9201358e5835"},
            "mcp_tools": {},
        }
    )

    assert "Automatically discovered tools:" in output_lines
    assert "Custom API tools" in output_lines
    assert "- weather: 3bac3aa9-dd87-4351-9459-a7099137b028" in output_lines
    assert "Workflow tools" in output_lines
    assert "- embedded_workflow_as_tool: e6024578-41b7-4fb5-a81f-9201358e5835" in output_lines
    assert "MCP tools" in output_lines
    assert "- none" in output_lines


def test_prompt_additional_tools_prints_final_selection_when_skipped(monkeypatch):
    output_lines = []

    monkeypatch.setattr("commands.data_migration.click.confirm", lambda *args, **kwargs: False)
    monkeypatch.setattr("commands.data_migration.click.echo", output_lines.append)

    selected = _prompt_additional_tools(
        "tenant-id",
        {
            "api_tools": {"weather": "3bac3aa9-dd87-4351-9459-a7099137b028"},
            "workflow_tools": {},
            "mcp_tools": {},
        },
    )

    assert selected == {"api_tools": [], "workflow_tools": [], "mcp_tools": []}
    assert "Final tools to export:" in output_lines
    assert "- [auto] weather: 3bac3aa9-dd87-4351-9459-a7099137b028" in output_lines


def test_final_tool_selection_deduplicates_manual_tool_already_auto(monkeypatch):
    output_lines = []

    monkeypatch.setattr("commands.data_migration.click.echo", output_lines.append)

    _print_final_tool_selection(
        {
            "api_tools": {},
            "workflow_tools": {"embedded_workflow_as_tool": "e6024578-41b7-4fb5-a81f-9201358e5835"},
            "mcp_tools": {},
        },
        {
            "api_tools": [],
            "workflow_tools": ["e6024578-41b7-4fb5-a81f-9201358e5835"],
            "mcp_tools": [],
        },
        {"e6024578-41b7-4fb5-a81f-9201358e5835": "embedded_workflow_as_tool: e6024578"},
    )

    assert "- [auto] embedded_workflow_as_tool: e6024578-41b7-4fb5-a81f-9201358e5835" in output_lines
    assert not any(line.startswith("- [manual]") for line in output_lines)


def test_prompt_output_file_rejects_yes_no_typo(monkeypatch):
    import click
    import pytest

    monkeypatch.setattr("commands.data_migration.click.prompt", lambda *args, **kwargs: "y")

    with pytest.raises(click.ClickException, match="Output path must be a file path"):
        _prompt_output_file()
