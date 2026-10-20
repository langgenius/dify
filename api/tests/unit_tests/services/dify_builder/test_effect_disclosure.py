from copy import deepcopy

from services.dify_builder.effect_disclosure import (
    CONFIRM_FIELD_PREFIX,
    confirm_field_key,
    disclose,
    split_confirmations,
)


def _node(node_id: str, **data):
    return {"id": node_id, "data": {"title": node_id.title(), **data}}


def _tool(node_id: str, tool_name: str, provider_type: str = "builtin", **extra):
    return _node(
        node_id,
        type="tool",
        provider_id=f"langgenius/{node_id}/{node_id}",
        provider_name=f"langgenius/{node_id}/{node_id}",
        provider_type=provider_type,
        tool_name=tool_name,
        tool_label=tool_name,
        tool_parameters=extra.pop("tool_parameters", {}),
        **extra,
    )


GRAPH = {
    "nodes": [
        _node("start", type="start"),
        _node("llm", type="llm", model={"provider": "langgenius/openai/openai", "name": "gpt-4o"}),
        _node("code", type="code"),
        _node("branch", type="if-else"),
        _node("fetch", type="http-request", method="get", url="https://api.example.com/items"),
        _node("hook", type="http-request", method="post", url="https://hooks.example.com/x"),
        _node("purge", type="http-request", method="delete", url="https://api.example.com/items/1"),
        _tool("search", "google_search"),
        _tool(
            "slack",
            "send_message",
            tool_parameters={
                "channel": {"type": "constant", "value": "#general"},
                "text": {"type": "variable", "value": ["llm", "text"]},
                "api_key": {"type": "constant", "value": "secret"},
            },
        ),
        _tool("notion", "deletePage"),
        _tool("mystery", "frobnicate"),
        _tool("child", "child_flow", provider_type="workflow"),
        _node("agent", type="agent"),
        _node("end", type="end"),
    ]
}


def test_tiers_follow_the_prd_mock_and_confirm_rules():
    tiers = {item.node_id: item.tier for item in disclose(GRAPH).items}

    assert tiers == {
        "start": "pure",
        "llm": "read",
        "code": "side_effect",  # Missing prepared assessment is unavailable/Mock.
        "branch": "pure",
        "fetch": "read",
        "hook": "side_effect",
        "purge": "destructive",
        "search": "read",
        "slack": "side_effect",
        "notion": "destructive",
        "mystery": "side_effect",
        "child": "side_effect",
        "agent": "side_effect",
        "end": "pure",
    }


def test_targets_and_objects_name_what_is_touched_without_secrets():
    items = {item.node_id: item for item in disclose(GRAPH, {"slack": "Team bot"}).items}

    assert items["llm"].target == "openai / gpt-4o"
    assert items["hook"].target == "POST hooks.example.com"
    assert items["slack"].target == "slack / send_message"
    assert items["slack"].account == "Team bot"
    assert "channel=#general" in items["slack"].object
    assert "upstream outputs" in items["slack"].object


def test_agent_v2_discloses_selected_binding_and_limits_of_outer_node_risk() -> None:
    graph = {
        "nodes": [
            _node(
                "agent",
                type="agent",
                version="2",
                agent_node_kind="dify_agent",
                agent_binding={
                    "binding_type": "roster_agent",
                    "agent_id": "agent-123",
                    "current_snapshot_id": "snapshot-456",
                },
            )
        ]
    }

    disclosure = disclose(graph)
    item = disclosure.items[0]

    assert item.target == "Agent agent-123 / snapshot snapshot-456"
    assert item.object == (
        "May use its configured model and tools. Nested runtime targets cannot be predicted from this outer node."
    )
    assert item.tier == "side_effect"
    assert disclosure.mocked_node_ids(None) == {"agent"}
    assert disclosure.mocked_node_ids(disclosure.confirmation(["agent"])) == set()


def test_agent_v2_unavailable_binding_is_explicit_without_rendering_other_fields() -> None:
    item = disclose(
        {
            "nodes": [
                _node(
                    "agent",
                    type="agent",
                    version="2",
                    agent_node_kind="dify_agent",
                    agent_binding={"agent_id": {"secret": "must-not-render"}, "current_snapshot_id": None},
                )
            ]
        }
    ).items[0]

    assert item.target == "Dify Agent (binding unavailable)"
    assert "must-not-render" not in item.target + item.object


def test_agent_v2_confirmation_keeps_full_configuration_binding() -> None:
    graph = {
        "nodes": [
            _node(
                "agent",
                type="agent",
                version="2",
                agent_node_kind="dify_agent",
                agent_task="Summarize",
                agent_binding={
                    "binding_type": "roster_agent",
                    "agent_id": "agent-123",
                    "current_snapshot_id": "snapshot-456",
                },
            )
        ]
    }
    confirmation = disclose(graph).confirmation(["agent"])
    changed_snapshot = deepcopy(graph)
    changed_snapshot["nodes"][0]["data"]["agent_binding"]["current_snapshot_id"] = "snapshot-789"
    changed_task = deepcopy(graph)
    changed_task["nodes"][0]["data"]["agent_task"] = "Send summary"

    assert disclose(changed_snapshot).mocked_node_ids(confirmation) == {"agent"}
    assert disclose(changed_task).mocked_node_ids(confirmation) == {"agent"}


def test_legacy_agent_disclosure_keeps_its_model_target() -> None:
    item = disclose(
        {
            "nodes": [
                _node(
                    "agent",
                    type="agent",
                    version="2",
                    model={"provider": "langgenius/openai/openai", "name": "gpt-4o"},
                )
            ]
        }
    ).items[0]

    assert item.target == "openai / gpt-4o"
    assert item.object == ""


def test_default_is_mock_for_every_side_effect_and_destructive_node():
    disclosure = disclose(GRAPH)

    assert disclosure.mocked_node_ids(None) == {"code", "hook", "purge", "slack", "notion", "mystery", "child", "agent"}


def test_confirmation_runs_only_confirmed_side_effects_never_destructive():
    disclosure = disclose(GRAPH)
    confirmation = disclosure.confirmation(["slack", "notion", "llm", "absent"])

    assert set(confirmation) == {"slack"}
    assert disclosure.mocked_node_ids(confirmation) == {"code", "hook", "purge", "notion", "mystery", "child", "agent"}


def test_changing_a_confirmed_target_drops_only_that_confirmation():
    confirmation = disclose(GRAPH).confirmation(["slack", "hook"])
    changed = {
        "nodes": [
            *(node for node in GRAPH["nodes"] if node["id"] not in {"slack", "code"}),
            _tool("slack", "send_message", tool_parameters={"channel": {"type": "constant", "value": "#random"}}),
            _node("code", type="code", code="return {}"),
        ]
    }

    mocked = disclose(changed).mocked_node_ids(confirmation)

    assert "slack" in mocked
    assert "hook" not in mocked


def test_split_confirmations_keeps_inputs_and_true_checkboxes_only():
    inputs, confirmed = split_confirmations(
        {"query": "hi", confirm_field_key("slack"): True, confirm_field_key("hook"): False, "flag": True}
    )

    assert inputs == {"query": "hi", "flag": True}
    assert confirmed == ["slack"]
    assert confirm_field_key("x").startswith(CONFIRM_FIELD_PREFIX)


def test_malformed_graph_has_nothing_to_disclose():
    assert disclose({}).items == ()
    assert disclose({"nodes": [None, {"id": "x"}, {"id": "", "data": {"type": "llm"}}]}).items == ()


def test_changing_http_headers_invalidates_confirmation():
    original = {"nodes": [_node("hook", type="http-request", method="post", url="https://x.io", headers="X-Tenant: a")]}
    changed = {"nodes": [_node("hook", type="http-request", method="post", url="https://x.io", headers="X-Tenant: b")]}

    assert disclose(changed).mocked_node_ids(disclose(original).confirmation(["hook"])) == {"hook"}


def test_changing_tool_runtime_configuration_invalidates_confirmation():
    original = {"nodes": [_tool("slack", "send_message", tool_configurations={"channel": "#ops"})]}
    changed = {"nodes": [_tool("slack", "send_message", tool_configurations={"channel": "#general"})]}

    assert disclose(changed).mocked_node_ids(disclose(original).confirmation(["slack"])) == {"slack"}


def test_changing_resolved_account_invalidates_confirmation_even_if_display_names_match():
    original = disclose(GRAPH, {"slack": "Team bot"}, account_bindings={"slack": "credential-a"})
    changed = disclose(GRAPH, {"slack": "Team bot"}, account_bindings={"slack": "credential-b"})

    assert "slack" in changed.mocked_node_ids(original.confirmation(["slack"]))


def test_direct_start_target_inputs_are_bound_and_displayed():
    graph = {
        "nodes": [
            _node("start", type="start"),
            _node("hook", type="http-request", method="post", url="https://{{#start.host#}}/items"),
            _tool(
                "slack",
                "send_message",
                tool_parameters={"channel": {"type": "variable", "value": ["start", "channel"]}},
            ),
        ]
    }
    original = disclose(graph, inputs={"host": "a.example.com", "channel": "#ops", "query": "one"})
    changed = disclose(graph, inputs={"host": "b.example.com", "channel": "#general", "query": "one"})
    unrelated = disclose(graph, inputs={"host": "a.example.com", "channel": "#ops", "query": "two"})

    assert original.items[1].target == "POST a.example.com"
    assert original.items[2].object == "channel=#ops"
    assert changed.mocked_node_ids(original.confirmation(["hook", "slack"])) == {"hook", "slack"}
    assert unrelated.mocked_node_ids(original.confirmation(["hook", "slack"])) == set()


def test_upstream_config_change_invalidates_dynamic_effect_but_keeps_fixed_target():
    graph = {
        "nodes": [
            _node("start", type="start"),
            _node("code", type="code", code="return {'host': 'a.example.com'}"),
            _node("dynamic", type="http-request", method="post", url="https://{{#code.host#}}/items"),
            _node("fixed", type="http-request", method="post", url="https://fixed.example.com/items"),
        ]
    }
    confirmation = disclose(graph).confirmation(["dynamic", "fixed"])
    changed = deepcopy(graph)
    changed["nodes"][1]["data"]["code"] = "return {'host': 'b.example.com'}"

    assert disclose(changed).mocked_node_ids(confirmation) == {"code", "dynamic"}


def test_dynamic_effect_binds_start_inputs_used_by_its_upstream_node():
    graph = {
        "nodes": [
            _node("start", type="start"),
            _node("code", type="code", variables=[{"variable": "host", "value_selector": ["start", "host"]}]),
            _node("hook", type="http-request", method="post", url="https://{{#code.host#}}/items"),
        ]
    }
    confirmation = disclose(graph, inputs={"host": "a.example.com"}).confirmation(["hook"])

    assert disclose(graph, inputs={"host": "b.example.com"}).mocked_node_ids(confirmation) == {"code", "hook"}


def test_advanced_chat_system_query_is_bound_for_templates_and_variable_selectors():
    graph = {
        "nodes": [
            _node("start", type="start"),
            _node("hook", type="http-request", method="post", url="https://x.io/{{#sys.query#}}"),
            _tool(
                "slack", "send_message", tool_parameters={"channel": {"type": "variable", "value": ["sys", "query"]}}
            ),
        ]
    }
    original = disclose(graph, inputs={"sys.query": "ops"})
    changed = disclose(graph, inputs={"sys.query": "general"})

    assert original.items[1].object == "https://x.io/ops"
    assert original.items[2].object == "channel=ops"
    assert changed.mocked_node_ids(original.confirmation(["hook", "slack"])) == {"hook", "slack"}


def test_changed_environment_or_conversation_binding_invalidates_confirmation_without_showing_values():
    graph = {
        "nodes": [
            _node("hook", type="http-request", method="post", url="https://{{#env.host#}}/{{#conversation.path#}}")
        ]
    }
    original = disclose(graph, scope_binding="digest-before")
    changed = disclose(graph, scope_binding="digest-after")

    assert changed.mocked_node_ids(original.confirmation(["hook"])) == {"hook"}
    assert changed.items[0].config_signature != original.items[0].config_signature
    assert "digest-before" not in str(original.items)
    assert "digest-after" not in str(changed.items)


def test_changing_a_referenced_start_default_invalidates_confirmation():
    graph = {
        "nodes": [
            _node(
                "start",
                type="start",
                variables=[{"variable": "host", "type": "text-input", "default": "a.example.com"}],
            ),
            _node("hook", type="http-request", method="post", url="https://{{#start.host#}}/items"),
        ]
    }
    confirmation = disclose(graph, inputs={}).confirmation(["hook"])
    changed = deepcopy(graph)
    changed["nodes"][0]["data"]["variables"][0]["default"] = "b.example.com"

    assert disclose(changed, inputs={}).mocked_node_ids(confirmation) == {"hook"}


def test_nested_start_object_selectors_bind_the_root_input_and_show_nested_values():
    graph = {
        "nodes": [
            _node("start", type="start"),
            _node("hook", type="http-request", method="post", url="https://{{#start.payload.host#}}/items"),
            _tool(
                "slack",
                "send_message",
                tool_parameters={"channel": {"type": "variable", "value": ["start", "payload", "channel"]}},
            ),
        ]
    }
    original = disclose(graph, inputs={"payload": {"host": "a.example.com", "channel": "#ops"}})
    changed = disclose(graph, inputs={"payload": {"host": "b.example.com", "channel": "#general"}})

    assert original.items[1].target == "POST a.example.com"
    assert original.items[2].object == "channel=#ops"
    assert changed.mocked_node_ids(original.confirmation(["hook", "slack"])) == {"hook", "slack"}


def test_nested_start_selector_binds_changed_optional_object_defaults():
    graph = {
        "nodes": [
            _node(
                "start",
                type="start",
                variables=[{"variable": "payload", "type": "json_object", "default": {"host": "a.example.com"}}],
            ),
            _node("hook", type="http-request", method="post", url="https://{{#start.payload.host#}}/items"),
        ]
    }
    confirmation = disclose(graph, inputs={}).confirmation(["hook"])
    changed = deepcopy(graph)
    changed["nodes"][0]["data"]["variables"][0]["default"]["host"] = "b.example.com"

    assert disclose(changed, inputs={}).mocked_node_ids(confirmation) == {"hook"}
