import re
from typing import Any, Optional

from core.schemas.registry import SchemaRegistry


def resolve_dify_schema_refs(schema: Any, registry: Optional[SchemaRegistry] = None, max_depth: int = 10) -> Any:
    """
    Resolve $ref references in Dify schema to actual schema content
    
    Args:
        schema: Schema object that may contain $ref references
        registry: Optional schema registry, defaults to default registry
        max_depth: Maximum recursion depth to prevent infinite loops (default: 10)
        
    Returns:
        Schema with all $ref references resolved to actual content
        
    Raises:
        RecursionError: If maximum recursion depth is exceeded
    """
    if registry is None:
        registry = SchemaRegistry.default_registry()
    
    return _resolve_refs_recursive(schema, registry, max_depth, 0)


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