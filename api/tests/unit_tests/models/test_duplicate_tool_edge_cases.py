"""Edge case tests for duplicate tool name fix in MessageAgentThought.

Focuses on boundary conditions, malformed inputs, and tricky scenarios
that the basic test suite does not cover.
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


# ===================================================================
# tool_inputs_dict edge cases
# ===================================================================
class TestToolInputsDictEdgeCases:
    """Edge cases for tool_inputs_dict property."""

    def test_array_longer_than_tools_list(self):
        """Array has more items than the semicolon-separated tool list.
        Extra items should use fallback name 'tool_N'.
        """
        thought = _make_thought(
            tool="search",
            tool_input=json.dumps([
                {"name": "search", "arguments": {"q": "a"}},
                {"name": "extra_tool", "arguments": {"q": "b"}},
            ]),
        )
        result = thought.tool_inputs_dict
        assert result["search"] == {"q": "a"}
        assert result["extra_tool"] == {"q": "b"}

    def test_array_shorter_than_tools_list(self):
        """Array has fewer items than tools. Missing tools get no entry."""
        thought = _make_thought(
            tool="search;calculator;weather",
            tool_input=json.dumps([
                {"name": "search", "arguments": {"q": "test"}},
            ]),
        )
        result = thought.tool_inputs_dict
        assert result == {"search": {"q": "test"}}

    def test_interleaved_duplicates(self):
        """Pattern: A, B, A, B - tests that ordinal tracking is per-name."""
        thought = _make_thought(
            tool="search;calc;search;calc",
            tool_input=json.dumps([
                {"name": "search", "arguments": {"q": "first"}},
                {"name": "calc", "arguments": {"expr": "1+1"}},
                {"name": "search", "arguments": {"q": "second"}},
                {"name": "calc", "arguments": {"expr": "2+2"}},
            ]),
        )
        result = thought.tool_inputs_dict
        assert result["search"] == {"q": "first"}
        assert result["search__2"] == {"q": "second"}
        assert result["calc"] == {"expr": "1+1"}
        assert result["calc__2"] == {"expr": "2+2"}

    def test_many_duplicates_ordinal_keys(self):
        """10 identical tool names should produce search, search__2, ... search__10."""
        items = [{"name": "search", "arguments": {"q": f"query_{i}"}} for i in range(10)]
        thought = _make_thought(
            tool=";".join(["search"] * 10),
            tool_input=json.dumps(items),
        )
        result = thought.tool_inputs_dict
        assert result["search"] == {"q": "query_0"}
        for i in range(1, 10):
            assert result[f"search__{i + 1}"] == {"q": f"query_{i}"}
        assert len(result) == 10

    def test_tool_name_with_double_underscore_collision(self):
        """Tool name 'search__2' already exists; duplicate 'search' should
        produce key 'search__2' which collides. Verify the behavior.
        """
        thought = _make_thought(
            tool="search__2;search;search",
            tool_input=json.dumps([
                {"name": "search__2", "arguments": {"q": "explicit"}},
                {"name": "search", "arguments": {"q": "first"}},
                {"name": "search", "arguments": {"q": "second"}},
            ]),
        )
        result = thought.tool_inputs_dict
        # The first entry for "search__2" is stored first.
        # Then "search" (1st occurrence) gets key "search".
        # Then "search" (2nd occurrence) gets key "search__2" which COLLIDES
        # with the explicit "search__2" entry.
        # Current implementation will overwrite the first "search__2" value.
        # This is a known edge case - documenting actual behavior.
        assert "search__2" in result
        assert "search" in result

    def test_non_dict_items_in_array(self):
        """Array contains non-dict items (e.g., strings, ints).
        Items without 'name' key fallback to tool list, and non-dict
        items get empty dict as args.
        """
        thought = _make_thought(
            tool="search;calc;weather",
            tool_input=json.dumps([
                "just a string",
                42,
                None,
            ]),
        )
        result = thought.tool_inputs_dict
        # Non-dict items: name from tools list, args = {} (since not isinstance dict)
        assert result["search"] == {}
        assert result["calc"] == {}
        assert result["weather"] == {}

    def test_mixed_named_and_unnamed_items(self):
        """Array with some items having 'name' key and others not."""
        thought = _make_thought(
            tool="search;calculator;weather",
            tool_input=json.dumps([
                {"name": "search", "arguments": {"q": "test"}},
                {"expr": "1+1"},  # no 'name' key
                {"name": "weather", "arguments": {"city": "NYC"}},
            ]),
        )
        result = thought.tool_inputs_dict
        assert result["search"] == {"q": "test"}
        # Second item has no 'name', falls back to tools[1] = "calculator"
        # But args = item since it's a dict but no "arguments" key
        assert result["calculator"] == {"expr": "1+1"}
        assert result["weather"] == {"city": "NYC"}

    def test_empty_array(self):
        """Empty JSON array returns empty dict."""
        thought = _make_thought(
            tool="search",
            tool_input=json.dumps([]),
        )
        result = thought.tool_inputs_dict
        assert result == {}

    def test_tool_none(self):
        """tool field is None (not just empty string)."""
        thought = _make_thought(
            tool=None,
            tool_input=json.dumps({"q": "test"}),
        )
        result = thought.tool_inputs_dict
        # tools property returns [] when tool is None
        # data is a dict, tools is empty, so loop doesn't add anything
        assert result == {}

    def test_tool_input_is_none(self):
        """tool_input is None returns empty dict per tool."""
        thought = _make_thought(
            tool="search;calculator",
            tool_input=None,
        )
        result = thought.tool_inputs_dict
        assert result == {"search": {}, "calculator": {}}

    def test_json_primitive_string(self):
        """tool_input is a JSON string primitive (not array or dict).
        Single tool should wrap it.
        """
        thought = _make_thought(
            tool="search",
            tool_input=json.dumps("hello world"),
        )
        result = thought.tool_inputs_dict
        # data is a string, not list/dict. len(tools)==1, so {tools[0]: data}
        assert result == {"search": "hello world"}

    def test_json_primitive_number(self):
        """tool_input is a JSON number."""
        thought = _make_thought(
            tool="calc",
            tool_input=json.dumps(42),
        )
        result = thought.tool_inputs_dict
        assert result == {"calc": 42}

    def test_json_primitive_null(self):
        """tool_input is JSON null."""
        thought = _make_thought(
            tool="search",
            tool_input=json.dumps(None),
        )
        result = thought.tool_inputs_dict
        # None is not list, not dict. Single tool, so {tools[0]: None}
        assert result == {"search": None}

    def test_json_primitive_with_multiple_tools(self):
        """JSON primitive with multiple tools returns empty dict."""
        thought = _make_thought(
            tool="search;calc",
            tool_input=json.dumps("hello"),
        )
        result = thought.tool_inputs_dict
        # data is string, not list/dict, len(tools) != 1 => return {}
        assert result == {}

    def test_unicode_tool_names(self):
        """Unicode tool names in both tool field and array items."""
        thought = _make_thought(
            tool="búsqueda;búsqueda",
            tool_input=json.dumps([
                {"name": "búsqueda", "arguments": {"q": "primero"}},
                {"name": "búsqueda", "arguments": {"q": "segundo"}},
            ]),
        )
        result = thought.tool_inputs_dict
        assert result["búsqueda"] == {"q": "primero"}
        assert result["búsqueda__2"] == {"q": "segundo"}

    def test_tool_with_semicolons_in_name(self):
        """Tools are separated by semicolons. A tool name containing ';'
        would be split incorrectly. This tests the actual behavior.
        """
        # If someone stored "my;tool" as a tool name, split(";") breaks it.
        thought = _make_thought(
            tool="my;tool",  # This becomes ["my", "tool"] not ["my;tool"]
            tool_input=json.dumps({"my": {"a": 1}, "tool": {"b": 2}}),
        )
        result = thought.tool_inputs_dict
        assert result == {"my": {"a": 1}, "tool": {"b": 2}}

    def test_whitespace_in_tool_names(self):
        """Tool names with leading/trailing whitespace."""
        thought = _make_thought(
            tool=" search ; calc ",
            tool_input=json.dumps({" search ": {"q": "test"}, " calc ": {"expr": "1+1"}}),
        )
        result = thought.tool_inputs_dict
        # split(";") preserves whitespace
        assert result[" search "] == {"q": "test"}
        assert result[" calc "] == {"expr": "1+1"}

    def test_old_format_single_tool_nested_dict(self):
        """Old format: single tool, input is a nested dict that looks like
        it could be a multi-tool dict (has a key matching the tool name).
        """
        thought = _make_thought(
            tool="search",
            tool_input=json.dumps({"search": "my query", "limit": 10}),
        )
        result = thought.tool_inputs_dict
        # Single tool, "search" is in data => result["search"] = data["search"]
        # Wait - code checks `if tool in data` for each tool.
        # For single tool "search", "search" is in data, so result["search"] = data["search"] = "my query"
        # This means the "limit" key is LOST
        assert result["search"] == "my query"

    def test_old_format_single_tool_no_key_match(self):
        """Old format: single tool where the dict keys don't match the tool name.
        Should treat the entire dict as the tool's input.
        """
        thought = _make_thought(
            tool="search",
            tool_input=json.dumps({"query": "test", "limit": 5}),
        )
        result = thought.tool_inputs_dict
        # "search" not in data, len(tools)==1, so result["search"] = data
        assert result["search"] == {"query": "test", "limit": 5}

    def test_empty_name_in_array_items(self):
        """Array items with empty string as 'name'."""
        thought = _make_thought(
            tool="search;calc",
            tool_input=json.dumps([
                {"name": "", "arguments": {"q": "test"}},
                {"name": "", "arguments": {"expr": "1+1"}},
            ]),
        )
        result = thought.tool_inputs_dict
        # Both have name="" so dedup produces "" and "__2"
        assert result[""] == {"q": "test"}
        assert result["__2"] == {"expr": "1+1"}

    def test_array_item_name_mismatch_with_tools(self):
        """Array item names don't match the tool list at all."""
        thought = _make_thought(
            tool="search;calculator",
            tool_input=json.dumps([
                {"name": "foo", "arguments": {"a": 1}},
                {"name": "bar", "arguments": {"b": 2}},
            ]),
        )
        result = thought.tool_inputs_dict
        # Array format uses item names, not tool list
        assert result == {"foo": {"a": 1}, "bar": {"b": 2}}

    def test_arguments_is_none(self):
        """Array item where 'arguments' is explicitly None."""
        thought = _make_thought(
            tool="search",
            tool_input=json.dumps([
                {"name": "search", "arguments": None},
            ]),
        )
        result = thought.tool_inputs_dict
        # item.get("arguments", {}) returns None since key exists
        assert result["search"] is None

    def test_arguments_is_empty_dict(self):
        """Array item where 'arguments' is an empty dict."""
        thought = _make_thought(
            tool="search",
            tool_input=json.dumps([
                {"name": "search", "arguments": {}},
            ]),
        )
        result = thought.tool_inputs_dict
        assert result["search"] == {}

    def test_arguments_key_missing(self):
        """Array item with 'name' but no 'arguments' key at all."""
        thought = _make_thought(
            tool="search",
            tool_input=json.dumps([
                {"name": "search"},
            ]),
        )
        result = thought.tool_inputs_dict
        assert result["search"] == {}

    def test_deeply_nested_arguments(self):
        """Arguments contain deeply nested structures."""
        deep_args = {"level1": {"level2": {"level3": [1, 2, {"level4": True}]}}}
        thought = _make_thought(
            tool="search",
            tool_input=json.dumps([
                {"name": "search", "arguments": deep_args},
            ]),
        )
        result = thought.tool_inputs_dict
        assert result["search"] == deep_args


# ===================================================================
# tool_outputs_dict edge cases
# ===================================================================
class TestToolOutputsDictEdgeCases:
    """Edge cases for tool_outputs_dict property."""

    def test_array_longer_than_tools_list(self):
        """Array with more items than tools list."""
        thought = _make_thought(
            tool="search",
            observation=json.dumps([
                {"name": "search", "output": "result1"},
                {"name": "extra", "output": "result2"},
            ]),
        )
        result = thought.tool_outputs_dict
        assert result["search"] == "result1"
        assert result["extra"] == "result2"

    def test_interleaved_duplicates(self):
        """Interleaved duplicate tool names in outputs."""
        thought = _make_thought(
            tool="search;calc;search;calc",
            observation=json.dumps([
                {"name": "search", "output": "s1"},
                {"name": "calc", "output": "c1"},
                {"name": "search", "output": "s2"},
                {"name": "calc", "output": "c2"},
            ]),
        )
        result = thought.tool_outputs_dict
        assert result["search"] == "s1"
        assert result["search__2"] == "s2"
        assert result["calc"] == "c1"
        assert result["calc__2"] == "c2"

    def test_non_string_observation_fallback(self):
        """observation that is not valid JSON returns raw string for each tool."""
        thought = _make_thought(
            tool="search;calc",
            observation="raw error text from tool",
        )
        result = thought.tool_outputs_dict
        # JSON decode fails, except block: dict.fromkeys(tools, self.observation)
        assert result == {"search": "raw error text from tool", "calc": "raw error text from tool"}

    def test_observation_is_none(self):
        """observation is None returns empty dicts for each tool."""
        thought = _make_thought(
            tool="search;calc",
            observation=None,
        )
        result = thought.tool_outputs_dict
        assert result == {"search": {}, "calc": {}}

    def test_output_key_missing(self):
        """Array item with 'name' but no 'output' key."""
        thought = _make_thought(
            tool="search",
            observation=json.dumps([
                {"name": "search"},
            ]),
        )
        result = thought.tool_outputs_dict
        # item.get("output", "") returns ""
        assert result["search"] == ""

    def test_output_is_complex_object(self):
        """Output contains a complex nested object."""
        complex_output = {"data": [1, 2, 3], "metadata": {"count": 3}}
        thought = _make_thought(
            tool="api_call",
            observation=json.dumps([
                {"name": "api_call", "output": complex_output},
            ]),
        )
        result = thought.tool_outputs_dict
        assert result["api_call"] == complex_output

    def test_empty_array_observation(self):
        """Empty JSON array observation."""
        thought = _make_thought(
            tool="search",
            observation=json.dumps([]),
        )
        result = thought.tool_outputs_dict
        assert result == {}

    def test_json_primitive_string_observation_single_tool(self):
        """JSON string observation with single tool wraps it."""
        thought = _make_thought(
            tool="search",
            observation=json.dumps("found 5 results"),
        )
        result = thought.tool_outputs_dict
        assert result == {"search": "found 5 results"}

    def test_json_primitive_string_observation_multi_tool(self):
        """JSON string observation with multiple tools returns empty dict."""
        thought = _make_thought(
            tool="search;calc",
            observation=json.dumps("some result"),
        )
        result = thought.tool_outputs_dict
        assert result == {}

    def test_many_duplicates_in_outputs(self):
        """Many duplicate tool names in outputs."""
        items = [{"name": "api", "output": f"response_{i}"} for i in range(5)]
        thought = _make_thought(
            tool=";".join(["api"] * 5),
            observation=json.dumps(items),
        )
        result = thought.tool_outputs_dict
        assert result["api"] == "response_0"
        for i in range(1, 5):
            assert result[f"api__{i + 1}"] == f"response_{i}"

    def test_old_format_single_tool_observation_key_match(self):
        """Old format: single tool, observation dict has key matching tool name."""
        thought = _make_thought(
            tool="search",
            observation=json.dumps({"search": "the result", "extra": "ignored"}),
        )
        result = thought.tool_outputs_dict
        # "search" is in data => result["search"] = data["search"]
        assert result["search"] == "the result"


# ===================================================================
# tool_meta edge cases
# ===================================================================
class TestToolMetaEdgeCases:
    """Edge cases for tool_meta property."""

    def test_array_longer_than_tools_list(self):
        """Array with more items than tools list - extra items use fallback name."""
        thought = _make_thought(
            tool="search",
            tool_meta_str=json.dumps([
                {"name": "search", "meta": {"time": 1.0}},
                {"name": "extra", "meta": {"time": 2.0}},
            ]),
        )
        result = thought.tool_meta
        assert result["search"] == {"time": 1.0}
        assert result["extra"] == {"time": 2.0}

    def test_interleaved_duplicates(self):
        """Interleaved duplicates in meta."""
        thought = _make_thought(
            tool="search;calc;search;calc",
            tool_meta_str=json.dumps([
                {"name": "search", "meta": {"cost": 0.1}},
                {"name": "calc", "meta": {"cost": 0.2}},
                {"name": "search", "meta": {"cost": 0.3}},
                {"name": "calc", "meta": {"cost": 0.4}},
            ]),
        )
        result = thought.tool_meta
        assert result["search"] == {"cost": 0.1}
        assert result["search__2"] == {"cost": 0.3}
        assert result["calc"] == {"cost": 0.2}
        assert result["calc__2"] == {"cost": 0.4}

    def test_non_dict_meta_items(self):
        """Array items that are not dicts (e.g., None, string, int)."""
        thought = _make_thought(
            tool="search;calc;weather",
            tool_meta_str=json.dumps([
                "not a dict",
                42,
                None,
            ]),
        )
        result = thought.tool_meta
        # Non-dict items: name from tools[i], meta = {} (not isinstance dict)
        assert result["search"] == {}
        assert result["calc"] == {}
        assert result["weather"] == {}

    def test_meta_key_missing_in_named_item(self):
        """Array item with 'name' but no 'meta' key."""
        thought = _make_thought(
            tool="search",
            tool_meta_str=json.dumps([
                {"name": "search"},
            ]),
        )
        result = thought.tool_meta
        assert result["search"] == {}

    def test_meta_is_none_in_named_item(self):
        """Array item where 'meta' value is None."""
        thought = _make_thought(
            tool="search",
            tool_meta_str=json.dumps([
                {"name": "search", "meta": None},
            ]),
        )
        result = thought.tool_meta
        assert result["search"] is None

    def test_json_null_meta_str(self):
        """tool_meta_str is the string 'null'."""
        thought = _make_thought(
            tool="search",
            tool_meta_str="null",
        )
        result = thought.tool_meta
        # json.loads("null") = None, not list, not dict => return {}
        assert result == {}

    def test_json_array_of_arrays(self):
        """Nested array format - array of arrays (not expected format)."""
        thought = _make_thought(
            tool="search;calc",
            tool_meta_str=json.dumps([[1, 2], [3, 4]]),
        )
        result = thought.tool_meta
        # Items are lists, not dicts with "name"
        # Falls to else: name = tools[i], meta = {} (not isinstance dict)
        assert result["search"] == {}
        assert result["calc"] == {}

    def test_tool_meta_str_is_empty_string(self):
        """Explicitly empty string for tool_meta_str."""
        thought = _make_thought(
            tool="search",
            tool_meta_str="",
        )
        result = thought.tool_meta
        assert result == {}

    def test_fallback_name_tool_index_out_of_range(self):
        """Array items without 'name' when index exceeds tools list length."""
        thought = _make_thought(
            tool="search",
            tool_meta_str=json.dumps([
                {"time": 1.0},
                {"time": 2.0},
                {"time": 3.0},
            ]),
        )
        result = thought.tool_meta
        # Item 0: tools[0] = "search", item is dict => meta = item
        # Item 1: i=1 >= len(tools)=1 => name = "tool_1"
        # Item 2: i=2 >= len(tools)=1 => name = "tool_2"
        assert result["search"] == {"time": 1.0}
        assert result["tool_1"] == {"time": 2.0}
        assert result["tool_2"] == {"time": 3.0}


# ===================================================================
# tools property edge cases
# ===================================================================
class TestToolsPropertyEdgeCases:
    """Edge cases for the tools property."""

    def test_tool_with_trailing_semicolon(self):
        """Tool string ending with semicolon creates empty last element."""
        thought = _make_thought(
            tool="search;",
            tool_input=json.dumps({"search": {"q": "test"}}),
        )
        # "search;".split(";") = ["search", ""]
        assert thought.tools == ["search", ""]

    def test_tool_with_leading_semicolon(self):
        """Tool string starting with semicolon creates empty first element."""
        thought = _make_thought(
            tool=";search",
        )
        assert thought.tools == ["", "search"]

    def test_tool_with_multiple_semicolons(self):
        """Consecutive semicolons create empty elements."""
        thought = _make_thought(
            tool="search;;calc",
        )
        assert thought.tools == ["search", "", "calc"]

    def test_tool_single_semicolon(self):
        """Single semicolon creates two empty strings."""
        thought = _make_thought(
            tool=";",
        )
        assert thought.tools == ["", ""]


# ===================================================================
# Cross-property consistency edge cases
# ===================================================================
class TestCrossPropertyConsistency:
    """Tests that tool_inputs_dict and tool_outputs_dict produce
    consistent key sets for the same tool configuration.
    """

    def test_same_keys_for_matching_inputs_and_outputs(self):
        """Inputs and outputs should produce the same key set when
        they have the same tool names in the same order.
        """
        tools = "search;search;calc"
        thought = _make_thought(
            tool=tools,
            tool_input=json.dumps([
                {"name": "search", "arguments": {"q": "a"}},
                {"name": "search", "arguments": {"q": "b"}},
                {"name": "calc", "arguments": {"expr": "1+1"}},
            ]),
            observation=json.dumps([
                {"name": "search", "output": "r1"},
                {"name": "search", "output": "r2"},
                {"name": "calc", "output": "2"},
            ]),
            tool_meta_str=json.dumps([
                {"name": "search", "meta": {"t": 1}},
                {"name": "search", "meta": {"t": 2}},
                {"name": "calc", "meta": {"t": 3}},
            ]),
        )
        input_keys = set(thought.tool_inputs_dict.keys())
        output_keys = set(thought.tool_outputs_dict.keys())
        meta_keys = set(thought.tool_meta.keys())

        assert input_keys == output_keys == meta_keys
        assert input_keys == {"search", "search__2", "calc"}

    def test_mixed_old_and_new_formats_across_properties(self):
        """One property uses new array format, another uses old dict format.
        This is a realistic scenario during migration.
        """
        thought = _make_thought(
            tool="search;calc",
            tool_input=json.dumps([
                {"name": "search", "arguments": {"q": "test"}},
                {"name": "calc", "arguments": {"expr": "1+1"}},
            ]),
            # Old dict format for observation
            observation=json.dumps({"search": "result", "calc": "2"}),
            # Old dict format for meta
            tool_meta_str=json.dumps({"search": {"t": 1}, "calc": {"t": 2}}),
        )
        assert thought.tool_inputs_dict == {"search": {"q": "test"}, "calc": {"expr": "1+1"}}
        assert thought.tool_outputs_dict == {"search": "result", "calc": "2"}
        assert thought.tool_meta == {"search": {"t": 1}, "calc": {"t": 2}}
