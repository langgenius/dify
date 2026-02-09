"""
Unit tests for the Vibe Workflow Validator.

Tests cover:
- Basic validation function
- User-friendly validation hints
- Edge cases and error handling
"""

from core.workflow.generator.utils.workflow_validator import ValidationHint, WorkflowValidator


class TestValidationHint:
    """Tests for ValidationHint dataclass."""

    def test_hint_creation(self):
        """Test creating a validation hint."""
        hint = ValidationHint(
            node_id="llm_1",
            field="model",
            message="Model is not configured",
            severity="error",
        )
        assert hint.node_id == "llm_1"
        assert hint.field == "model"
        assert hint.message == "Model is not configured"
        assert hint.severity == "error"

    def test_hint_with_suggestion(self):
        """Test hint with suggestion."""
        hint = ValidationHint(
            node_id="http_1",
            field="url",
            message="URL is required",
            severity="error",
            suggestion="Add a valid URL like https://api.example.com",
        )
        assert hint.suggestion is not None


class TestWorkflowValidatorBasic:
    """Tests for basic validation scenarios."""

    def test_empty_workflow_is_valid(self):
        """Test empty workflow passes validation."""
        workflow_data = {"nodes": [], "edges": []}
        is_valid, hints = WorkflowValidator.validate(workflow_data, [])

        # Empty but valid structure
        assert is_valid is True
        assert len(hints) == 0

    def test_minimal_valid_workflow(self):
        """Test minimal Start → End workflow."""
        workflow_data = {
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {"id": "end", "type": "end", "config": {}},
            ],
            "edges": [{"source": "start", "target": "end"}],
        }
        is_valid, hints = WorkflowValidator.validate(workflow_data, [])

        assert is_valid is True

    def test_complete_workflow_with_llm(self):
        """Test complete workflow with LLM node."""
        workflow_data = {
            "nodes": [
                {"id": "start", "type": "start", "config": {"variables": []}},
                {
                    "id": "llm",
                    "type": "llm",
                    "config": {
                        "model": {"provider": "openai", "name": "gpt-4"},
                        "prompt_template": [{"role": "user", "text": "Hello"}],
                    },
                },
                {"id": "end", "type": "end", "config": {"outputs": []}},
            ],
            "edges": [
                {"source": "start", "target": "llm"},
                {"source": "llm", "target": "end"},
            ],
        }
        is_valid, hints = WorkflowValidator.validate(workflow_data, [])

        # Should pass with no critical errors
        errors = [h for h in hints if h.severity == "error"]
        assert len(errors) == 0


class TestVariableReferenceValidation:
    """Tests for variable reference validation."""

    def test_valid_variable_reference(self):
        """Test valid variable reference passes."""
        workflow_data = {
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "llm",
                    "type": "llm",
                    "config": {"prompt_template": [{"role": "user", "text": "Query: {{#start.query#}}"}]},
                },
            ],
            "edges": [{"source": "start", "target": "llm"}],
        }
        is_valid, hints = WorkflowValidator.validate(workflow_data, [])

        ref_errors = [h for h in hints if "reference" in h.message.lower()]
        assert len(ref_errors) == 0

    def test_invalid_variable_reference(self):
        """Test invalid variable reference generates hint."""
        workflow_data = {
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "llm",
                    "type": "llm",
                    "config": {"prompt_template": [{"role": "user", "text": "{{#nonexistent.field#}}"}]},
                },
            ],
            "edges": [{"source": "start", "target": "llm"}],
        }
        is_valid, hints = WorkflowValidator.validate(workflow_data, [])

        # Should have a hint about invalid reference
        ref_hints = [h for h in hints if "nonexistent" in h.message or "reference" in h.message.lower()]
        assert len(ref_hints) >= 1


class TestEdgeValidation:
    """Tests for edge validation."""

    def test_edge_with_invalid_source(self):
        """Test edge with non-existent source generates hint."""
        workflow_data = {
            "nodes": [{"id": "end", "type": "end", "config": {}}],
            "edges": [{"source": "nonexistent", "target": "end"}],
        }
        is_valid, hints = WorkflowValidator.validate(workflow_data, [])

        # Should have hint about invalid edge
        edge_hints = [h for h in hints if "edge" in h.message.lower() or "source" in h.message.lower()]
        assert len(edge_hints) >= 1

    def test_edge_with_invalid_target(self):
        """Test edge with non-existent target generates hint."""
        workflow_data = {
            "nodes": [{"id": "start", "type": "start", "config": {}}],
            "edges": [{"source": "start", "target": "nonexistent"}],
        }
        is_valid, hints = WorkflowValidator.validate(workflow_data, [])

        edge_hints = [h for h in hints if "edge" in h.message.lower() or "target" in h.message.lower()]
        assert len(edge_hints) >= 1


class TestToolValidation:
    """Tests for tool node validation."""

    def test_tool_node_found_in_available(self):
        """Test tool node that exists in available tools."""
        workflow_data = {
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "tool1",
                    "type": "tool",
                    "config": {"tool_key": "google/search"},
                },
                {"id": "end", "type": "end", "config": {}},
            ],
            "edges": [{"source": "start", "target": "tool1"}, {"source": "tool1", "target": "end"}],
        }
        available_tools = [{"provider_id": "google", "tool_key": "search", "is_team_authorization": True}]
        is_valid, hints = WorkflowValidator.validate(workflow_data, available_tools)

        tool_errors = [h for h in hints if h.severity == "error" and "tool" in h.message.lower()]
        assert len(tool_errors) == 0

    def test_tool_node_not_found(self):
        """Test tool node not in available tools generates hint."""
        workflow_data = {
            "nodes": [
                {
                    "id": "tool1",
                    "type": "tool",
                    "config": {"tool_key": "unknown/tool"},
                }
            ],
            "edges": [],
        }
        available_tools = []
        is_valid, hints = WorkflowValidator.validate(workflow_data, available_tools)

        tool_hints = [h for h in hints if "tool" in h.message.lower()]
        assert len(tool_hints) >= 1


class TestQuestionClassifierValidation:
    """Tests for question-classifier node validation."""

    def test_question_classifier_with_classes(self):
        """Test question-classifier with valid classes."""
        workflow_data = {
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "classifier",
                    "type": "question-classifier",
                    "config": {
                        "classes": [
                            {"id": "class1", "name": "Class 1"},
                            {"id": "class2", "name": "Class 2"},
                        ],
                        "model": {"provider": "openai", "name": "gpt-4", "mode": "chat"},
                    },
                },
                {"id": "h1", "type": "llm", "config": {}},
                {"id": "h2", "type": "llm", "config": {}},
                {"id": "end", "type": "end", "config": {}},
            ],
            "edges": [
                {"source": "start", "target": "classifier"},
                {"source": "classifier", "sourceHandle": "class1", "target": "h1"},
                {"source": "classifier", "sourceHandle": "class2", "target": "h2"},
                {"source": "h1", "target": "end"},
                {"source": "h2", "target": "end"},
            ],
        }
        available_models = [{"provider": "openai", "model": "gpt-4", "mode": "chat"}]
        is_valid, hints = WorkflowValidator.validate(workflow_data, [], available_models=available_models)

        class_errors = [h for h in hints if "class" in h.message.lower() and h.severity == "error"]
        assert len(class_errors) == 0

    def test_question_classifier_missing_classes(self):
        """Test question-classifier without classes generates hint."""
        workflow_data = {
            "nodes": [
                {
                    "id": "classifier",
                    "type": "question-classifier",
                    "config": {"model": {"provider": "openai", "name": "gpt-4", "mode": "chat"}},
                }
            ],
            "edges": [],
        }
        available_models = [{"provider": "openai", "model": "gpt-4", "mode": "chat"}]
        is_valid, hints = WorkflowValidator.validate(workflow_data, [], available_models=available_models)

        # Should have hint about missing classes
        class_hints = [h for h in hints if "class" in h.message.lower()]
        assert len(class_hints) >= 1


class TestHttpRequestValidation:
    """Tests for HTTP request node validation."""

    def test_http_request_with_url(self):
        """Test HTTP request with valid URL."""
        workflow_data = {
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "http",
                    "type": "http-request",
                    "config": {"url": "https://api.example.com", "method": "GET"},
                },
                {"id": "end", "type": "end", "config": {}},
            ],
            "edges": [{"source": "start", "target": "http"}, {"source": "http", "target": "end"}],
        }
        is_valid, hints = WorkflowValidator.validate(workflow_data, [])

        url_errors = [h for h in hints if "url" in h.message.lower() and h.severity == "error"]
        assert len(url_errors) == 0

    def test_http_request_missing_url(self):
        """Test HTTP request without URL generates hint."""
        workflow_data = {
            "nodes": [
                {
                    "id": "http",
                    "type": "http-request",
                    "config": {"method": "GET"},
                }
            ],
            "edges": [],
        }
        is_valid, hints = WorkflowValidator.validate(workflow_data, [])

        url_hints = [h for h in hints if "url" in h.message.lower()]
        assert len(url_hints) >= 1


class TestParameterExtractorValidation:
    """Tests for parameter-extractor node validation."""

    def test_parameter_extractor_valid_params(self):
        """Test parameter-extractor with valid parameters."""
        workflow_data = {
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "extractor",
                    "type": "parameter-extractor",
                    "config": {
                        "instruction": "Extract info",
                        "parameters": [
                            {
                                "name": "name",
                                "type": "string",
                                "description": "Name",
                                "required": True,
                            }
                        ],
                        "model": {"provider": "openai", "name": "gpt-4", "mode": "chat"},
                    },
                },
                {"id": "end", "type": "end", "config": {}},
            ],
            "edges": [{"source": "start", "target": "extractor"}, {"source": "extractor", "target": "end"}],
        }
        available_models = [{"provider": "openai", "model": "gpt-4", "mode": "chat"}]
        is_valid, hints = WorkflowValidator.validate(workflow_data, [], available_models=available_models)

        errors = [h for h in hints if h.severity == "error"]
        assert len(errors) == 0

    def test_parameter_extractor_missing_required_field(self):
        """Test parameter-extractor missing 'required' field in parameter item."""
        workflow_data = {
            "nodes": [
                {
                    "id": "extractor",
                    "type": "parameter-extractor",
                    "config": {
                        "instruction": "Extract info",
                        "parameters": [
                            {
                                "name": "name",
                                "type": "string",
                                "description": "Name",
                                # Missing 'required'
                            }
                        ],
                        "model": {"provider": "openai", "name": "gpt-4", "mode": "chat"},
                    },
                }
            ],
            "edges": [],
        }
        available_models = [{"provider": "openai", "model": "gpt-4", "mode": "chat"}]
        is_valid, hints = WorkflowValidator.validate(workflow_data, [], available_models=available_models)

        errors = [h for h in hints if "required" in h.message and h.severity == "error"]
        assert len(errors) >= 1
        assert "parameter-extractor" in errors[0].node_type


class TestIfElseValidation:
    """Tests for if-else node validation."""

    def test_if_else_valid_operators(self):
        """Test if-else with valid operators."""
        workflow_data = {
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "ifelse",
                    "type": "if-else",
                    "config": {
                        "cases": [{"case_id": "c1", "conditions": [{"comparison_operator": "≥", "value": "1"}]}]
                    },
                },
                {"id": "t", "type": "llm", "config": {}},
                {"id": "f", "type": "llm", "config": {}},
                {"id": "end", "type": "end", "config": {}},
            ],
            "edges": [
                {"source": "start", "target": "ifelse"},
                {"source": "ifelse", "sourceHandle": "true", "target": "t"},
                {"source": "ifelse", "sourceHandle": "false", "target": "f"},
                {"source": "t", "target": "end"},
                {"source": "f", "target": "end"},
            ],
        }
        is_valid, hints = WorkflowValidator.validate(workflow_data, [])
        errors = [h for h in hints if h.severity == "error"]
        # Filter out LLM model errors if any (available tools/models check might trigger)
        # (actually available_models empty list might trigger model error?
        # No, model config validation skips if model field not present? No, LLM has model config.
        # But logic skips check if key missing? Let's check logic.
        # _check_model_config checks if provider/name match available. If available is empty, it fails.
        # But wait, validate default available_models is None?
        # I should provide mock available_models or ignore model errors.

        # Actually LLM node "config": {} implies missing model config. Rules check if config structure is valid?
        # Let's filter specifically for operator errors.
        operator_errors = [h for h in errors if "operator" in h.message]
        assert len(operator_errors) == 0

    def test_if_else_invalid_operators(self):
        """Test if-else with invalid operators."""
        workflow_data = {
            "nodes": [
                {"id": "start", "type": "start", "config": {}},
                {
                    "id": "ifelse",
                    "type": "if-else",
                    "config": {
                        "cases": [{"case_id": "c1", "conditions": [{"comparison_operator": ">=", "value": "1"}]}]
                    },
                },
                {"id": "t", "type": "llm", "config": {}},
                {"id": "f", "type": "llm", "config": {}},
                {"id": "end", "type": "end", "config": {}},
            ],
            "edges": [
                {"source": "start", "target": "ifelse"},
                {"source": "ifelse", "sourceHandle": "true", "target": "t"},
                {"source": "ifelse", "sourceHandle": "false", "target": "f"},
                {"source": "t", "target": "end"},
                {"source": "f", "target": "end"},
            ],
        }
        is_valid, hints = WorkflowValidator.validate(workflow_data, [])
        operator_errors = [h for h in hints if "operator" in h.message and h.severity == "error"]
        assert len(operator_errors) > 0
        assert "≥" in operator_errors[0].suggestion
