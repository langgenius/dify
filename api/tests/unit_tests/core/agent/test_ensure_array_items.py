"""Tests for BaseAgentRunner._ensure_array_items.

OpenAI's function-calling API requires every ``"type": "array"`` node
in a JSON Schema to carry an ``"items"`` field.  These tests verify
that the helper method adds a safe default where it is missing and
leaves well-formed schemas untouched.
"""

import pytest

from core.agent.base_agent_runner import BaseAgentRunner


class TestEnsureArrayItems:
    """Unit tests for _ensure_array_items."""

    # ------------------------------------------------------------------
    # Schemas that should be returned unchanged
    # ------------------------------------------------------------------

    def test_string_property_unchanged(self):
        schema = {"type": "string", "description": "a name"}
        result = BaseAgentRunner._ensure_array_items(schema)
        assert result == schema

    def test_object_with_no_arrays_unchanged(self):
        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "age": {"type": "number"},
            },
        }
        result = BaseAgentRunner._ensure_array_items(schema)
        assert result == schema

    def test_array_with_items_unchanged(self):
        schema = {"type": "array", "items": {"type": "integer"}}
        result = BaseAgentRunner._ensure_array_items(schema)
        assert result == schema

    def test_non_dict_input_returned_as_is(self):
        assert BaseAgentRunner._ensure_array_items("not a dict") == "not a dict"  # type: ignore[arg-type]

    # ------------------------------------------------------------------
    # Schemas that need "items" added
    # ------------------------------------------------------------------

    def test_array_without_items_gets_default(self):
        schema = {"type": "array", "description": "list of URLs"}
        result = BaseAgentRunner._ensure_array_items(schema)
        assert result["items"] == {"type": "string"}
        assert result["description"] == "list of URLs"

    def test_original_dict_is_not_mutated(self):
        schema = {"type": "array", "description": "tags"}
        BaseAgentRunner._ensure_array_items(schema)
        assert "items" not in schema, "original dict must not be mutated"

    # ------------------------------------------------------------------
    # Nested schemas
    # ------------------------------------------------------------------

    def test_nested_array_in_object_properties(self):
        schema = {
            "type": "object",
            "properties": {
                "ids": {"type": "array"},  # missing items
                "name": {"type": "string"},
            },
        }
        result = BaseAgentRunner._ensure_array_items(schema)
        assert result["properties"]["ids"]["items"] == {"type": "string"}
        assert result["properties"]["name"] == {"type": "string"}

    def test_nested_array_inside_array_items(self):
        schema = {
            "type": "array",
            "items": {
                "type": "array",  # nested array missing items
            },
        }
        result = BaseAgentRunner._ensure_array_items(schema)
        assert result["items"]["items"] == {"type": "string"}

    def test_deeply_nested_array_in_object_in_array(self):
        schema = {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tags": {"type": "array"},  # missing items
                },
            },
        }
        result = BaseAgentRunner._ensure_array_items(schema)
        assert result["items"]["properties"]["tags"]["items"] == {"type": "string"}

    def test_already_correct_nested_schema_unchanged(self):
        schema = {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "values": {"type": "array", "items": {"type": "number"}},
                },
            },
        }
        result = BaseAgentRunner._ensure_array_items(schema)
        assert result == schema
