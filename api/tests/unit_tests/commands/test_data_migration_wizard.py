from commands.data_migration import (
    CONFLICT_STRATEGY_CHOICES,
    ID_STRATEGY_CHOICES,
    _confirm_wizard_summary,
    _print_auto_tools,
    _print_final_tool_selection,
    _print_wizard_step,
    _prompt_additional_tools,
    _prompt_output_file,
    _prompt_tool_category,
    _resolve_mcp_tool_names,
    migration_data_wizard,
    parse_index_selection,
)


def test_parse_index_selection_supports_all():
    assert parse_index_selection("all", ["a", "b", "c"]) == ["a", "b", "c"]


def test_wizard_command_uses_app_migration_name():
    assert migration_data_wizard.name == "app-migration-wizard"


def test_parse_index_selection_supports_comma_indexes():
    assert parse_index_selection("1, 3", ["a", "b", "c"]) == ["a", "c"]


def test_print_wizard_step_adds_separator(monkeypatch):
    output_lines = []

    monkeypatch.setattr("commands.data_migration.click.echo", output_lines.append)

    _print_wizard_step("App Selection")

    assert output_lines == ["", "==== App Selection ===="]


def test_conflict_strategy_choices_exclude_replace():
    assert CONFLICT_STRATEGY_CHOICES == ["fail", "skip", "update"]


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
    assert "Currently supported app types: workflow and chatflow." in output_lines


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
        ("Export additional tools manually? [y/n, default: n]", {"default": False, "show_default": False})
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
        auto_tools={"api_tools": {}, "workflow_tools": {}, "mcp_tools": {}},
        additional_tools={"api_tools": [], "workflow_tools": [], "mcp_tools": []},
        manual_labels={},
        include_referenced_tools=True,
        include_secrets=False,
        create_tokens=True,
        id_strategy="preserve-id",
        conflict_strategy="fail",
        output_file="migration-data.json",
    )

    assert "id strategy: preserve-id" in output_lines
    assert "conflict strategy: fail" in output_lines
    assert confirm_prompts == [("Write migration package? [y/n, default: y]", {"default": True, "show_default": False})]


def test_confirm_wizard_summary_shows_final_deduplicated_tool_selection(monkeypatch):
    output_lines = []

    monkeypatch.setattr("commands.data_migration.click.echo", output_lines.append)
    monkeypatch.setattr("commands.data_migration.click.confirm", lambda *args, **kwargs: True)

    _confirm_wizard_summary(
        tenant_name="admin's Workspace",
        app_names=["main_chatflow"],
        auto_tools={
            "api_tools": {"weather": "weather-id"},
            "workflow_tools": {"embedded_workflow_as_tool": "workflow-tool-id"},
            "mcp_tools": {},
        },
        additional_tools={
            "api_tools": ["weather-id", "calendar"],
            "workflow_tools": [],
            "mcp_tools": ["mcp-id"],
        },
        manual_labels={
            "calendar": "calendar: calendar-id",
            "mcp-id": "my-test-mcp: mcp-id",
        },
        include_referenced_tools=True,
        include_secrets=False,
        create_tokens=False,
        id_strategy="preserve-id",
        conflict_strategy="update",
        output_file="migration-data.json",
    )

    assert "Final tools to export:" in output_lines
    assert "Custom API tools" in output_lines
    assert "- [auto] weather: weather-id" in output_lines
    assert "- [manual] calendar: calendar-id" in output_lines
    assert "Workflow tools" in output_lines
    assert "- [auto] embedded_workflow_as_tool: workflow-tool-id" in output_lines
    assert "MCP tools" in output_lines
    assert "- [manual] my-test-mcp: mcp-id" in output_lines
    assert not any(line.startswith("additional api tools:") for line in output_lines)
    assert not any(line.startswith("additional workflow tools:") for line in output_lines)
    assert not any(line.startswith("additional mcp tools:") for line in output_lines)
    assert "- [manual] weather-id" not in output_lines


def test_import_options_prompts_explain_secrets_reuse_and_conflicts(monkeypatch):
    from commands.data_migration import _prompt_import_options

    output_lines = []
    confirm_prompts = []
    prompt_calls = []

    def capture_confirm(prompt, **kwargs):
        confirm_prompts.append((prompt, kwargs))
        return False

    def capture_prompt(prompt, **kwargs):
        prompt_calls.append((prompt, kwargs))
        return kwargs["default"]

    monkeypatch.setattr("commands.data_migration.click.echo", output_lines.append)
    monkeypatch.setattr("commands.data_migration.click.confirm", capture_confirm)
    monkeypatch.setattr("commands.data_migration.click.prompt", capture_prompt)

    include_secrets, create_tokens, id_strategy, conflict_strategy = _prompt_import_options()

    assert include_secrets is False
    assert create_tokens is False
    assert id_strategy == "preserve-id"
    assert conflict_strategy == "update"
    assert "Secrets include workflow/app DSL secret values, custom API tool credentials," in output_lines
    assert "-- Secrets --" in output_lines
    assert "If you choose no, credentials are omitted or masked," in output_lines
    assert "-- App API Tokens --" in output_lines
    assert "When enabled, import will create an app API token if the imported app has none," in output_lines
    assert "or reuse an existing app API token if one already exists." in output_lines
    assert "-- ID Strategy --" in output_lines
    assert "ID strategy controls whether imported app and tool IDs preserve source IDs" in output_lines
    assert "or use target-generated IDs." in output_lines
    assert "preserve-id: keep source IDs where the target service supports it." in output_lines
    assert (
        "generate-new-id: let the target environment generate new IDs and rewrite references via mapping."
        in output_lines
    )
    assert "-- Conflict Strategy --" in output_lines
    assert "Conflict strategy controls what import does when a target resource already exists." in output_lines
    assert "fail: stop at the first conflict; previously committed resources are not rolled back." in output_lines
    assert "skip: keep the existing target resource and skip importing that resource." in output_lines
    assert "update: update the existing target resource in place." in output_lines
    assert confirm_prompts == [
        ("Include secrets in output JSON? [y/n, default: n]", {"default": False, "show_default": False}),
        ("Create or reuse app API tokens during import? [y/n, default: n]", {"default": False, "show_default": False}),
    ]
    assert prompt_calls[0][0] == "Import ID strategy. Enter one of: preserve-id, generate-new-id"
    assert prompt_calls[0][1]["default"] == "preserve-id"
    assert prompt_calls[0][1]["show_default"] is True
    assert prompt_calls[0][1]["type"].choices == ID_STRATEGY_CHOICES
    assert prompt_calls[1][0] == "Import conflict strategy. Enter one of: fail, skip, update"
    assert prompt_calls[1][1]["default"] == "update"
    assert prompt_calls[1][1]["show_default"] is True
    assert prompt_calls[1][1]["type"].choices == CONFLICT_STRATEGY_CHOICES
