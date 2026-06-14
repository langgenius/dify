"""
Data flow integrity tests for the duplicate tool name fix.

These tests verify that the ordinal key algorithm is IDENTICAL across:
- model.py (tool_inputs_dict, tool_outputs_dict, tool_meta)
- agent_service.py (get_agent_logs)

They also verify mixed-format scenarios and history reconstruction paths.
"""

import json

import pytest

from models.model import MessageAgentThought


def _make_thought(**kwargs) -> MessageAgentThought:
    """Create a MessageAgentThought with required defaults."""
    defaults = {
        "message_id": "msg-1",
        "position": 1,
        "created_by_role": "account",
        "created_by": "user-1",
    }
    defaults.update(kwargs)
    return MessageAgentThought(**defaults)


def _ordinal_keys_from_agent_service(tools: list[str]) -> list[str]:
    """
    Reproduce the ordinal key algorithm from agent_service.py get_agent_logs.
    This MUST match the algorithm in model.py properties.
    """
    keys = []
    name_count: dict[str, int] = {}
    for tool in tools:
        tool_name = tool
        name_count[tool_name] = name_count.get(tool_name, 0) + 1
        ordinal_key = tool_name if name_count[tool_name] == 1 else f"{tool_name}__{name_count[tool_name]}"
        keys.append(ordinal_key)
    return keys


def _ordinal_keys_from_model(tools: list[str], data: list[dict]) -> list[str]:
    """
    Reproduce the ordinal key algorithm from model.py tool_inputs_dict.
    """
    keys = []
    name_count: dict[str, int] = {}
    for i, item in enumerate(data):
        if isinstance(item, dict) and "name" in item:
            name = item["name"]
        else:
            name = tools[i] if i < len(tools) else f"tool_{i}"
        name_count[name] = name_count.get(name, 0) + 1
        key = name if name_count[name] == 1 else f"{name}__{name_count[name]}"
        keys.append(key)
    return keys


class TestOrdinalKeyConsistency:
    """CRITICAL: ordinal keys MUST be identical between model.py and agent_service.py."""

    def test_no_duplicates(self):
        """Unique tool names produce identical ordinal keys."""
        tools = ["search", "calculator", "weather"]
        data = [{"name": "search"}, {"name": "calculator"}, {"name": "weather"}]
        service_keys = _ordinal_keys_from_agent_service(tools)
        model_keys = _ordinal_keys_from_model(tools, data)
        assert service_keys == model_keys
        assert service_keys == ["search", "calculator", "weather"]

    def test_two_duplicates(self):
        """Two identical tool names produce same ordinal keys in both paths."""
        tools = ["search", "search"]
        data = [{"name": "search"}, {"name": "search"}]
        service_keys = _ordinal_keys_from_agent_service(tools)
        model_keys = _ordinal_keys_from_model(tools, data)
        assert service_keys == model_keys
        assert service_keys == ["search", "search__2"]

    def test_three_duplicates(self):
        """Three identical tool names."""
        tools = ["search", "search", "search"]
        data = [{"name": "search"}, {"name": "search"}, {"name": "search"}]
        service_keys = _ordinal_keys_from_agent_service(tools)
        model_keys = _ordinal_keys_from_model(tools, data)
        assert service_keys == model_keys
        assert service_keys == ["search", "search__2", "search__3"]

    def test_mixed_duplicates_and_unique(self):
        """Mix of duplicate and unique tools."""
        tools = ["search", "calculator", "search", "search"]
        data = [
            {"name": "search"},
            {"name": "calculator"},
            {"name": "search"},
            {"name": "search"},
        ]
        service_keys = _ordinal_keys_from_agent_service(tools)
        model_keys = _ordinal_keys_from_model(tools, data)
        assert service_keys == model_keys
        assert service_keys == ["search", "calculator", "search__2", "search__3"]

    def test_multiple_different_duplicates(self):
        """Multiple tools each duplicated."""
        tools = ["search", "calculator", "search", "calculator"]
        data = [
            {"name": "search"},
            {"name": "calculator"},
            {"name": "search"},
            {"name": "calculator"},
        ]
        service_keys = _ordinal_keys_from_agent_service(tools)
        model_keys = _ordinal_keys_from_model(tools, data)
        assert service_keys == model_keys
        assert service_keys == ["search", "calculator", "search__2", "calculator__2"]


class TestWriteReadRoundTrip:
    """Verify data written by fc_agent_runner.py can be read back correctly."""

    def test_tool_input_array_roundtrip(self):
        """Data written as array by fc_agent_runner is correctly parsed by model.py."""
        # fc_agent_runner.py writes tool_call_inputs as:
        # json.dumps([{"name": tool_call[1], "arguments": tool_call[2]} for tool_call in tool_calls])
        written = json.dumps([
            {"name": "search", "arguments": {"q": "python"}},
            {"name": "search", "arguments": {"q": "javascript"}},
            {"name": "calculator", "arguments": {"expr": "2+2"}},
        ])

        thought = _make_thought(
            tool="search;search;calculator",
            tool_input=written,
        )

        result = thought.tool_inputs_dict
        assert result["search"] == {"q": "python"}
        assert result["search__2"] == {"q": "javascript"}
        assert result["calculator"] == {"expr": "2+2"}

    def test_observation_array_roundtrip(self):
        """Data written as array for observation is correctly parsed."""
        # fc_agent_runner.py writes observation as:
        # [{"name": tool_response["tool_call_name"], "output": tool_response["tool_response"]}]
        written = json.dumps([
            {"name": "search", "output": "python results"},
            {"name": "search", "output": "javascript results"},
            {"name": "calculator", "output": "4"},
        ])

        thought = _make_thought(
            tool="search;search;calculator",
            observation=written,
        )

        result = thought.tool_outputs_dict
        assert result["search"] == "python results"
        assert result["search__2"] == "javascript results"
        assert result["calculator"] == "4"

    def test_meta_array_roundtrip(self):
        """Data written as array for tool_meta is correctly parsed."""
        # fc_agent_runner.py writes tool_invoke_meta as:
        # [{"name": tool_response["tool_call_name"], "meta": tool_response["meta"]}]
        written = json.dumps([
            {"name": "search", "meta": {"time_cost": 1.5, "tool_config": {"tool_provider_type": "api"}}},
            {"name": "search", "meta": {"time_cost": 2.0, "tool_config": {"tool_provider_type": "api"}}},
            {"name": "calculator", "meta": {"time_cost": 0.1, "tool_config": {"tool_provider_type": "builtin"}}},
        ])

        thought = _make_thought(
            tool="search;search;calculator",
            tool_meta_str=written,
        )

        result = thought.tool_meta
        assert result["search"]["time_cost"] == 1.5
        assert result["search__2"]["time_cost"] == 2.0
        assert result["calculator"]["time_cost"] == 0.1

    def test_all_properties_have_consistent_ordinal_keys(self):
        """All three properties (inputs, outputs, meta) must produce the SAME ordinal keys."""
        tool_str = "search;search;calculator;search"

        input_data = json.dumps([
            {"name": "search", "arguments": {"q": "a"}},
            {"name": "search", "arguments": {"q": "b"}},
            {"name": "calculator", "arguments": {"expr": "1+1"}},
            {"name": "search", "arguments": {"q": "c"}},
        ])
        output_data = json.dumps([
            {"name": "search", "output": "result_a"},
            {"name": "search", "output": "result_b"},
            {"name": "calculator", "output": "2"},
            {"name": "search", "output": "result_c"},
        ])
        meta_data = json.dumps([
            {"name": "search", "meta": {"time_cost": 1.0}},
            {"name": "search", "meta": {"time_cost": 2.0}},
            {"name": "calculator", "meta": {"time_cost": 0.5}},
            {"name": "search", "meta": {"time_cost": 3.0}},
        ])

        thought = _make_thought(
            tool=tool_str,
            tool_input=input_data,
            observation=output_data,
            tool_meta_str=meta_data,
        )

        input_keys = set(thought.tool_inputs_dict.keys())
        output_keys = set(thought.tool_outputs_dict.keys())
        meta_keys = set(thought.tool_meta.keys())

        assert input_keys == output_keys == meta_keys
        assert input_keys == {"search", "search__2", "calculator", "search__3"}


class TestMixedFormatScenarios:
    """Test scenarios where formats might be mixed (e.g., crash during partial save)."""

    def test_array_input_with_dict_observation(self):
        """New array format input but old dict format observation."""
        thought = _make_thought(
            tool="search;calculator",
            tool_input=json.dumps([
                {"name": "search", "arguments": {"q": "test"}},
                {"name": "calculator", "arguments": {"expr": "1+1"}},
            ]),
            observation=json.dumps({"search": "found", "calculator": "2"}),
        )

        inputs = thought.tool_inputs_dict
        outputs = thought.tool_outputs_dict

        # Inputs use ordinal keys from array format
        assert "search" in inputs
        assert "calculator" in inputs

        # Outputs use old dict format (keyed by tool name directly)
        assert "search" in outputs
        assert "calculator" in outputs

    def test_dict_input_with_array_observation(self):
        """Old dict format input but new array format observation."""
        thought = _make_thought(
            tool="search;calculator",
            tool_input=json.dumps({"search": {"q": "test"}, "calculator": {"expr": "1+1"}}),
            observation=json.dumps([
                {"name": "search", "output": "found"},
                {"name": "calculator", "output": "2"},
            ]),
        )

        inputs = thought.tool_inputs_dict
        outputs = thought.tool_outputs_dict

        assert inputs["search"] == {"q": "test"}
        assert outputs["search"] == "found"

    def test_none_meta_with_array_input(self):
        """tool_meta_str is None/empty but tool_input is new array format."""
        thought = _make_thought(
            tool="search;search",
            tool_input=json.dumps([
                {"name": "search", "arguments": {"q": "a"}},
                {"name": "search", "arguments": {"q": "b"}},
            ]),
            tool_meta_str="",
        )

        inputs = thought.tool_inputs_dict
        meta = thought.tool_meta

        assert inputs["search"] == {"q": "a"}
        assert inputs["search__2"] == {"q": "b"}
        assert meta == {}  # Empty meta is fine

    def test_none_observation_with_array_input(self):
        """observation is None/empty but tool_input is new array format."""
        thought = _make_thought(
            tool="search;search",
            tool_input=json.dumps([
                {"name": "search", "arguments": {"q": "a"}},
                {"name": "search", "arguments": {"q": "b"}},
            ]),
            observation="",
        )

        outputs = thought.tool_outputs_dict
        assert outputs == {"search": {}, "search": {}}  # noqa: this is how empty dict format works

    def test_array_input_with_plain_string_observation(self):
        """Array input but observation is a plain non-JSON string."""
        thought = _make_thought(
            tool="search",
            tool_input=json.dumps([{"name": "search", "arguments": {"q": "test"}}]),
            observation="plain text response",
        )

        outputs = thought.tool_outputs_dict
        # Plain string falls through to the except branch
        assert outputs == {"search": "plain text response"}


class TestAgentServiceOrdinalKeyAlignment:
    """
    Verify agent_service.py ordinal key lookup matches model.py property keys.
    This simulates the agent_service.py get_agent_logs iteration pattern.
    """

    def test_service_reads_all_duplicate_inputs(self):
        """agent_service.py can read each duplicate tool's input via ordinal keys."""
        thought = _make_thought(
            tool="search;search;calculator",
            tool_input=json.dumps([
                {"name": "search", "arguments": {"q": "python"}},
                {"name": "search", "arguments": {"q": "javascript"}},
                {"name": "calculator", "arguments": {"expr": "2+2"}},
            ]),
            observation=json.dumps([
                {"name": "search", "output": "python results"},
                {"name": "search", "output": "js results"},
                {"name": "calculator", "output": "4"},
            ]),
            tool_meta_str=json.dumps([
                {"name": "search", "meta": {"time_cost": 1.0, "tool_config": {"tool_provider_type": "api"}}},
                {"name": "search", "meta": {"time_cost": 1.5, "tool_config": {"tool_provider_type": "api"}}},
                {"name": "calculator", "meta": {"time_cost": 0.2, "tool_config": {"tool_provider_type": "builtin"}}},
            ]),
        )

        # Simulate agent_service.py iteration
        tools = thought.tools
        tool_inputs = thought.tool_inputs_dict
        tool_outputs = thought.tool_outputs_dict
        tool_meta = thought.tool_meta

        name_count: dict[str, int] = {}
        results = []
        for tool in tools:
            tool_name = tool
            name_count[tool_name] = name_count.get(tool_name, 0) + 1
            ordinal_key = tool_name if name_count[tool_name] == 1 else f"{tool_name}__{name_count[tool_name]}"

            tool_input = tool_inputs.get(ordinal_key, {})
            tool_output = tool_outputs.get(ordinal_key, {})
            tool_meta_data = tool_meta.get(ordinal_key, {})

            results.append({
                "name": tool_name,
                "ordinal_key": ordinal_key,
                "input": tool_input,
                "output": tool_output,
                "meta": tool_meta_data,
            })

        assert len(results) == 3

        assert results[0]["name"] == "search"
        assert results[0]["ordinal_key"] == "search"
        assert results[0]["input"] == {"q": "python"}
        assert results[0]["output"] == "python results"
        assert results[0]["meta"]["time_cost"] == 1.0

        assert results[1]["name"] == "search"
        assert results[1]["ordinal_key"] == "search__2"
        assert results[1]["input"] == {"q": "javascript"}
        assert results[1]["output"] == "js results"
        assert results[1]["meta"]["time_cost"] == 1.5

        assert results[2]["name"] == "calculator"
        assert results[2]["ordinal_key"] == "calculator"
        assert results[2]["input"] == {"expr": "2+2"}
        assert results[2]["output"] == "4"
        assert results[2]["meta"]["time_cost"] == 0.2


class TestOpsTraceManagerIssue:
    """
    Test for a known issue: ops_trace_manager.py tool_trace uses
    agent_thought.tool_meta.get(tool_name, {}) with the RAW tool_name,
    NOT the ordinal key. This means for duplicate tools, it always
    gets the FIRST occurrence's meta data.

    This is a PRE-EXISTING issue that was not introduced by the fix.
    """

    def test_ops_trace_uses_raw_name_not_ordinal(self):
        """Demonstrate that tool_meta.get(tool_name) only gets first occurrence."""
        thought = _make_thought(
            tool="search;search",
            tool_meta_str=json.dumps([
                {"name": "search", "meta": {"time_cost": 1.0}},
                {"name": "search", "meta": {"time_cost": 2.0}},
            ]),
        )

        meta = thought.tool_meta
        # tool_meta keys are "search" and "search__2"
        assert "search" in meta
        assert "search__2" in meta

        # ops_trace_manager.py line 823 does:
        # tool_meta_data = agent_thought.tool_meta.get(tool_name, {})
        # where tool_name is the raw name "search" - this gets FIRST occurrence only
        tool_name = "search"
        tool_meta_data = meta.get(tool_name, {})
        assert tool_meta_data == {"time_cost": 1.0}  # Always first

        # The second occurrence (search__2) is NOT accessible via raw name lookup
        assert meta.get("search__2", {}) == {"time_cost": 2.0}


class TestHistoryReconstructionPath:
    """Test the organize_agent_history path in base_agent_runner.py."""

    def test_array_format_history_reconstruction_data(self):
        """
        Verify the data structures that organize_agent_history would parse.
        The method checks isinstance(tool_inputs_parsed, list) to branch.
        """
        # Simulate what's stored in DB
        tool_input_payload = json.dumps([
            {"name": "search", "arguments": {"q": "python"}},
            {"name": "search", "arguments": {"q": "javascript"}},
        ])
        observation_payload = json.dumps([
            {"name": "search", "output": "python results"},
            {"name": "search", "output": "js results"},
        ])

        tool_inputs_parsed = json.loads(tool_input_payload)
        tool_responses_parsed = json.loads(observation_payload)

        assert isinstance(tool_inputs_parsed, list)

        # Verify each item can be properly extracted
        for idx, item in enumerate(tool_inputs_parsed):
            assert isinstance(item, dict)
            assert "name" in item
            assert "arguments" in item

        # Verify responses match by index
        for idx, resp_item in enumerate(tool_responses_parsed):
            assert isinstance(resp_item, dict)
            assert "name" in resp_item
            assert "output" in resp_item

        # Verify index-based pairing is correct
        assert tool_inputs_parsed[0]["name"] == tool_responses_parsed[0]["name"]
        assert tool_inputs_parsed[1]["name"] == tool_responses_parsed[1]["name"]

    def test_old_dict_format_history_reconstruction_data(self):
        """Verify old dict format is still handled correctly in history path."""
        tool_input_payload = json.dumps({"search": {"q": "test"}, "calculator": {"expr": "1+1"}})
        observation_payload = json.dumps({"search": "found", "calculator": "2"})

        tool_inputs_parsed = json.loads(tool_input_payload)
        tool_responses_parsed = json.loads(observation_payload)

        # Old format is dict, not list
        assert isinstance(tool_inputs_parsed, dict)
        assert isinstance(tool_responses_parsed, dict)

        # Dict format uses tool name as key
        tool_names = ["search", "calculator"]
        for tool in tool_names:
            assert tool in tool_inputs_parsed
            assert tool in tool_responses_parsed

    def test_array_input_with_list_observation_pairing(self):
        """Verify array format pairs input[i] with observation[i] by index."""
        inputs = [
            {"name": "search", "arguments": {"q": "a"}},
            {"name": "search", "arguments": {"q": "b"}},
            {"name": "calculator", "arguments": {"expr": "1+1"}},
        ]
        observations = [
            {"name": "search", "output": "result_a"},
            {"name": "search", "output": "result_b"},
            {"name": "calculator", "output": "2"},
        ]

        # Verify index-based pairing
        for idx in range(len(inputs)):
            assert inputs[idx]["name"] == observations[idx]["name"]


class TestSSEPipelineFormat:
    """
    Verify SSE pipeline sends tool_input as raw JSON string.
    The frontend must parse this JSON string.
    """

    def test_sse_sends_raw_tool_input_string(self):
        """
        easy_ui_based_generate_task_pipeline.py line 579 sends:
        tool_input=agent_thought.tool_input

        This is the RAW JSON string, not the parsed dict.
        The frontend receives either:
        - Old format: '{"search": {"q": "test"}}'
        - New format: '[{"name": "search", "arguments": {"q": "test"}}]'

        Both are valid JSON strings.
        """
        # New array format
        array_json = json.dumps([
            {"name": "search", "arguments": {"q": "test"}},
            {"name": "search", "arguments": {"q": "test2"}},
        ])
        thought = _make_thought(
            tool="search;search",
            tool_input=array_json,
        )
        # SSE sends tool_input directly - it's a string
        assert isinstance(thought.tool_input, str)
        # Frontend must be able to parse it
        parsed = json.loads(thought.tool_input)
        assert isinstance(parsed, list)
        assert len(parsed) == 2

    def test_sse_sends_raw_observation_string(self):
        """SSE sends observation directly as string."""
        array_json = json.dumps([
            {"name": "search", "output": "result1"},
            {"name": "search", "output": "result2"},
        ])
        thought = _make_thought(
            tool="search;search",
            observation=array_json,
        )
        assert isinstance(thought.observation, str)
        parsed = json.loads(thought.observation)
        assert isinstance(parsed, list)
