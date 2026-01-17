"""
Tests for node schemas validation.

Ensures that the node configuration stays in sync with registered node types.
"""

from core.workflow.generator.config.node_schemas import (
    get_builtin_node_schemas,
    validate_node_schemas,
)


class TestNodeSchemasValidation:
    """Tests for node schema validation utilities."""

    def test_validate_node_schemas_returns_no_warnings(self):
        """Ensure all registered node types have corresponding schemas."""
        warnings = validate_node_schemas()
        # If this test fails, it means a new node type was added but
        # no schema was defined for it in node_schemas.py
        assert len(warnings) == 0, (
            f"Missing schemas for node types: {warnings}. "
            "Please add schemas for these node types in node_schemas.py "
            "or add them to _INTERNAL_NODE_TYPES if they don't need schemas."
        )

    def test_builtin_node_schemas_not_empty(self):
        """Ensure BUILTIN_NODE_SCHEMAS contains expected node types."""
        # get_builtin_node_schemas() includes dynamic schemas
        all_schemas = get_builtin_node_schemas()
        assert len(all_schemas) > 0
        # Core node types should always be present
        expected_types = ["llm", "code", "http-request", "if-else"]
        for node_type in expected_types:
            assert node_type in all_schemas, f"Missing schema for core node type: {node_type}"

    def test_schema_structure(self):
        """Ensure each schema has required fields."""
        all_schemas = get_builtin_node_schemas()
        for node_type, schema in all_schemas.items():
            assert "description" in schema, f"Missing 'description' in schema for {node_type}"
            # 'parameters' is optional but if present should be a dict
            if "parameters" in schema:
                assert isinstance(schema["parameters"], dict), (
                    f"'parameters' in schema for {node_type} should be a dict"
                )


class TestNodeSchemasMerged:
    """Tests to verify the merged configuration works correctly."""

    def test_fallback_rules_available(self):
        """Ensure FALLBACK_RULES is available from node_schemas."""
        from core.workflow.generator.config.node_schemas import FALLBACK_RULES

        assert len(FALLBACK_RULES) > 0
        assert "http-request" in FALLBACK_RULES
        assert "code" in FALLBACK_RULES
        assert "llm" in FALLBACK_RULES

    def test_node_type_aliases_available(self):
        """Ensure NODE_TYPE_ALIASES is available from node_schemas."""
        from core.workflow.generator.config.node_schemas import NODE_TYPE_ALIASES

        assert len(NODE_TYPE_ALIASES) > 0
        assert NODE_TYPE_ALIASES.get("gpt") == "llm"
        assert NODE_TYPE_ALIASES.get("api") == "http-request"

    def test_field_name_corrections_available(self):
        """Ensure FIELD_NAME_CORRECTIONS is available from node_schemas."""
        from core.workflow.generator.config.node_schemas import (
            FIELD_NAME_CORRECTIONS,
            get_corrected_field_name,
        )

        assert len(FIELD_NAME_CORRECTIONS) > 0
        # Test the helper function
        assert get_corrected_field_name("http-request", "text") == "body"
        assert get_corrected_field_name("llm", "response") == "text"
        assert get_corrected_field_name("code", "unknown") == "unknown"

    def test_config_init_exports(self):
        """Ensure config __init__.py exports all needed symbols."""
        from core.workflow.generator.config import (
            BUILTIN_NODE_SCHEMAS,
            FALLBACK_RULES,
            FIELD_NAME_CORRECTIONS,
            NODE_TYPE_ALIASES,
            get_corrected_field_name,
            validate_node_schemas,
        )

        # Just verify imports work
        assert BUILTIN_NODE_SCHEMAS is not None
        assert FALLBACK_RULES is not None
        assert FIELD_NAME_CORRECTIONS is not None
        assert NODE_TYPE_ALIASES is not None
        assert callable(get_corrected_field_name)
        assert callable(validate_node_schemas)
