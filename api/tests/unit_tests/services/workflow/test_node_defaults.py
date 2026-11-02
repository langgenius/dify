from services.workflow.node_defaults import fill_graph, fill_node_data


def test_start_gets_empty_variables() -> None:
    assert fill_node_data({"type": "start", "title": "Start"})["variables"] == []


def test_http_body_gets_data() -> None:
    assert fill_node_data({"type": "http-request", "body": {"type": "json"}})["body"]["data"] == []
    assert fill_node_data({"type": "http-request"})["body"] == {"type": "none", "data": []}


def test_tool_gets_empty_parameter_maps() -> None:
    data = fill_node_data({"type": "tool"})
    assert (data["tool_parameters"], data["tool_configurations"]) == ({}, {})


def test_existing_values_win() -> None:
    data = fill_node_data({"type": "start", "variables": [{"variable": "q"}]})
    assert data["variables"] == [{"variable": "q"}]
    assert fill_node_data({"type": "end", "outputs": []})["outputs"] == []


def test_nothing_is_invented_for_required_choices() -> None:
    data = fill_node_data({"type": "llm"})
    assert "model" not in data
    assert "classes" not in fill_node_data({"type": "question-classifier"})


def test_unknown_type_passes_through() -> None:
    assert fill_node_data({"type": "future-node", "x": 1}) == {"type": "future-node", "x": 1}


def test_fill_graph_touches_every_node_and_keeps_edges() -> None:
    graph = {"nodes": [{"id": "s", "data": {"type": "start"}}], "edges": [{"id": "e"}]}
    filled = fill_graph(graph)
    assert filled["nodes"][0]["data"]["variables"] == []
    assert filled["edges"] == [{"id": "e"}]
    assert "variables" not in graph["nodes"][0]["data"]


def test_fill_graph_tolerates_bad_shapes() -> None:
    assert fill_graph({"nodes": "x"}) == {"nodes": "x"}
    assert fill_graph({"nodes": [{"id": "n"}]}) == {"nodes": [{"id": "n"}]}


_CONDITION = {"variable_selector": ["start", "q"], "comparison_operator": "is", "value": "x"}


def test_legacy_if_else_conditions_become_the_true_case() -> None:
    data = fill_node_data({"type": "if-else", "logical_operator": "or", "conditions": [_CONDITION]})
    assert data["cases"] == [{"case_id": "true", "logical_operator": "or", "conditions": [_CONDITION]}]
    assert data["conditions"] == [_CONDITION]


def test_legacy_if_else_without_operator_uses_and() -> None:
    data = fill_node_data({"type": "if-else", "conditions": [_CONDITION]})
    assert data["cases"][0]["logical_operator"] == "and"


def test_explicit_if_else_cases_are_untouched() -> None:
    cases = [{"case_id": "c1", "logical_operator": "and", "conditions": [_CONDITION]}]
    data = fill_node_data({"type": "if-else", "cases": cases, "conditions": [_CONDITION]})
    assert data["cases"] == cases


def test_if_else_without_cases_or_conditions_gets_no_cases() -> None:
    assert fill_node_data({"type": "if-else"})["cases"] == []


# A validator that reads a field which failed validation raises KeyError, not ValidationError.
_UNKNOWN_AUTH: dict[str, object] = {"type": "oauth2", "config": {"type": "basic", "api_key": "k"}}


def _http(authorization: dict[str, object]) -> dict[str, object]:
    return {"type": "http-request", "title": "H", "method": "get", "url": "https://x", "authorization": authorization}


def test_unexpected_validator_error_leaves_the_value_unchanged() -> None:
    data = fill_node_data(_http(_UNKNOWN_AUTH))
    assert data["authorization"] == _UNKNOWN_AUTH
    filled = fill_graph({"nodes": [{"id": "h", "data": _http(_UNKNOWN_AUTH)}]})
    assert filled["nodes"][0]["data"]["authorization"] == _UNKNOWN_AUTH


def test_list_items_get_their_model_defaults() -> None:
    variable = {"variable": "q", "label": "Q", "type": "text-input"}
    data = fill_node_data({"type": "start", "variables": [variable, "not-a-mapping"]})
    filled, kept = data["variables"]
    assert (filled["required"], filled["options"]) == (False, [])
    assert {k: filled[k] for k in variable} == variable
    assert kept == "not-a-mapping"


def test_mapping_typed_fields_are_not_filled_as_their_value_model() -> None:
    outputs = {"type": "string"}
    assert fill_node_data({"type": "code", "outputs": outputs})["outputs"] == outputs
    tool_parameters = {"q": {"type": "mixed", "value": "x"}}
    assert fill_node_data({"type": "tool", "tool_parameters": tool_parameters})["tool_parameters"] == tool_parameters
    datasource_parameters = {"q": {"type": "mixed", "value": "x"}}
    data = fill_node_data({"type": "datasource", "datasource_parameters": datasource_parameters})
    assert data["datasource_parameters"] == datasource_parameters
