"""Tests for duplicate tool name fix - array format support in MessageAgentThought."""

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


class TestToolInputsDict:
    """Test tool_inputs_dict property with old and new formats."""

    def test_new_array_format_no_duplicates(self):
        """Array format with unique tool names returns simple dict."""
        thought = _make_thought(
            tool="search;calculator",
            tool_input=json.dumps([
                {"name": "search", "arguments": {"q": "test"}},
                {"name": "calculator", "arguments": {"expr": "1+1"}},
            ]),
        )
        result = thought.tool_inputs_dict
        assert result == {"search": {"q": "test"}, "calculator": {"expr": "1+1"}}

    def test_new_array_format_with_duplicates(self):
        """Array format with duplicate tool names uses ordinal keys."""
        thought = _make_thought(
            tool="search;search;calculator",
            tool_input=json.dumps([
                {"name": "search", "arguments": {"q": "python"}},
                {"name": "search", "arguments": {"q": "javascript"}},
                {"name": "calculator", "arguments": {"expr": "2+2"}},
            ]),
        )
        result = thought.tool_inputs_dict
        assert result["search"] == {"q": "python"}
        assert result["search__2"] == {"q": "javascript"}
        assert result["calculator"] == {"expr": "2+2"}

    def test_new_array_format_triple_duplicates(self):
        """Array format with 3 identical tool names."""
        thought = _make_thought(
            tool="search;search;search",
            tool_input=json.dumps([
                {"name": "search", "arguments": {"q": "a"}},
                {"name": "search", "arguments": {"q": "b"}},
                {"name": "search", "arguments": {"q": "c"}},
            ]),
        )
        result = thought.tool_inputs_dict
        assert result["search"] == {"q": "a"}
        assert result["search__2"] == {"q": "b"}
        assert result["search__3"] == {"q": "c"}

    def test_old_dict_format_backward_compat(self):
        """Old dict format with multiple tools still works."""
        thought = _make_thought(
            tool="search;calculator",
            tool_input=json.dumps({"search": {"q": "test"}, "calculator": {"expr": "1+1"}}),
        )
        result = thought.tool_inputs_dict
        assert result == {"search": {"q": "test"}, "calculator": {"expr": "1+1"}}

    def test_old_dict_format_single_tool(self):
        """Old format with single tool where input is the arguments dict directly."""
        thought = _make_thought(
            tool="search",
            tool_input=json.dumps({"q": "test"}),
        )
        result = thought.tool_inputs_dict
        assert result == {"search": {"q": "test"}}

    def test_empty_tool_input(self):
        """Empty tool_input returns empty dict for each tool."""
        thought = _make_thought(tool="search;calculator", tool_input="")
        result = thought.tool_inputs_dict
        assert result == {"search": {}, "calculator": {}}

    def test_malformed_json(self):
        """Malformed JSON returns empty dict."""
        thought = _make_thought(tool="search", tool_input="not json")
        result = thought.tool_inputs_dict
        assert result == {}

    def test_no_tool(self):
        """No tool field returns empty dict."""
        thought = _make_thought(tool="", tool_input="")
        result = thought.tool_inputs_dict
        assert result == {}

    def test_array_without_name_field_uses_tools_list(self):
        """Array items without 'name' key fall back to tools list for names."""
        thought = _make_thought(
            tool="search;calculator",
            tool_input=json.dumps([
                {"q": "test"},
                {"expr": "1+1"},
            ]),
        )
        result = thought.tool_inputs_dict
        assert result == {"search": {"q": "test"}, "calculator": {"expr": "1+1"}}


class TestToolOutputsDict:
    """Test tool_outputs_dict property."""

    def test_new_array_format_with_duplicates(self):
        """Array format observations with duplicate names use ordinal keys."""
        thought = _make_thought(
            tool="search;search;calculator",
            observation=json.dumps([
                {"name": "search", "output": "result1"},
                {"name": "search", "output": "result2"},
                {"name": "calculator", "output": "4"},
            ]),
        )
        result = thought.tool_outputs_dict
        assert result["search"] == "result1"
        assert result["search__2"] == "result2"
        assert result["calculator"] == "4"

    def test_new_array_format_no_duplicates(self):
        """Array format with unique names."""
        thought = _make_thought(
            tool="search;calculator",
            observation=json.dumps([
                {"name": "search", "output": "found it"},
                {"name": "calculator", "output": "42"},
            ]),
        )
        result = thought.tool_outputs_dict
        assert result == {"search": "found it", "calculator": "42"}

    def test_old_dict_format(self):
        """Old dict format backward compat."""
        thought = _make_thought(
            tool="search;calculator",
            observation=json.dumps({"search": "found", "calculator": "42"}),
        )
        result = thought.tool_outputs_dict
        assert result == {"search": "found", "calculator": "42"}

    def test_empty_observation(self):
        """Empty observation returns empty dict per tool."""
        thought = _make_thought(tool="search", observation="")
        result = thought.tool_outputs_dict
        assert result == {"search": {}}

    def test_old_dict_single_tool(self):
        """Old format with single tool where observation is the full dict."""
        thought = _make_thought(
            tool="search",
            observation=json.dumps({"results": ["a", "b"]}),
        )
        result = thought.tool_outputs_dict
        assert result == {"search": {"results": ["a", "b"]}}

    def test_array_without_name_field(self):
        """Array items without 'name' key fall back to tools list."""
        thought = _make_thought(
            tool="search;calculator",
            observation=json.dumps([
                "result from search",
                "result from calc",
            ]),
        )
        result = thought.tool_outputs_dict
        assert result == {"search": "result from search", "calculator": "result from calc"}


class TestToolMeta:
    """Test tool_meta property."""

    def test_new_array_format_with_duplicates(self):
        """Array format meta with duplicate names uses ordinal keys."""
        thought = _make_thought(
            tool="search;search",
            tool_meta_str=json.dumps([
                {"name": "search", "meta": {"time_cost": 1.5}},
                {"name": "search", "meta": {"time_cost": 2.0}},
            ]),
        )
        result = thought.tool_meta
        assert result["search"] == {"time_cost": 1.5}
        assert result["search__2"] == {"time_cost": 2.0}

    def test_new_array_format_no_duplicates(self):
        """Array format with unique names."""
        thought = _make_thought(
            tool="search;calculator",
            tool_meta_str=json.dumps([
                {"name": "search", "meta": {"time_cost": 1.5}},
                {"name": "calculator", "meta": {"time_cost": 0.3}},
            ]),
        )
        result = thought.tool_meta
        assert result == {"search": {"time_cost": 1.5}, "calculator": {"time_cost": 0.3}}

    def test_old_dict_format(self):
        """Old dict format backward compat."""
        thought = _make_thought(
            tool="search;calculator",
            tool_meta_str=json.dumps({"search": {"time_cost": 1.5}, "calculator": {"time_cost": 2.0}}),
        )
        result = thought.tool_meta
        assert result == {"search": {"time_cost": 1.5}, "calculator": {"time_cost": 2.0}}

    def test_empty_meta(self):
        """Empty meta returns empty dict."""
        thought = _make_thought(tool="search", tool_meta_str="")
        result = thought.tool_meta
        assert result == {}

    def test_malformed_json(self):
        """Malformed JSON returns empty dict."""
        thought = _make_thought(tool="search", tool_meta_str="not json")
        result = thought.tool_meta
        assert result == {}

    def test_array_without_name_field(self):
        """Array items without 'name' key fall back to tools list."""
        thought = _make_thought(
            tool="search;calculator",
            tool_meta_str=json.dumps([
                {"time_cost": 1.5},
                {"time_cost": 0.3},
            ]),
        )
        result = thought.tool_meta
        assert result == {"search": {"time_cost": 1.5}, "calculator": {"time_cost": 0.3}}
