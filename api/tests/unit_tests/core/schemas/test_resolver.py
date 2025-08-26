
import pytest

from core.schemas import resolve_dify_schema_refs
from core.schemas.registry import SchemaRegistry


class TestSchemaResolver:
    """Test cases for schema reference resolution"""

    def setup_method(self):
        """Setup method to initialize test resources"""
        self.registry = SchemaRegistry.default_registry()

    def test_simple_ref_resolution(self):
        """Test resolving a simple $ref to a complete schema"""
        schema_with_ref = {
            "$ref": "https://dify.ai/schemas/v1/qa_structure.json"
        }
        
        resolved = resolve_dify_schema_refs(schema_with_ref)
        
        # Should be resolved to the actual qa_structure schema
        assert resolved["type"] == "object"
        assert resolved["title"] == "Q&A Structure Schema"
        assert "qa_chunks" in resolved["properties"]
        assert resolved["properties"]["qa_chunks"]["type"] == "array"
        
        # Metadata fields should be removed
        assert "$id" not in resolved
        assert "$schema" not in resolved
        assert "version" not in resolved

    def test_nested_object_with_refs(self):
        """Test resolving $refs within nested object structures"""
        nested_schema = {
            "type": "object",
            "properties": {
                "file_data": {
                    "$ref": "https://dify.ai/schemas/v1/file.json"
                },
                "metadata": {
                    "type": "string",
                    "description": "Additional metadata"
                }
            }
        }
        
        resolved = resolve_dify_schema_refs(nested_schema)
        
        # Original structure should be preserved
        assert resolved["type"] == "object"
        assert "metadata" in resolved["properties"]
        assert resolved["properties"]["metadata"]["type"] == "string"
        
        # $ref should be resolved
        file_schema = resolved["properties"]["file_data"]
        assert file_schema["type"] == "object"
        assert file_schema["title"] == "File Schema"
        assert "name" in file_schema["properties"]
        
        # Metadata fields should be removed from resolved schema
        assert "$id" not in file_schema
        assert "$schema" not in file_schema
        assert "version" not in file_schema

    def test_array_items_ref_resolution(self):
        """Test resolving $refs in array items"""
        array_schema = {
            "type": "array",
            "items": {
                "$ref": "https://dify.ai/schemas/v1/general_structure.json"
            },
            "description": "Array of general structures"
        }
        
        resolved = resolve_dify_schema_refs(array_schema)
        
        # Array structure should be preserved
        assert resolved["type"] == "array"
        assert resolved["description"] == "Array of general structures"
        
        # Items $ref should be resolved
        items_schema = resolved["items"]
        assert items_schema["type"] == "array"
        assert items_schema["title"] == "General Structure Schema"

    def test_non_dify_ref_unchanged(self):
        """Test that non-Dify $refs are left unchanged"""
        external_ref_schema = {
            "type": "object",
            "properties": {
                "external_data": {
                    "$ref": "https://example.com/external-schema.json"
                },
                "dify_data": {
                    "$ref": "https://dify.ai/schemas/v1/file.json"
                }
            }
        }
        
        resolved = resolve_dify_schema_refs(external_ref_schema)
        
        # External $ref should remain unchanged
        assert resolved["properties"]["external_data"]["$ref"] == "https://example.com/external-schema.json"
        
        # Dify $ref should be resolved
        assert resolved["properties"]["dify_data"]["type"] == "object"
        assert resolved["properties"]["dify_data"]["title"] == "File Schema"

    def test_no_refs_schema_unchanged(self):
        """Test that schemas without $refs are returned unchanged"""
        simple_schema = {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Name field"
                },
                "items": {
                    "type": "array",
                    "items": {
                        "type": "number"
                    }
                }
            },
            "required": ["name"]
        }
        
        resolved = resolve_dify_schema_refs(simple_schema)
        
        # Should be identical to input
        assert resolved == simple_schema
        assert resolved["type"] == "object"
        assert resolved["properties"]["name"]["type"] == "string"
        assert resolved["properties"]["items"]["items"]["type"] == "number"
        assert resolved["required"] == ["name"]

    def test_recursion_depth_protection(self):
        """Test that excessive recursion depth is prevented"""
        # Create a moderately nested structure
        deep_schema = {"$ref": "https://dify.ai/schemas/v1/qa_structure.json"}
        
        # Wrap it in fewer layers to make the test more reasonable
        for _ in range(2):
            deep_schema = {
                "type": "object",
                "properties": {
                    "nested": deep_schema
                }
            }
        
        # Should handle normal cases fine with reasonable depth
        resolved = resolve_dify_schema_refs(deep_schema, max_depth=25)
        assert resolved is not None
        assert resolved["type"] == "object"
        
        # Should raise error with very low max_depth
        with pytest.raises(RecursionError, match="Maximum recursion depth"):
            resolve_dify_schema_refs(deep_schema, max_depth=5)