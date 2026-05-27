from commands.data_migration import (
    _confirm_wizard_summary,
    _print_auto_tools,
    _print_final_tool_selection,
    _print_wizard_step,
    _prompt_additional_tools,
    _prompt_output_file,
    _prompt_tool_category,
    _resolve_mcp_tool_names,
    parse_index_selection,
)


def test_parse_index_selection_supports_all():
    assert parse_index_selection("all", ["a", "b", "c"]) == ["a", "b", "c"]


def test_parse_index_selection_supports_comma_indexes():
    assert parse_index_selection("1, 3", ["a", "b", "c"]) == ["a", "c"]


def test_print_wizard_step_adds_separator(monkeypatch):
    output_lines = []

    monkeypatch.setattr("commands.data_migration.click.echo", output_lines.append)

    _print_wizard_step("App Selection")

    assert output_lines == ["", "==== App Selection ===="]


def test_prompt_app_ids_explains_comma_selection_and_default(monkeypatch):
    from commands.data_migration import _prompt_app_ids

    prompts = []
    output_lines = []
    apps = [
        type("App", (), {"id": "app-1", "name": "embedded", "mode": "workflow"})(),
        type("App", (), {"id": "app-2", "name": "main", "mode": "advanced-chat"})(),
    ]

    def capture_prompt(text, **kwargs):
        prompts.append((text, kwargs))
        return "1,2"

    monkeypatch.setattr("commands.data_migration.click.echo", output_lines.append)
    monkeypatch.setattr("commands.data_migration.click.prompt", capture_prompt)

    assert _prompt_app_ids(apps) == ["app-1", "app-2"]
    assert prompts == [("Select apps by number, comma-separated numbers, or all", {"default": "all"})]


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
    assert output_lines[:2] == ["", "==== Custom API tools ===="]


def test_prompt_tool_category_explains_comma_selection_and_default(monkeypatch):
    prompts = []

    def capture_prompt(text, **kwargs):
        prompts.append((text, kwargs))
        return ""

    monkeypatch.setattr("commands.data_migration.click.echo", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("commands.data_migration.click.prompt", capture_prompt)

    selected = _prompt_tool_category(
        "Custom API tools",
        [("weather", "weather", "tool-id")],
        auto_tools={},
    )

    assert selected == []
    assert prompts == [
        (
            "Select custom api tools by number, comma-separated numbers, all, or empty",
            {"default": "", "show_default": "empty"},
        )
    ]


def test_prompt_output_file_shows_default(monkeypatch):
    prompts = []

    def capture_prompt(text, **kwargs):
        prompts.append((text, kwargs))
        return "migration-data.json"

    monkeypatch.setattr("commands.data_migration.click.prompt", capture_prompt)

    assert _prompt_output_file() == ("migration-data.json", False)
    assert prompts[0][0] == "Output path"
    assert prompts[0][1]["show_default"] is True


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


def test_resolve_mcp_tool_names_does_not_compare_non_uuid_identifier_to_uuid_id(monkeypatch):
    statements = []

    def capture_scalar(statement):
        statements.append(str(statement))

    monkeypatch.setattr("commands.data_migration.db.session.scalar", capture_scalar)

    assert _resolve_mcp_tool_names("49a99e46-bc2c-4885-91fa-47615f6192b5", {"my-test-mcp": "my-test-mcp"}) == {
        "my-test-mcp": "my-test-mcp"
    }
    assert "tool_mcp_providers.id =" not in statements[0]
    assert "tool_mcp_providers.server_identifier =" in statements[0]


def test_prompt_additional_tools_prints_final_selection_when_skipped(monkeypatch):
    output_lines = []
    confirm_prompts = []

    def capture_confirm(prompt, **kwargs):
        confirm_prompts.append((prompt, kwargs))
        return False

    monkeypatch.setattr("commands.data_migration.click.confirm", capture_confirm)
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
    assert confirm_prompts == [
        ("Export additional tools manually? Enter y or n. Default: no", {"default": False, "show_default": True})
    ]
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


def test_confirm_wizard_summary_shows_conflict_strategy(monkeypatch):
    output_lines = []
    confirm_prompts = []

    monkeypatch.setattr("commands.data_migration.click.echo", output_lines.append)
    monkeypatch.setattr(
        "commands.data_migration.click.confirm",
        lambda prompt, **kwargs: confirm_prompts.append((prompt, kwargs)) or True,
    )

    _confirm_wizard_summary(
        tenant_name="admin's Workspace",
        app_names=["main_chatflow"],
        additional_tools={"api_tools": [], "workflow_tools": [], "mcp_tools": []},
        include_referenced_tools=True,
        include_secrets=False,
        create_tokens=True,
        conflict_strategy="fail",
        output_file="migration-data.json",
    )

    assert "conflict strategy: fail" in output_lines
    assert confirm_prompts == [
        ("Write migration package? Enter y or n. Default: yes", {"default": True, "show_default": True})
    ]
