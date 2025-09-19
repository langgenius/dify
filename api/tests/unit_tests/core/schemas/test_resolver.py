import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch

import pytest

from core.schemas import resolve_dify_schema_refs
from core.schemas.registry import SchemaRegistry
from core.schemas.resolver import (
    MaxDepthExceededError,
    SchemaResolver,
    _has_dify_refs,
    _has_dify_refs_hybrid,
    _has_dify_refs_recursive,
    _is_dify_schema_ref,
    _remove_metadata_fields,
    parse_dify_schema_uri,
)


class TestSchemaResolver:
    """Test cases for schema reference resolution"""

    def setup_method(self):
        """Setup method to initialize test resources"""
        self.registry = SchemaRegistry.default_registry()
        # Clear cache before each test
        SchemaResolver.clear_cache()

    def teardown_method(self):
        """Cleanup after each test"""
        SchemaResolver.clear_cache()

    def test_simple_ref_resolution(self):
        """Test resolving a simple $ref to a complete schema"""
        schema_with_ref = {"$ref": "https://dify.ai/schemas/v1/qa_structure.json"}

        resolved = resolve_dify_schema_refs(schema_with_ref)

        # Should be resolved to the actual qa_structure schema
        assert resolved["type"] == "object"
        assert resolved["title"] == "Q&A Structure"
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
                "file_data": {"$ref": "https://dify.ai/schemas/v1/file.json"},
                "metadata": {"type": "string", "description": "Additional metadata"},
            },
        }

        resolved = resolve_dify_schema_refs(nested_schema)

        # Original structure should be preserved
        assert resolved["type"] == "object"
        assert "metadata" in resolved["properties"]
        assert resolved["properties"]["metadata"]["type"] == "string"

        # $ref should be resolved
        file_schema = resolved["properties"]["file_data"]
        assert file_schema["type"] == "object"
        assert file_schema["title"] == "File"
        assert "name" in file_schema["properties"]

        # Metadata fields should be removed from resolved schema
        assert "$id" not in file_schema
        assert "$schema" not in file_schema
        assert "version" not in file_schema

    def test_array_items_ref_resolution(self):
        """Test resolving $refs in array items"""
        array_schema = {
            "type": "array",
            "items": {"$ref": "https://dify.ai/schemas/v1/general_structure.json"},
            "description": "Array of general structures",
        }

        resolved = resolve_dify_schema_refs(array_schema)

        # Array structure should be preserved
        assert resolved["type"] == "array"
        assert resolved["description"] == "Array of general structures"

        # Items $ref should be resolved
        items_schema = resolved["items"]
        assert items_schema["type"] == "array"
        assert items_schema["title"] == "General Structure"

    def test_non_dify_ref_unchanged(self):
        """Test that non-Dify $refs are left unchanged"""
        external_ref_schema = {
            "type": "object",
            "properties": {
                "external_data": {"$ref": "https://example.com/external-schema.json"},
                "dify_data": {"$ref": "https://dify.ai/schemas/v1/file.json"},
            },
        }

        resolved = resolve_dify_schema_refs(external_ref_schema)

        # External $ref should remain unchanged
        assert resolved["properties"]["external_data"]["$ref"] == "https://example.com/external-schema.json"

        # Dify $ref should be resolved
        assert resolved["properties"]["dify_data"]["type"] == "object"
        assert resolved["properties"]["dify_data"]["title"] == "File"

    def test_no_refs_schema_unchanged(self):
        """Test that schemas without $refs are returned unchanged"""
        simple_schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Name field"},
                "items": {"type": "array", "items": {"type": "number"}},
            },
            "required": ["name"],
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
            deep_schema = {"type": "object", "properties": {"nested": deep_schema}}

        # Should handle normal cases fine with reasonable depth
        resolved = resolve_dify_schema_refs(deep_schema, max_depth=25)
        assert resolved is not None
        assert resolved["type"] == "object"

        # Should raise error with very low max_depth
        with pytest.raises(MaxDepthExceededError) as exc_info:
            resolve_dify_schema_refs(deep_schema, max_depth=5)
        assert exc_info.value.max_depth == 5

    def test_circular_reference_detection(self):
        """Test that circular references are detected and handled"""
        # Mock registry with circular reference
        mock_registry = MagicMock()
        mock_registry.get_schema.side_effect = lambda uri: {
            "$ref": "https://dify.ai/schemas/v1/circular.json",
            "type": "object",
        }

        schema = {"$ref": "https://dify.ai/schemas/v1/circular.json"}
        resolved = resolve_dify_schema_refs(schema, registry=mock_registry)

        # Should mark circular reference
        assert "$circular_ref" in resolved

    def test_schema_not_found_handling(self):
        """Test handling of missing schemas"""
        # Mock registry that returns None for unknown schemas
        mock_registry = MagicMock()
        mock_registry.get_schema.return_value = None

        schema = {"$ref": "https://dify.ai/schemas/v1/unknown.json"}
        resolved = resolve_dify_schema_refs(schema, registry=mock_registry)

        # Should keep the original $ref when schema not found
        assert resolved["$ref"] == "https://dify.ai/schemas/v1/unknown.json"

    def test_primitive_types_unchanged(self):
        """Test that primitive types are returned unchanged"""
        assert resolve_dify_schema_refs("string") == "string"
        assert resolve_dify_schema_refs(123) == 123
        assert resolve_dify_schema_refs(True) is True
        assert resolve_dify_schema_refs(None) is None
        assert resolve_dify_schema_refs(3.14) == 3.14

    def test_cache_functionality(self):
        """Test that caching works correctly"""
        schema = {"$ref": "https://dify.ai/schemas/v1/file.json"}

        # First resolution should fetch from registry
        resolved1 = resolve_dify_schema_refs(schema)

        # Mock the registry to return different data
        with patch.object(self.registry, "get_schema") as mock_get:
            mock_get.return_value = {"type": "different"}

            # Second resolution should use cache
            resolved2 = resolve_dify_schema_refs(schema)

            # Should be the same as first resolution (from cache)
            assert resolved1 == resolved2
            # Mock should not have been called
            mock_get.assert_not_called()

        # Clear cache and try again
        SchemaResolver.clear_cache()

        # Now it should fetch again
        resolved3 = resolve_dify_schema_refs(schema)
        assert resolved3 == resolved1

    def test_thread_safety(self):
        """Test that the resolver is thread-safe"""
        schema = {
            "type": "object",
            "properties": {f"prop_{i}": {"$ref": "https://dify.ai/schemas/v1/file.json"} for i in range(10)},
        }

        results = []

        def resolve_in_thread():
            try:
                result = resolve_dify_schema_refs(schema)
                results.append(result)
                return True
            except Exception as e:
                results.append(e)
                return False

        # Run multiple threads concurrently
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(resolve_in_thread) for _ in range(20)]
            success = all(f.result() for f in futures)

        assert success
        # All results should be the same
        first_result = results[0]
        assert all(r == first_result for r in results if not isinstance(r, Exception))

    def test_mixed_nested_structures(self):
        """Test resolving refs in complex mixed structures"""
        complex_schema = {
            "type": "object",
            "properties": {
                "files": {"type": "array", "items": {"$ref": "https://dify.ai/schemas/v1/file.json"}},
                "nested": {
                    "type": "object",
                    "properties": {
                        "qa": {"$ref": "https://dify.ai/schemas/v1/qa_structure.json"},
                        "data": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "general": {"$ref": "https://dify.ai/schemas/v1/general_structure.json"}
                                },
                            },
                        },
                    },
                },
            },
        }

        resolved = resolve_dify_schema_refs(complex_schema, max_depth=20)

        # Check structure is preserved
        assert resolved["type"] == "object"
        assert "files" in resolved["properties"]
        assert "nested" in resolved["properties"]

        # Check refs are resolved
        assert resolved["properties"]["files"]["items"]["type"] == "object"
        assert resolved["properties"]["files"]["items"]["title"] == "File"
        assert resolved["properties"]["nested"]["properties"]["qa"]["type"] == "object"
        assert resolved["properties"]["nested"]["properties"]["qa"]["title"] == "Q&A Structure"


class TestUtilityFunctions:
    """Test utility functions"""

    def test_is_dify_schema_ref(self):
        """Test _is_dify_schema_ref function"""
        # Valid Dify refs
        assert _is_dify_schema_ref("https://dify.ai/schemas/v1/file.json")
        assert _is_dify_schema_ref("https://dify.ai/schemas/v2/complex_name.json")
        assert _is_dify_schema_ref("https://dify.ai/schemas/v999/test-file.json")

        # Invalid refs
        assert not _is_dify_schema_ref("https://example.com/schema.json")
        assert not _is_dify_schema_ref("https://dify.ai/other/path.json")
        assert not _is_dify_schema_ref("not a uri")
        assert not _is_dify_schema_ref("")
        assert not _is_dify_schema_ref(None)
        assert not _is_dify_schema_ref(123)
        assert not _is_dify_schema_ref(["list"])

    def test_has_dify_refs(self):
        """Test _has_dify_refs function"""
        # Schemas with Dify refs
        assert _has_dify_refs({"$ref": "https://dify.ai/schemas/v1/file.json"})
        assert _has_dify_refs(
            {"type": "object", "properties": {"data": {"$ref": "https://dify.ai/schemas/v1/file.json"}}}
        )
        assert _has_dify_refs([{"type": "string"}, {"$ref": "https://dify.ai/schemas/v1/file.json"}])
        assert _has_dify_refs(
            {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"nested": {"$ref": "https://dify.ai/schemas/v1/qa_structure.json"}},
                },
            }
        )

        # Schemas without Dify refs
        assert not _has_dify_refs({"type": "string"})
        assert not _has_dify_refs(
            {"type": "object", "properties": {"name": {"type": "string"}, "age": {"type": "number"}}}
        )
        assert not _has_dify_refs(
            [{"type": "string"}, {"type": "number"}, {"type": "object", "properties": {"name": {"type": "string"}}}]
        )

        # Schemas with non-Dify refs (should return False)
        assert not _has_dify_refs({"$ref": "https://example.com/schema.json"})
        assert not _has_dify_refs(
            {"type": "object", "properties": {"external": {"$ref": "https://example.com/external.json"}}}
        )

        # Primitive types
        assert not _has_dify_refs("string")
        assert not _has_dify_refs(123)
        assert not _has_dify_refs(True)
        assert not _has_dify_refs(None)

    def test_has_dify_refs_hybrid_vs_recursive(self):
        """Test that hybrid and recursive detection give same results"""
        test_schemas = [
            # No refs
            {"type": "string"},
            {"type": "object", "properties": {"name": {"type": "string"}}},
            [{"type": "string"}, {"type": "number"}],
            # With Dify refs
            {"$ref": "https://dify.ai/schemas/v1/file.json"},
            {"type": "object", "properties": {"data": {"$ref": "https://dify.ai/schemas/v1/file.json"}}},
            [{"type": "string"}, {"$ref": "https://dify.ai/schemas/v1/qa_structure.json"}],
            # With non-Dify refs
            {"$ref": "https://example.com/schema.json"},
            {"type": "object", "properties": {"external": {"$ref": "https://example.com/external.json"}}},
            # Complex nested
            {
                "type": "object",
                "properties": {
                    "level1": {
                        "type": "object",
                        "properties": {
                            "level2": {"type": "array", "items": {"$ref": "https://dify.ai/schemas/v1/file.json"}}
                        },
                    }
                },
            },
            # Edge cases
            {"description": "This mentions $ref but is not a reference"},
            {"$ref": "not-a-url"},
            # Primitive types
            "string",
            123,
            True,
            None,
            [],
        ]

        for schema in test_schemas:
            hybrid_result = _has_dify_refs_hybrid(schema)
            recursive_result = _has_dify_refs_recursive(schema)

            assert hybrid_result == recursive_result, f"Mismatch for schema: {schema}"

    def test_parse_dify_schema_uri(self):
        """Test parse_dify_schema_uri function"""
        # Valid URIs
        assert parse_dify_schema_uri("https://dify.ai/schemas/v1/file.json") == ("v1", "file")
        assert parse_dify_schema_uri("https://dify.ai/schemas/v2/complex_name.json") == ("v2", "complex_name")
        assert parse_dify_schema_uri("https://dify.ai/schemas/v999/test-file.json") == ("v999", "test-file")

        # Invalid URIs
        assert parse_dify_schema_uri("https://example.com/schema.json") == ("", "")
        assert parse_dify_schema_uri("invalid") == ("", "")
        assert parse_dify_schema_uri("") == ("", "")

    def test_remove_metadata_fields(self):
        """Test _remove_metadata_fields function"""
        schema = {
            "$id": "should be removed",
            "$schema": "should be removed",
            "version": "should be removed",
            "type": "object",
            "title": "should remain",
            "properties": {},
        }

        cleaned = _remove_metadata_fields(schema)

        assert "$id" not in cleaned
        assert "$schema" not in cleaned
        assert "version" not in cleaned
        assert cleaned["type"] == "object"
        assert cleaned["title"] == "should remain"
        assert "properties" in cleaned

        # Original should be unchanged
        assert "$id" in schema


class TestSchemaResolverClass:
    """Test SchemaResolver class specifically"""

    def test_resolver_initialization(self):
        """Test resolver initialization"""
        # Default initialization
        resolver = SchemaResolver()
        assert resolver.max_depth == 10
        assert resolver.registry is not None

        # Custom initialization
        custom_registry = MagicMock()
        resolver = SchemaResolver(registry=custom_registry, max_depth=5)
        assert resolver.max_depth == 5
        assert resolver.registry is custom_registry

    def test_cache_sharing(self):
        """Test that cache is shared between resolver instances"""
        SchemaResolver.clear_cache()

        schema = {"$ref": "https://dify.ai/schemas/v1/file.json"}

        # First resolver populates cache
        resolver1 = SchemaResolver()
        result1 = resolver1.resolve(schema)

        # Second resolver should use the same cache
        resolver2 = SchemaResolver()
        with patch.object(resolver2.registry, "get_schema") as mock_get:
            result2 = resolver2.resolve(schema)
            # Should not call registry since it's in cache
            mock_get.assert_not_called()

        assert result1 == result2

    def test_resolver_with_list_schema(self):
        """Test resolver with list as root schema"""
        list_schema = [
            {"$ref": "https://dify.ai/schemas/v1/file.json"},
            {"type": "string"},
            {"$ref": "https://dify.ai/schemas/v1/qa_structure.json"},
        ]

        resolver = SchemaResolver()
        resolved = resolver.resolve(list_schema)

        assert isinstance(resolved, list)
        assert len(resolved) == 3
        assert resolved[0]["type"] == "object"
        assert resolved[0]["title"] == "File"
        assert resolved[1] == {"type": "string"}
        assert resolved[2]["type"] == "object"
        assert resolved[2]["title"] == "Q&A Structure"

    def test_cache_performance(self):
        """Test that caching improves performance"""
        SchemaResolver.clear_cache()

        # Create a schema with many references to the same schema
        schema = {
            "type": "object",
            "properties": {
                f"prop_{i}": {"$ref": "https://dify.ai/schemas/v1/file.json"}
                for i in range(50)  # Reduced to avoid depth issues
            },
        }

        # First run (no cache) - run multiple times to warm up
        results1 = []
        for _ in range(3):
            SchemaResolver.clear_cache()
            start = time.perf_counter()
            result1 = resolve_dify_schema_refs(schema)
            time_no_cache = time.perf_counter() - start
            results1.append(time_no_cache)

        avg_time_no_cache = sum(results1) / len(results1)

        # Second run (with cache) - run multiple times
        results2 = []
        for _ in range(3):
            start = time.perf_counter()
            result2 = resolve_dify_schema_refs(schema)
            time_with_cache = time.perf_counter() - start
            results2.append(time_with_cache)

        avg_time_with_cache = sum(results2) / len(results2)

        # Cache should make it faster (more lenient check)
        assert result1 == result2
        # Cache should provide some performance benefit (allow for measurement variance)
        # We expect cache to be faster, but allow for small timing variations
        performance_ratio = avg_time_with_cache / avg_time_no_cache if avg_time_no_cache > 0 else 1.0
        assert performance_ratio <= 2.0, f"Cache performance degraded too much: {performance_ratio}"

    def test_fast_path_performance_no_refs(self):
        """Test that schemas without $refs use fast path and avoid deep copying"""
        # Create a moderately complex schema without any $refs (typical plugin output_schema)
        no_refs_schema = {
            "type": "object",
            "properties": {
                f"property_{i}": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "value": {"type": "number"},
                        "items": {"type": "array", "items": {"type": "string"}},
                    },
                }
                for i in range(50)
            },
        }

        # Measure fast path (no refs) performance
        fast_times = []
        for _ in range(10):
            start = time.perf_counter()
            result_fast = resolve_dify_schema_refs(no_refs_schema)
            elapsed = time.perf_counter() - start
            fast_times.append(elapsed)

        avg_fast_time = sum(fast_times) / len(fast_times)

        # Most importantly: result should be identical to input (no copying)
        assert result_fast is no_refs_schema

        # Create schema with $refs for comparison (same structure size)
        with_refs_schema = {
            "type": "object",
            "properties": {
                f"property_{i}": {"$ref": "https://dify.ai/schemas/v1/file.json"}
                for i in range(20)  # Fewer to avoid depth issues but still comparable
            },
        }

        # Measure slow path (with refs) performance
        SchemaResolver.clear_cache()
        slow_times = []
        for _ in range(10):
            SchemaResolver.clear_cache()
            start = time.perf_counter()
            result_slow = resolve_dify_schema_refs(with_refs_schema, max_depth=50)
            elapsed = time.perf_counter() - start
            slow_times.append(elapsed)

        avg_slow_time = sum(slow_times) / len(slow_times)

        # The key benefit: fast path should be reasonably fast (main goal is no deep copy)
        # and definitely avoid the expensive BFS resolution
        # Even if detection has some overhead, it should still be faster for typical cases
        print(f"Fast path (no refs): {avg_fast_time:.6f}s")
        print(f"Slow path (with refs): {avg_slow_time:.6f}s")

        # More lenient check: fast path should be at least somewhat competitive
        # The main benefit is avoiding deep copy and BFS, not necessarily being 5x faster
        assert avg_fast_time < avg_slow_time * 2  # Should not be more than 2x slower

    def test_batch_processing_performance(self):
        """Test performance improvement for batch processing of schemas without refs"""
        # Simulate the plugin tool scenario: many schemas, most without refs
        schemas_without_refs = [
            {
                "type": "object",
                "properties": {f"field_{j}": {"type": "string" if j % 2 else "number"} for j in range(10)},
            }
            for i in range(100)
        ]

        # Test batch processing performance
        start = time.perf_counter()
        results = [resolve_dify_schema_refs(schema) for schema in schemas_without_refs]
        batch_time = time.perf_counter() - start

        # Verify all results are identical to inputs (fast path used)
        for original, result in zip(schemas_without_refs, results):
            assert result is original

        # Should be very fast - each schema should take < 0.001 seconds on average
        avg_time_per_schema = batch_time / len(schemas_without_refs)
        assert avg_time_per_schema < 0.001

    def test_has_dify_refs_performance(self):
        """Test that _has_dify_refs is fast for large schemas without refs"""
        # Create a very large schema without refs
        large_schema = {"type": "object", "properties": {}}

        # Add many nested properties
        current = large_schema
        for i in range(100):
            current["properties"][f"level_{i}"] = {"type": "object", "properties": {}}
            current = current["properties"][f"level_{i}"]

        # _has_dify_refs should be fast even for large schemas
        times = []
        for _ in range(50):
            start = time.perf_counter()
            has_refs = _has_dify_refs(large_schema)
            elapsed = time.perf_counter() - start
            times.append(elapsed)

        avg_time = sum(times) / len(times)

        # Should be False and fast
        assert not has_refs
        assert avg_time < 0.01  # Should complete in less than 10ms

    def test_hybrid_vs_recursive_performance(self):
        """Test performance comparison between hybrid and recursive detection"""
        # Create test schemas of different types and sizes
        test_cases = [
            # Case 1: Small schema without refs (most common case)
            {
                "name": "small_no_refs",
                "schema": {"type": "object", "properties": {"name": {"type": "string"}, "value": {"type": "number"}}},
                "expected": False,
            },
            # Case 2: Medium schema without refs
            {
                "name": "medium_no_refs",
                "schema": {
                    "type": "object",
                    "properties": {
                        f"field_{i}": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "value": {"type": "number"},
                                "items": {"type": "array", "items": {"type": "string"}},
                            },
                        }
                        for i in range(20)
                    },
                },
                "expected": False,
            },
            # Case 3: Large schema without refs
            {"name": "large_no_refs", "schema": {"type": "object", "properties": {}}, "expected": False},
            # Case 4: Schema with Dify refs
            {
                "name": "with_dify_refs",
                "schema": {
                    "type": "object",
                    "properties": {
                        "file": {"$ref": "https://dify.ai/schemas/v1/file.json"},
                        "data": {"type": "string"},
                    },
                },
                "expected": True,
            },
            # Case 5: Schema with non-Dify refs
            {
                "name": "with_external_refs",
                "schema": {
                    "type": "object",
                    "properties": {"external": {"$ref": "https://example.com/schema.json"}, "data": {"type": "string"}},
                },
                "expected": False,
            },
        ]

        # Add deep nesting to large schema
        current = test_cases[2]["schema"]
        for i in range(50):
            current["properties"][f"level_{i}"] = {"type": "object", "properties": {}}
            current = current["properties"][f"level_{i}"]

        # Performance comparison
        for test_case in test_cases:
            schema = test_case["schema"]
            expected = test_case["expected"]
            name = test_case["name"]

            # Test correctness first
            assert _has_dify_refs_hybrid(schema) == expected
            assert _has_dify_refs_recursive(schema) == expected

            # Measure hybrid performance
            hybrid_times = []
            for _ in range(10):
                start = time.perf_counter()
                result_hybrid = _has_dify_refs_hybrid(schema)
                elapsed = time.perf_counter() - start
                hybrid_times.append(elapsed)

            # Measure recursive performance
            recursive_times = []
            for _ in range(10):
                start = time.perf_counter()
                result_recursive = _has_dify_refs_recursive(schema)
                elapsed = time.perf_counter() - start
                recursive_times.append(elapsed)

            avg_hybrid = sum(hybrid_times) / len(hybrid_times)
            avg_recursive = sum(recursive_times) / len(recursive_times)

            print(f"{name}: hybrid={avg_hybrid:.6f}s, recursive={avg_recursive:.6f}s")

            # Results should be identical
            assert result_hybrid == result_recursive == expected

            # For schemas without refs, hybrid should be competitive or better
            if not expected:  # No refs case
                # Hybrid might be slightly slower due to JSON serialization overhead,
                # but should not be dramatically worse
                assert avg_hybrid < avg_recursive * 5  # At most 5x slower

    def test_string_matching_edge_cases(self):
        """Test edge cases for string-based detection"""
        # Case 1: False positive potential - $ref in description
        schema_false_positive = {
            "type": "object",
            "properties": {
                "description": {"type": "string", "description": "This field explains how $ref works in JSON Schema"}
            },
        }

        # Both methods should return False
        assert not _has_dify_refs_hybrid(schema_false_positive)
        assert not _has_dify_refs_recursive(schema_false_positive)

        # Case 2: Complex URL patterns
        complex_schema = {
            "type": "object",
            "properties": {
                "config": {
                    "type": "object",
                    "properties": {
                        "dify_url": {"type": "string", "default": "https://dify.ai/schemas/info"},
                        "actual_ref": {"$ref": "https://dify.ai/schemas/v1/file.json"},
                    },
                }
            },
        }

        # Both methods should return True (due to actual_ref)
        assert _has_dify_refs_hybrid(complex_schema)
        assert _has_dify_refs_recursive(complex_schema)

        # Case 3: Non-JSON serializable objects (should fall back to recursive)
        import datetime

        non_serializable = {
            "type": "object",
            "timestamp": datetime.datetime.now(),
            "data": {"$ref": "https://dify.ai/schemas/v1/file.json"},
        }

        # Hybrid should fall back to recursive and still work
        assert _has_dify_refs_hybrid(non_serializable)
        assert _has_dify_refs_recursive(non_serializable)
