import pytest

from dify_graph.nodes.llm import llm_utils
from dify_graph.runtime import VariablePool


@pytest.fixture
def variable_pool() -> VariablePool:
    pool = VariablePool.empty()
    pool.add(["node1", "output"], "resolved_value")
    pool.add(["node2", "text"], "hello world")
    pool.add(["start", "user_input"], "dynamic_param")
    return pool


class TestResolveCompletionParamsVariables:
    def test_plain_string_values_unchanged(self, variable_pool: VariablePool):
        params = {"response_format": "json", "custom_param": "static_value"}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"response_format": "json", "custom_param": "static_value"}

    def test_numeric_values_unchanged(self, variable_pool: VariablePool):
        params = {"temperature": 0.7, "top_p": 0.9, "max_tokens": 1024}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"temperature": 0.7, "top_p": 0.9, "max_tokens": 1024}

    def test_boolean_values_unchanged(self, variable_pool: VariablePool):
        params = {"stream": True, "echo": False}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"stream": True, "echo": False}

    def test_list_values_unchanged(self, variable_pool: VariablePool):
        params = {"stop": ["Human:", "Assistant:"]}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"stop": ["Human:", "Assistant:"]}

    def test_single_variable_reference_resolved(self, variable_pool: VariablePool):
        params = {"response_format": "{{#node1.output#}}"}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"response_format": "resolved_value"}

    def test_multiple_variable_references_resolved(self, variable_pool: VariablePool):
        params = {
            "param_a": "{{#node1.output#}}",
            "param_b": "{{#node2.text#}}",
        }

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"param_a": "resolved_value", "param_b": "hello world"}

    def test_mixed_text_and_variable_resolved(self, variable_pool: VariablePool):
        params = {"prompt_prefix": "prefix_{{#node1.output#}}_suffix"}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"prompt_prefix": "prefix_resolved_value_suffix"}

    def test_mixed_params_types(self, variable_pool: VariablePool):
        """Non-string params pass through; string params with variables get resolved."""
        params = {
            "temperature": 0.7,
            "response_format": "{{#node1.output#}}",
            "custom_string": "no_vars_here",
            "max_tokens": 512,
            "stop": ["\n"],
        }

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {
            "temperature": 0.7,
            "response_format": "resolved_value",
            "custom_string": "no_vars_here",
            "max_tokens": 512,
            "stop": ["\n"],
        }

    def test_empty_params(self, variable_pool: VariablePool):
        result = llm_utils.resolve_completion_params_variables({}, variable_pool)

        assert result == {}

    def test_unresolvable_variable_keeps_selector_text(self):
        """When a referenced variable doesn't exist in the pool, convert_template
        falls back to the raw selector path (e.g. 'nonexistent.var')."""
        pool = VariablePool.empty()
        params = {"format": "{{#nonexistent.var#}}"}

        result = llm_utils.resolve_completion_params_variables(params, pool)

        assert result["format"] == "nonexistent.var"

    def test_multiple_variables_in_single_value(self, variable_pool: VariablePool):
        params = {"combined": "{{#node1.output#}} and {{#node2.text#}}"}

        result = llm_utils.resolve_completion_params_variables(params, variable_pool)

        assert result == {"combined": "resolved_value and hello world"}

    def test_original_params_not_mutated(self, variable_pool: VariablePool):
        original = {"response_format": "{{#node1.output#}}", "temperature": 0.5}
        original_copy = dict(original)

        llm_utils.resolve_completion_params_variables(original, variable_pool)

        assert original == original_copy
