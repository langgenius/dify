from commands.data_migration import _prompt_tool_category, parse_index_selection


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
        auto_values={"weather"},
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
        auto_values={"app-1"},
    )

    assert selected == ["tool-1", "tool-2"]
