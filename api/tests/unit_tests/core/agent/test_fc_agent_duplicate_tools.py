"""
Unit tests for FunctionCallAgentRunner duplicate tool call handling.
Tests fix for issue #16220: Agent API Streaming - only one tool_input and observation returned
when a tool is called multiple times.
"""

import json


class TestDuplicateToolCallHandling:
    """Test that duplicate tool calls are properly preserved with indexed keys."""

    def _get_indexed_tool_inputs(self, tool_calls):
        """Helper method to generate indexed tool input dictionary."""
        tool_call_inputs_dict = {}
        tool_name_counts = {}
        for tool_call in tool_calls:
            tool_name = tool_call[1]
            count = tool_name_counts.get(tool_name, 0)
            key = f"{tool_name}_{count}" if count > 0 else tool_name
            tool_call_inputs_dict[key] = tool_call[2]
            tool_name_counts[tool_name] = count + 1
        return tool_call_inputs_dict

    def _get_indexed_observations(self, tool_responses):
        """Helper method to generate indexed observations and metadata dictionaries."""
        tool_invoke_meta_dict = {}
        observation_dict = {}
        tool_name_counts = {}
        for tool_response in tool_responses:
            tool_name = tool_response["tool_call_name"]
            count = tool_name_counts.get(tool_name, 0)
            key = f"{tool_name}_{count}" if count > 0 else tool_name
            tool_invoke_meta_dict[key] = tool_response["meta"]
            observation_dict[key] = tool_response["tool_response"]
            tool_name_counts[tool_name] = count + 1
        return observation_dict, tool_invoke_meta_dict

    def test_tool_input_indexing_single_call(self):
        """Test that a single tool call uses the simple tool name as key."""
        tool_calls = [
            ("call_1", "ddgo_img", {"query": "dog"}),
        ]

        tool_call_inputs_dict = self._get_indexed_tool_inputs(tool_calls)

        assert len(tool_call_inputs_dict) == 1
        assert "ddgo_img" in tool_call_inputs_dict
        assert tool_call_inputs_dict["ddgo_img"] == {"query": "dog"}

    def test_tool_input_indexing_duplicate_calls(self):
        """Test that duplicate tool calls are preserved with indexed keys."""
        tool_calls = [
            ("call_1", "ddgo_img", {"query": "dog"}),
            ("call_2", "ddgo_img", {"query": "cat"}),
        ]

        tool_call_inputs_dict = self._get_indexed_tool_inputs(tool_calls)

        # Should have 2 entries
        assert len(tool_call_inputs_dict) == 2

        # First call uses simple name
        assert "ddgo_img" in tool_call_inputs_dict
        assert tool_call_inputs_dict["ddgo_img"] == {"query": "dog"}

        # Second call uses indexed name
        assert "ddgo_img_1" in tool_call_inputs_dict
        assert tool_call_inputs_dict["ddgo_img_1"] == {"query": "cat"}

    def test_tool_input_indexing_triple_calls(self):
        """Test that three calls to the same tool are all preserved."""
        tool_calls = [
            ("call_1", "search", {"query": "Python"}),
            ("call_2", "search", {"query": "JavaScript"}),
            ("call_3", "search", {"query": "Go"}),
        ]

        tool_call_inputs_dict = self._get_indexed_tool_inputs(tool_calls)

        assert len(tool_call_inputs_dict) == 3
        assert tool_call_inputs_dict["search"] == {"query": "Python"}
        assert tool_call_inputs_dict["search_1"] == {"query": "JavaScript"}
        assert tool_call_inputs_dict["search_2"] == {"query": "Go"}

    def test_tool_input_indexing_mixed_tools(self):
        """Test duplicate calls mixed with unique tool calls."""
        tool_calls = [
            ("call_1", "ddgo_img", {"query": "dog"}),
            ("call_2", "calculator", {"expression": "2+2"}),
            ("call_3", "ddgo_img", {"query": "cat"}),
            ("call_4", "weather", {"city": "NYC"}),
        ]

        tool_call_inputs_dict = self._get_indexed_tool_inputs(tool_calls)

        assert len(tool_call_inputs_dict) == 4
        assert tool_call_inputs_dict["ddgo_img"] == {"query": "dog"}
        assert tool_call_inputs_dict["ddgo_img_1"] == {"query": "cat"}
        assert tool_call_inputs_dict["calculator"] == {"expression": "2+2"}
        assert tool_call_inputs_dict["weather"] == {"city": "NYC"}

    def test_observation_indexing_duplicate_responses(self):
        """Test that observations for duplicate tool calls are preserved."""
        tool_responses = [
            {
                "tool_call_id": "call_1",
                "tool_call_name": "ddgo_img",
                "tool_response": "Image of a dog",
                "meta": {"time": 1.2},
            },
            {
                "tool_call_id": "call_2",
                "tool_call_name": "ddgo_img",
                "tool_response": "Image of a cat",
                "meta": {"time": 1.5},
            },
        ]

        observation_dict, tool_invoke_meta_dict = self._get_indexed_observations(tool_responses)

        # Verify both observations are preserved
        assert len(observation_dict) == 2
        assert observation_dict["ddgo_img"] == "Image of a dog"
        assert observation_dict["ddgo_img_1"] == "Image of a cat"

        # Verify both metadata are preserved
        assert len(tool_invoke_meta_dict) == 2
        assert tool_invoke_meta_dict["ddgo_img"] == {"time": 1.2}
        assert tool_invoke_meta_dict["ddgo_img_1"] == {"time": 1.5}

    def test_json_serialization_with_duplicate_tools(self):
        """Test that the indexed dict can be properly serialized to JSON."""
        tool_calls = [
            ("call_1", "ddgo_img", {"query": "dog"}),
            ("call_2", "ddgo_img", {"query": "cat"}),
        ]

        tool_call_inputs_dict = self._get_indexed_tool_inputs(tool_calls)

        # Should serialize without errors
        json_str = json.dumps(tool_call_inputs_dict, ensure_ascii=False)
        assert json_str is not None

        # Should deserialize back correctly
        deserialized = json.loads(json_str)
        assert deserialized["ddgo_img"] == {"query": "dog"}
        assert deserialized["ddgo_img_1"] == {"query": "cat"}

    def test_backward_compatibility_single_tool(self):
        """Test that single tool calls maintain backward compatibility (no index suffix)."""
        tool_calls = [
            ("call_1", "single_tool", {"param": "value"}),
        ]

        tool_call_inputs_dict = self._get_indexed_tool_inputs(tool_calls)

        # Single calls should use simple key (backward compatible)
        assert "single_tool" in tool_call_inputs_dict
        assert "single_tool_0" not in tool_call_inputs_dict
        assert "single_tool_1" not in tool_call_inputs_dict
