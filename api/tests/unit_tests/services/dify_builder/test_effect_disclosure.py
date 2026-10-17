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
        "code": "sandboxed",
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
    assert items["slack"].object == "channel=#general"


def test_default_is_mock_for_every_side_effect_and_destructive_node():
    disclosure = disclose(GRAPH)

    assert disclosure.mocked_node_ids(None) == {"hook", "purge", "slack", "notion", "mystery", "child", "agent"}


def test_confirmation_runs_only_confirmed_side_effects_never_destructive():
    disclosure = disclose(GRAPH)
    confirmation = disclosure.confirmation(["slack", "notion", "llm", "absent"])

    assert set(confirmation) == {"slack"}
    assert disclosure.mocked_node_ids(confirmation) == {"hook", "purge", "notion", "mystery", "child", "agent"}


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
