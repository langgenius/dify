"""
Unit tests for the Validation Rule Engine.

Tests cover:
- Structure rules (required fields, types, formats)
- Semantic rules (variable references, edge connections)
- Reference rules (model exists, tool configured, dataset valid)
- ValidationEngine integration
"""


from core.workflow.generator.validation import (
    ValidationContext,
    ValidationEngine,
)
from core.workflow.generator.validation.rules import (
    extract_variable_refs,
    is_placeholder,
)


class TestPlaceholderDetection:
    """Tests for placeholder detection utility."""

    def test_detects_please_select(self):
        assert is_placeholder("PLEASE_SELECT_YOUR_MODEL") is True

    def test_detects_your_prefix(self):
        assert is_placeholder("YOUR_API_KEY") is True

    def test_detects_todo(self):
        assert is_placeholder("TODO: fill this in") is True

    def test_detects_placeholder(self):
        assert is_placeholder("PLACEHOLDER_VALUE") is True

    def test_detects_example_prefix(self):
        assert is_placeholder("EXAMPLE_URL") is True

    def test_detects_replace_prefix(self):
        assert is_placeholder("REPLACE_WITH_ACTUAL") is True

    def test_case_insensitive(self):
        assert is_placeholder("please_select") is True
        assert is_placeholder("Please_Select") is True

    def test_valid_values_not_detected(self):
        assert is_placeholder("https://api.example.com") is False
        assert is_placeholder("gpt-4") is False
        assert is_placeholder("my_variable") is False

    def test_non_string_returns_false(self):
        assert is_placeholder(123) is False
        assert is_placeholder(None) is False
        assert is_placeholder(["list"]) is False


class TestVariableRefExtraction:
    """Tests for variable reference extraction."""

    def test_extracts_simple_ref(self):
        refs = extract_variable_refs("Hello {{#start.query#}}")
        assert refs == [("start", "query")]

    def test_extracts_multiple_refs(self):
        refs = extract_variable_refs("{{#node1.output#}} and {{#node2.text#}}")
        assert refs == [("node1", "output"), ("node2", "text")]

    def test_extracts_nested_field(self):
        refs = extract_variable_refs("{{#http_request.body#}}")
        assert refs == [("http_request", "body")]

    def test_no_refs_returns_empty(self):
        refs = extract_variable_refs("No references here")
        assert refs == []

    def test_handles_malformed_refs(self):
        refs = extract_variable_refs("{{#invalid}} and {{incomplete#}}")
        assert refs == []


class TestValidationContext:
    """Tests for ValidationContext."""

    def test_node_map_lookup(self):
        ctx = ValidationContext(
            nodes=[
                {"id": "start", "type": "start"},
                {"id": "llm_1", "type": "llm"},
            ]
        )
        assert ctx.get_node("start") == {"id": "start", "type": "start"}
        assert ctx.get_node("nonexistent") is None

    def test_model_set(self):
        ctx = ValidationContext(
            available_models=[
                {"provider": "openai", "model": "gpt-4"},
                {"provider": "anthropic", "model": "claude-3"},
            ]
        )
        assert ctx.has_model("openai", "gpt-4") is True
        assert ctx.has_model("anthropic", "claude-3") is True
        assert ctx.has_model("openai", "gpt-3.5") is False

    def test_tool_set(self):
        ctx = ValidationContext(
            available_tools=[
                {"provider_id": "google", "tool_key": "search", "is_team_authorization": True},
                {"provider_id": "slack", "tool_key": "send_message", "is_team_authorization": False},
            ]
        )
        assert ctx.has_tool("google/search") is True
        assert ctx.has_tool("search") is True
        assert ctx.is_tool_configured("google/search") is True
        assert ctx.is_tool_configured("slack/send_message") is False

    def test_upstream_downstream_nodes(self):
        ctx = ValidationContext(
            nodes=[
                {"id": "start", "type": "start"},
                {"id": "llm", "type": "llm"},
                {"id": "end", "type": "end"},
            ],
            edges=[
                {"source": "start", "target": "llm"},
                {"source": "llm", "target": "end"},
            ],
        )
        assert ctx.get_upstream_nodes("llm") == ["start"]
        assert ctx.get_downstream_nodes("llm") == ["end"]


class TestStructureRules:
    """Tests for structure validation rules."""

    def test_llm_missing_prompt_template(self):
        ctx = ValidationContext(
            nodes=[{"id": "llm_1", "type": "llm", "config": {}}]
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        assert result.has_errors
        errors = [e for e in result.all_errors if e.rule_id == "llm.prompt_template.required"]
        assert len(errors) == 1
        assert errors[0].is_fixable is True

    def test_llm_with_prompt_template_passes(self):
        ctx = ValidationContext(
            nodes=[
                {
                    "id": "llm_1",
                    "type": "llm",
                    "config": {
                        "prompt_template": [
                            {"role": "system", "text": "You are helpful"},
                            {"role": "user", "text": "Hello"},
                        ]
                    },
                }
            ]
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        # No prompt_template errors
        errors = [e for e in result.all_errors if "prompt_template" in e.rule_id]
        assert len(errors) == 0

    def test_http_request_missing_url(self):
        ctx = ValidationContext(
            nodes=[{"id": "http_1", "type": "http-request", "config": {}}]
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        errors = [e for e in result.all_errors if "http.url" in e.rule_id]
        assert len(errors) == 1
        assert errors[0].is_fixable is True

    def test_http_request_placeholder_url(self):
        ctx = ValidationContext(
            nodes=[
                {
                    "id": "http_1",
                    "type": "http-request",
                    "config": {"url": "PLEASE_SELECT_YOUR_URL", "method": "GET"},
                }
            ]
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        errors = [e for e in result.all_errors if "placeholder" in e.rule_id]
        assert len(errors) == 1

    def test_code_node_missing_fields(self):
        ctx = ValidationContext(
            nodes=[{"id": "code_1", "type": "code", "config": {}}]
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        error_rules = {e.rule_id for e in result.all_errors}
        assert "code.code.required" in error_rules
        assert "code.language.required" in error_rules

    def test_knowledge_retrieval_missing_dataset(self):
        ctx = ValidationContext(
            nodes=[{"id": "kb_1", "type": "knowledge-retrieval", "config": {}}]
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        errors = [e for e in result.all_errors if "knowledge.dataset" in e.rule_id]
        assert len(errors) == 1
        assert errors[0].is_fixable is False  # User must configure


class TestSemanticRules:
    """Tests for semantic validation rules."""

    def test_valid_variable_reference(self):
        ctx = ValidationContext(
            nodes=[
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "llm_1",
                    "type": "llm",
                    "config": {
                        "prompt_template": [
                            {"role": "user", "text": "Process: {{#start.query#}}"}
                        ]
                    },
                },
            ]
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        # No variable reference errors
        errors = [e for e in result.all_errors if "variable.ref" in e.rule_id]
        assert len(errors) == 0

    def test_invalid_variable_reference(self):
        ctx = ValidationContext(
            nodes=[
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "llm_1",
                    "type": "llm",
                    "config": {
                        "prompt_template": [
                            {"role": "user", "text": "Process: {{#nonexistent.field#}}"}
                        ]
                    },
                },
            ]
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        errors = [e for e in result.all_errors if "variable.ref" in e.rule_id]
        assert len(errors) == 1
        assert "nonexistent" in errors[0].message

    def test_edge_validation(self):
        ctx = ValidationContext(
            nodes=[
                {"id": "start", "type": "start", "config": {}},
                {"id": "end", "type": "end", "config": {}},
            ],
            edges=[
                {"source": "start", "target": "end"},
                {"source": "nonexistent", "target": "end"},
            ],
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        errors = [e for e in result.all_errors if "edge" in e.rule_id]
        assert len(errors) == 1
        assert "nonexistent" in errors[0].message


class TestReferenceRules:
    """Tests for reference validation rules (models, tools)."""

    def test_llm_missing_model_with_available(self):
        ctx = ValidationContext(
            nodes=[
                {
                    "id": "llm_1",
                    "type": "llm",
                    "config": {"prompt_template": [{"role": "user", "text": "Hi"}]},
                }
            ],
            available_models=[{"provider": "openai", "model": "gpt-4"}],
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        errors = [e for e in result.all_errors if e.rule_id == "model.required"]
        assert len(errors) == 1
        assert errors[0].is_fixable is True

    def test_llm_missing_model_no_available(self):
        ctx = ValidationContext(
            nodes=[
                {
                    "id": "llm_1",
                    "type": "llm",
                    "config": {"prompt_template": [{"role": "user", "text": "Hi"}]},
                }
            ],
            available_models=[],  # No models available
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        errors = [e for e in result.all_errors if e.rule_id == "model.no_available"]
        assert len(errors) == 1
        assert errors[0].is_fixable is False

    def test_llm_with_valid_model(self):
        ctx = ValidationContext(
            nodes=[
                {
                    "id": "llm_1",
                    "type": "llm",
                    "config": {
                        "prompt_template": [{"role": "user", "text": "Hi"}],
                        "model": {"provider": "openai", "name": "gpt-4"},
                    },
                }
            ],
            available_models=[{"provider": "openai", "model": "gpt-4"}],
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        errors = [e for e in result.all_errors if "model" in e.rule_id]
        assert len(errors) == 0

    def test_llm_with_invalid_model(self):
        ctx = ValidationContext(
            nodes=[
                {
                    "id": "llm_1",
                    "type": "llm",
                    "config": {
                        "prompt_template": [{"role": "user", "text": "Hi"}],
                        "model": {"provider": "openai", "name": "gpt-99"},
                    },
                }
            ],
            available_models=[{"provider": "openai", "model": "gpt-4"}],
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        errors = [e for e in result.all_errors if e.rule_id == "model.not_found"]
        assert len(errors) == 1
        assert errors[0].is_fixable is True

    def test_tool_node_not_found(self):
        ctx = ValidationContext(
            nodes=[
                {
                    "id": "tool_1",
                    "type": "tool",
                    "config": {"tool_key": "nonexistent/tool"},
                }
            ],
            available_tools=[],
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        errors = [e for e in result.all_errors if e.rule_id == "tool.not_found"]
        assert len(errors) == 1

    def test_tool_node_not_configured(self):
        ctx = ValidationContext(
            nodes=[
                {
                    "id": "tool_1",
                    "type": "tool",
                    "config": {"tool_key": "google/search"},
                }
            ],
            available_tools=[
                {"provider_id": "google", "tool_key": "search", "is_team_authorization": False}
            ],
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        errors = [e for e in result.all_errors if e.rule_id == "tool.not_configured"]
        assert len(errors) == 1
        assert errors[0].is_fixable is False


class TestValidationResult:
    """Tests for ValidationResult classification."""

    def test_has_errors(self):
        ctx = ValidationContext(
            nodes=[{"id": "llm_1", "type": "llm", "config": {}}]
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        assert result.has_errors is True
        assert result.is_valid is False

    def test_has_fixable_errors(self):
        ctx = ValidationContext(
            nodes=[
                {
                    "id": "llm_1",
                    "type": "llm",
                    "config": {"prompt_template": [{"role": "user", "text": "Hi"}]},
                }
            ],
            available_models=[{"provider": "openai", "model": "gpt-4"}],
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        assert result.has_fixable_errors is True
        assert len(result.fixable_errors) > 0

    def test_get_fixable_by_node(self):
        ctx = ValidationContext(
            nodes=[
                {"id": "llm_1", "type": "llm", "config": {}},
                {"id": "http_1", "type": "http-request", "config": {}},
            ]
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        by_node = result.get_fixable_by_node()
        assert "llm_1" in by_node
        assert "http_1" in by_node

    def test_to_dict(self):
        ctx = ValidationContext(
            nodes=[{"id": "llm_1", "type": "llm", "config": {}}]
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        d = result.to_dict()
        assert "fixable" in d
        assert "user_required" in d
        assert "warnings" in d
        assert "all_warnings" in d
        assert "stats" in d


class TestIntegration:
    """Integration tests for the full validation pipeline."""

    def test_complete_workflow_validation(self):
        """Test validation of a complete workflow."""
        ctx = ValidationContext(
            nodes=[
                {
                    "id": "start",
                    "type": "start",
                    "config": {"variables": [{"variable": "query", "type": "text-input"}]},
                },
                {
                    "id": "llm_1",
                    "type": "llm",
                    "config": {
                        "model": {"provider": "openai", "name": "gpt-4"},
                        "prompt_template": [{"role": "user", "text": "{{#start.query#}}"}],
                    },
                },
                {
                    "id": "end",
                    "type": "end",
                    "config": {"outputs": [{"variable": "result", "value_selector": ["llm_1", "text"]}]},
                },
            ],
            edges=[
                {"source": "start", "target": "llm_1"},
                {"source": "llm_1", "target": "end"},
            ],
            available_models=[{"provider": "openai", "model": "gpt-4"}],
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        # Should have no errors
        assert result.is_valid is True
        assert len(result.fixable_errors) == 0
        assert len(result.user_required_errors) == 0

    def test_workflow_with_multiple_errors(self):
        """Test workflow with multiple types of errors."""
        ctx = ValidationContext(
            nodes=[
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "llm_1",
                    "type": "llm",
                    "config": {},  # Missing prompt_template and model
                },
                {
                    "id": "kb_1",
                    "type": "knowledge-retrieval",
                    "config": {"dataset_ids": ["PLEASE_SELECT_YOUR_DATASET"]},
                },
                {"id": "end", "type": "end", "config": {}},
            ],
            available_models=[{"provider": "openai", "model": "gpt-4"}],
        )
        engine = ValidationEngine()
        result = engine.validate(ctx)

        # Should have multiple errors
        assert result.has_errors is True
        assert len(result.fixable_errors) >= 2  # model, prompt_template
        assert len(result.user_required_errors) >= 1  # dataset placeholder

        # Check stats
        assert result.stats["total_nodes"] == 4
        assert result.stats["total_errors"] >= 3



