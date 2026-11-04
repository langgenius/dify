"""Unit tests for core.agent.tool_configuration.

Covers ``mask_agent_tool_parameters``: it returns a response copy where every
agent tool's ``tool_parameters`` are masked through the tool runtime, and it
never mutates the caller's ``agent_mode`` mapping. The tool runtime and the
parameter configuration manager are mocked so the tests pin the masking and
error-handling branches without touching plugin storage.
"""

from unittest.mock import MagicMock, patch

from core.agent.tool_configuration import mask_agent_tool_parameters


def _tool(**overrides: object) -> dict[str, object]:
    tool: dict[str, object] = {"provider_type": "builtin", "provider_id": "provider", "tool_name": "search"}
    tool.update(overrides)
    return tool


def test_returns_copy_without_tools() -> None:
    agent_mode: dict[str, object] = {"model": "gpt"}

    result = mask_agent_tool_parameters(agent_mode=agent_mode, app_id="app", tenant_id="tenant", user_id="user")

    assert result == {"model": "gpt"}
    assert result is not agent_mode


def test_skips_tools_without_parameters() -> None:
    # A minimal three-field tool has no tool_parameters and is left untouched.
    agent_mode: dict[str, object] = {"tools": [_tool()]}

    with (
        patch("core.agent.tool_configuration.ToolManager") as tool_manager,
        patch("core.agent.tool_configuration.ToolParameterConfigurationManager") as manager_cls,
    ):
        result = mask_agent_tool_parameters(agent_mode=agent_mode, app_id="app", tenant_id="tenant", user_id="user")

        tool_manager.get_agent_tool_runtime.assert_not_called()
        manager_cls.assert_not_called()
    assert result["tools"] == [_tool()]


def test_skips_non_mapping_tool_entries() -> None:
    agent_mode: dict[str, object] = {"tools": ["not-a-tool", 42, None]}

    result = mask_agent_tool_parameters(agent_mode=agent_mode, app_id="app", tenant_id="tenant", user_id="user")

    assert result["tools"] == ["not-a-tool", 42, None]


def test_masks_parameters_for_a_valid_tool() -> None:
    agent_mode: dict[str, object] = {"tools": [_tool(tool_parameters={"api_key": "secret", "query": "hello"})]}

    with (
        patch("core.agent.tool_configuration.ToolManager") as tool_manager,
        patch("core.agent.tool_configuration.ToolParameterConfigurationManager") as manager_cls,
    ):
        manager = manager_cls.return_value
        manager.decrypt_tool_parameters.return_value = {"api_key": "secret", "query": "hello"}
        manager.mask_tool_parameters.return_value = {"api_key": "****", "query": "hello"}

        result = mask_agent_tool_parameters(agent_mode=agent_mode, app_id="app", tenant_id="tenant", user_id="user")

        tool_manager.get_agent_tool_runtime.assert_called_once()
        manager_cls.assert_called_once()
    assert result["tools"][0]["tool_parameters"] == {"api_key": "****", "query": "hello"}
    # The caller's mapping is never mutated.
    assert agent_mode["tools"][0]["tool_parameters"] == {"api_key": "secret", "query": "hello"}


def test_clears_parameters_for_an_invalid_tool_entity() -> None:
    # provider_type is required, so validation fails and the tool is skipped.
    invalid_tool = {"provider_id": "provider", "tool_name": "search", "tool_parameters": {"api_key": "secret"}}
    agent_mode: dict[str, object] = {"tools": [invalid_tool]}

    with patch("core.agent.tool_configuration.ToolManager") as tool_manager:
        result = mask_agent_tool_parameters(agent_mode=agent_mode, app_id="app", tenant_id="tenant", user_id="user")
        tool_manager.get_agent_tool_runtime.assert_not_called()
    assert result["tools"][0]["tool_parameters"] == {}


def test_clears_parameters_when_runtime_lookup_fails() -> None:
    agent_mode: dict[str, object] = {"tools": [_tool(tool_parameters={"api_key": "secret"})]}

    with patch("core.agent.tool_configuration.ToolManager") as tool_manager:
        tool_manager.get_agent_tool_runtime.side_effect = RuntimeError("boom")

        result = mask_agent_tool_parameters(agent_mode=agent_mode, app_id="app", tenant_id="tenant", user_id="user")

    assert result["tools"][0]["tool_parameters"] == {}


def test_sets_empty_parameters_when_tool_has_no_configured_values() -> None:
    # An entity that validates but carries no tool_parameters maps to an empty dict.
    agent_mode: dict[str, object] = {"tools": [_tool(tool_parameters={})]}

    with (
        patch("core.agent.tool_configuration.ToolManager") as tool_manager,
        patch("core.agent.tool_configuration.ToolParameterConfigurationManager"),
    ):
        result = mask_agent_tool_parameters(agent_mode=agent_mode, app_id="app", tenant_id="tenant", user_id="user")

        tool_manager.get_agent_tool_runtime.assert_called_once()
    assert result["tools"][0]["tool_parameters"] == {}


def test_does_not_mutate_the_source_mapping() -> None:
    source = {"tools": [_tool(tool_parameters={"api_key": "secret", "query": "hello"})]}

    with (
        patch("core.agent.tool_configuration.ToolManager") as tool_manager,
        patch("core.agent.tool_configuration.ToolParameterConfigurationManager") as manager_cls,
    ):
        manager_cls.return_value.decrypt_tool_parameters.return_value = {"api_key": "secret", "query": "hello"}
        manager_cls.return_value.mask_tool_parameters.return_value = {"api_key": "****", "query": "hello"}
        tool_manager.get_agent_tool_runtime.return_value = MagicMock()

        mask_agent_tool_parameters(agent_mode=source, app_id="app", tenant_id="tenant", user_id="user")

    assert source["tools"][0]["tool_parameters"] == {"api_key": "secret", "query": "hello"}
