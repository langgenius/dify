import re
from collections import deque
from typing import Any, Optional

from core.schemas.registry import SchemaRegistry


def resolve_dify_schema_refs(schema: Any, registry: Optional[SchemaRegistry] = None, max_depth: int = 10) -> Any:
    """
    Resolve $ref references in Dify schema to actual schema content

    Args:
        schema: Schema object that may contain $ref references
        registry: Optional schema registry, defaults to default registry
        max_depth: Maximum depth to prevent infinite loops (default: 10)

    Returns:
        Schema with all $ref references resolved to actual content

    Raises:
        RecursionError: If maximum depth is exceeded
    """
    if registry is None:
        registry = SchemaRegistry.default_registry()

    return _resolve_refs_bfs(schema, registry, max_depth)


def _resolve_refs_bfs(schema: Any, registry: SchemaRegistry, max_depth: int) -> Any:
    """
    Resolve $ref references using Breadth-First Search (BFS) approach with cycle detection

    Args:
        schema: Schema object to process
        registry: Schema registry for lookups
        max_depth: Maximum allowed depth

    Returns:
        Schema with references resolved

    Raises:
        RecursionError: If maximum depth exceeded or circular reference detected
    """
    import copy

    # Deep copy the schema to avoid modifying original
    result = copy.deepcopy(schema)

    # Queue stores tuples: (current_value, parent_container, key_or_index, depth, ref_path)
    # parent_container is the dict/list that contains current_value
    # key_or_index is the key (for dict) or index (for list) to access current_value in parent
    # ref_path is a tuple of resolved reference URIs to detect cycles
    queue = deque([(result, None, None, 0, ())])

    while queue:
        current, parent, key, depth, ref_path = queue.popleft()

        # Process based on type
        if isinstance(current, dict):
            # Check if this is a $ref reference
            if "$ref" in current:
                ref_uri = current["$ref"]

                # Only resolve Dify schema references
                if _is_dify_schema_ref(ref_uri):
                    # Check for circular reference
                    if ref_uri in ref_path:
                        # Found a cycle - leave the ref as-is to avoid infinite loop
                        # Could also raise an error here if preferred
                        current["$circular_ref"] = True  # Mark as circular for debugging
                        continue

                    resolved_schema = registry.get_schema(ref_uri)
                    if resolved_schema:
                        # Remove metadata fields from resolved schema
                        cleaned_schema = _remove_metadata_fields(resolved_schema)

                        # Check depth limit before adding to queue
                        if depth + 1 > max_depth:
                            raise RecursionError(
                                f"Maximum depth ({max_depth}) exceeded while resolving schema references"
                            )

                        # Update ref_path with current reference
                        new_ref_path = ref_path + (ref_uri,)

                        # Replace the reference with resolved schema
                        if parent is None:
                            # Root level replacement
                            result = copy.deepcopy(cleaned_schema)
                            # Add the resolved schema back to queue for further processing
                            queue.append((result, None, None, depth + 1, new_ref_path))
                        else:
                            # Update parent container (works for both dict and list)
                            if isinstance(parent, (dict, list)):
                                parent[key] = copy.deepcopy(cleaned_schema)
                                # Add the resolved schema to queue for further processing
                                queue.append((parent[key], parent, key, depth + 1, new_ref_path))
                    # If schema not found, leave the original ref as-is
                # Non-Dify reference, leave as-is
            else:
                # Regular dict, add all values to queue for processing
                for k, v in current.items():
                    if isinstance(v, (dict, list)):
                        # Check depth limit before adding to queue
                        if depth + 1 > max_depth:
                            raise RecursionError(
                                f"Maximum depth ({max_depth}) exceeded while resolving schema references"
                            )
                        queue.append((v, current, k, depth + 1, ref_path))

        elif isinstance(current, list):
            # Process list items
            for idx, item in enumerate(current):
                if isinstance(item, (dict, list)):
                    # Check depth limit before adding to queue (fixed: should be > not >=)
                    if depth + 1 > max_depth:
                        raise RecursionError(f"Maximum depth ({max_depth}) exceeded while resolving schema references")
                    queue.append((item, current, idx, depth + 1, ref_path))

        # Primitive values don't need processing

    return result


def _resolve_refs_recursive(schema: Any, registry: SchemaRegistry, max_depth: int, current_depth: int) -> Any:
    """
    Recursively resolve $ref references in schema

    Args:
        schema: Schema object to process
        registry: Schema registry for lookups
        max_depth: Maximum allowed recursion depth
        current_depth: Current recursion depth

    Returns:
        Schema with references resolved

    Raises:
        RecursionError: If maximum depth exceeded
    """
    # Check recursion depth
    if current_depth >= max_depth:
        raise RecursionError(f"Maximum recursion depth ({max_depth}) exceeded while resolving schema references")

    if isinstance(schema, dict):
        # Check if this is a $ref reference
        if "$ref" in schema:
            ref_uri = schema["$ref"]

            # Only resolve Dify schema references
            if _is_dify_schema_ref(ref_uri):
                resolved_schema = registry.get_schema(ref_uri)
                if resolved_schema:
                    # Remove metadata fields from resolved schema
                    cleaned_schema = _remove_metadata_fields(resolved_schema)
                    # Recursively resolve the cleaned schema in case it contains more refs
                    return _resolve_refs_recursive(cleaned_schema, registry, max_depth, current_depth + 1)
                else:
                    # If schema not found, return original ref (might be external or invalid)
                    return schema
            else:
                # Non-Dify reference, return as-is
                return schema
        else:
            # Regular dict, recursively process all values
            resolved_dict = {}
            for key, value in schema.items():
                resolved_dict[key] = _resolve_refs_recursive(value, registry, max_depth, current_depth + 1)
            return resolved_dict

    elif isinstance(schema, list):
        # Process list items recursively
        return [_resolve_refs_recursive(item, registry, max_depth, current_depth + 1) for item in schema]

    else:
        # Primitive value, return as-is
        return schema


def _remove_metadata_fields(schema: dict) -> dict:
    """
    Remove metadata fields from schema that shouldn't be included in resolved output
    """
    if not isinstance(schema, dict):
        return schema

    # Create a copy and remove metadata fields
    cleaned = schema.copy()
    metadata_fields = ["$id", "$schema", "version"]

    for field in metadata_fields:
        cleaned.pop(field, None)

    return cleaned


def _is_dify_schema_ref(ref_uri: str) -> bool:
    """
    Check if the reference URI is a Dify schema reference
    """
    if not isinstance(ref_uri, str):
        return False

    # Match Dify schema URI pattern: https://dify.ai/schemas/v*/name.json
    pattern = r"^https://dify\.ai/schemas/(v\d+)/(.+)\.json$"
    return bool(re.match(pattern, ref_uri))
