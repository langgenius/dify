import logging
import re
import threading
from collections import deque
from dataclasses import dataclass
from typing import Any, Union

from core.schemas.registry import SchemaRegistry

logger = logging.getLogger(__name__)

# Type aliases for better clarity
SchemaType = Union[dict[str, Any], list[Any], str, int, float, bool, None]
SchemaDict = dict[str, Any]

# Pre-compiled pattern for better performance
_DIFY_SCHEMA_PATTERN = re.compile(r"^https://dify\.ai/schemas/(v\d+)/(.+)\.json$")


class SchemaResolutionError(Exception):
    """Base exception for schema resolution errors"""

    pass


class CircularReferenceError(SchemaResolutionError):
    """Raised when a circular reference is detected"""

    def __init__(self, ref_uri: str, ref_path: list[str]):
        self.ref_uri = ref_uri
        self.ref_path = ref_path
        super().__init__(f"Circular reference detected: {ref_uri} in path {' -> '.join(ref_path)}")


class MaxDepthExceededError(SchemaResolutionError):
    """Raised when maximum resolution depth is exceeded"""

    def __init__(self, max_depth: int):
        self.max_depth = max_depth
        super().__init__(f"Maximum resolution depth ({max_depth}) exceeded")


class SchemaNotFoundError(SchemaResolutionError):
    """Raised when a referenced schema cannot be found"""

    def __init__(self, ref_uri: str):
        self.ref_uri = ref_uri
        super().__init__(f"Schema not found: {ref_uri}")


@dataclass
class QueueItem:
    """Represents an item in the BFS queue"""

    current: Any
    parent: Any | None
    key: Union[str, int] | None
    depth: int
    ref_path: set[str]


class SchemaResolver:
    """Resolver for Dify schema references with caching and optimizations"""

    _cache: dict[str, SchemaDict] = {}
    _cache_lock = threading.Lock()

    def __init__(self, registry: SchemaRegistry | None = None, max_depth: int = 10):
        """
        Initialize the schema resolver

        Args:
            registry: Schema registry to use (defaults to default registry)
            max_depth: Maximum depth for reference resolution
        """
        self.registry = registry or SchemaRegistry.default_registry()
        self.max_depth = max_depth

    @classmethod
    def clear_cache(cls) -> None:
        """Clear the global schema cache"""
        with cls._cache_lock:
            cls._cache.clear()

    def resolve(self, schema: SchemaType) -> SchemaType:
        """
        Resolve all $ref references in the schema

        Performance optimization: quickly checks for $ref presence before processing.

        Args:
            schema: Schema to resolve

        Returns:
            Resolved schema with all references expanded

        Raises:
            CircularReferenceError: If circular reference detected
            MaxDepthExceededError: If max depth exceeded
            SchemaNotFoundError: If referenced schema not found
        """
        if not isinstance(schema, (dict, list)):
            return schema

        # Fast path: if no Dify refs found, return original schema unchanged
        # This avoids expensive deepcopy and BFS traversal for schemas without refs
        if not _has_dify_refs(schema):
            return schema

        # Slow path: schema contains refs, perform full resolution
        import copy

        result = copy.deepcopy(schema)

        # Initialize BFS queue
        queue = deque([QueueItem(current=result, parent=None, key=None, depth=0, ref_path=set())])

        while queue:
            item = queue.popleft()

            # Process the current item
            self._process_queue_item(queue, item)

        return result

    def _process_queue_item(self, queue: deque, item: QueueItem) -> None:
        """Process a single queue item"""
        if isinstance(item.current, dict):
            self._process_dict(queue, item)
        elif isinstance(item.current, list):
            self._process_list(queue, item)

    def _process_dict(self, queue: deque, item: QueueItem) -> None:
        """Process a dictionary item"""
        ref_uri = item.current.get("$ref")

        if ref_uri and _is_dify_schema_ref(ref_uri):
            # Handle $ref resolution
            self._resolve_ref(queue, item, ref_uri)
        else:
            # Process nested items
            for key, value in item.current.items():
                if isinstance(value, (dict, list)):
                    next_depth = item.depth + 1
                    if next_depth >= self.max_depth:
                        raise MaxDepthExceededError(self.max_depth)
                    queue.append(
                        QueueItem(current=value, parent=item.current, key=key, depth=next_depth, ref_path=item.ref_path)
                    )

    def _process_list(self, queue: deque, item: QueueItem) -> None:
        """Process a list item"""
        for idx, value in enumerate(item.current):
            if isinstance(value, (dict, list)):
                next_depth = item.depth + 1
                if next_depth >= self.max_depth:
                    raise MaxDepthExceededError(self.max_depth)
                queue.append(
                    QueueItem(current=value, parent=item.current, key=idx, depth=next_depth, ref_path=item.ref_path)
                )

    def _resolve_ref(self, queue: deque, item: QueueItem, ref_uri: str) -> None:
        """Resolve a $ref reference"""
        # Check for circular reference
        if ref_uri in item.ref_path:
            # Mark as circular and skip
            item.current["$circular_ref"] = True
            logger.warning("Circular reference detected: %s", ref_uri)
            return

        # Get resolved schema (from cache or registry)
        resolved_schema = self._get_resolved_schema(ref_uri)
        if not resolved_schema:
            logger.warning("Schema not found: %s", ref_uri)
            return

        # Update ref path
        new_ref_path = item.ref_path | {ref_uri}

        # Replace the reference with resolved schema
        next_depth = item.depth + 1
        if next_depth >= self.max_depth:
            raise MaxDepthExceededError(self.max_depth)

        if item.parent is None:
            # Root level replacement
            item.current.clear()
            item.current.update(resolved_schema)
            queue.append(
                QueueItem(current=item.current, parent=None, key=None, depth=next_depth, ref_path=new_ref_path)
            )
        else:
            # Update parent container
            item.parent[item.key] = resolved_schema.copy()
            queue.append(
                QueueItem(
                    current=item.parent[item.key],
                    parent=item.parent,
                    key=item.key,
                    depth=next_depth,
                    ref_path=new_ref_path,
                )
            )

    def _get_resolved_schema(self, ref_uri: str) -> SchemaDict | None:
        """Get resolved schema from cache or registry"""
        # Check cache first
        with self._cache_lock:
            if ref_uri in self._cache:
                return self._cache[ref_uri].copy()

        # Fetch from registry
        schema = self.registry.get_schema(ref_uri)
        if not schema:
            return None

        # Clean and cache
        cleaned = _remove_metadata_fields(schema)
        with self._cache_lock:
            self._cache[ref_uri] = cleaned

        return cleaned.copy()


def resolve_dify_schema_refs(
    schema: SchemaType, registry: SchemaRegistry | None = None, max_depth: int = 30
) -> SchemaType:
    """
    Resolve $ref references in Dify schema to actual schema content

    This is a convenience function that creates a resolver and resolves the schema.
    Performance optimization: quickly checks for $ref presence before processing.

    Args:
        schema: Schema object that may contain $ref references
        registry: Optional schema registry, defaults to default registry
        max_depth: Maximum depth to prevent infinite loops (default: 30)

    Returns:
        Schema with all $ref references resolved to actual content

    Raises:
        CircularReferenceError: If circular reference detected
        MaxDepthExceededError: If maximum depth exceeded
        SchemaNotFoundError: If referenced schema not found
    """
    # Fast path: if no Dify refs found, return original schema unchanged
    # This avoids expensive deepcopy and BFS traversal for schemas without refs
    if not _has_dify_refs(schema):
        return schema

    # Slow path: schema contains refs, perform full resolution
    resolver = SchemaResolver(registry, max_depth)
    return resolver.resolve(schema)


def _remove_metadata_fields(schema: dict) -> dict:
    """
    Remove metadata fields from schema that shouldn't be included in resolved output

    Args:
        schema: Schema dictionary

    Returns:
        Cleaned schema without metadata fields
    """
    # Create a copy and remove metadata fields
    cleaned = schema.copy()
    metadata_fields = ["$id", "$schema", "version"]

    for field in metadata_fields:
        cleaned.pop(field, None)

    return cleaned


def _is_dify_schema_ref(ref_uri: Any) -> bool:
    """
    Check if the reference URI is a Dify schema reference

    Args:
        ref_uri: URI to check

    Returns:
        True if it's a Dify schema reference
    """
    if not isinstance(ref_uri, str):
        return False

    # Use pre-compiled pattern for better performance
    return bool(_DIFY_SCHEMA_PATTERN.match(ref_uri))


def _has_dify_refs_recursive(schema: SchemaType) -> bool:
    """
    Recursively check if a schema contains any Dify $ref references

    This is the fallback method when string-based detection is not possible.

    Args:
        schema: Schema to check for references

    Returns:
        True if any Dify $ref is found, False otherwise
    """
    if isinstance(schema, dict):
        # Check if this dict has a $ref field
        ref_uri = schema.get("$ref")
        if ref_uri and _is_dify_schema_ref(ref_uri):
            return True

        # Check nested values
        for value in schema.values():
            if _has_dify_refs_recursive(value):
                return True

    elif isinstance(schema, list):
        # Check each item in the list
        for item in schema:
            if _has_dify_refs_recursive(item):
                return True

    # Primitive types don't contain refs
    return False


def _has_dify_refs_hybrid(schema: SchemaType) -> bool:
    """
    Hybrid detection: fast string scan followed by precise recursive check

    Performance optimization using two-phase detection:
    1. Fast string scan to quickly eliminate schemas without $ref
    2. Precise recursive validation only for potential candidates

    Args:
        schema: Schema to check for references

    Returns:
        True if any Dify $ref is found, False otherwise
    """
    # Phase 1: Fast string-based pre-filtering
    try:
        import json

        schema_str = json.dumps(schema, separators=(",", ":"))

        # Quick elimination: no $ref at all
        if '"$ref"' not in schema_str:
            return False

        # Quick elimination: no Dify schema URLs
        if "https://dify.ai/schemas/" not in schema_str:
            return False

    except (TypeError, ValueError, OverflowError):
        # JSON serialization failed (e.g., circular references, non-serializable objects)
        # Fall back to recursive detection
        logger.debug("JSON serialization failed for schema, using recursive detection")
        return _has_dify_refs_recursive(schema)

    # Phase 2: Precise recursive validation
    # Only executed for schemas that passed string pre-filtering
    return _has_dify_refs_recursive(schema)


def _has_dify_refs(schema: SchemaType) -> bool:
    """
    Check if a schema contains any Dify $ref references

    Uses hybrid detection for optimal performance:
    - Fast string scan for quick elimination
    - Precise recursive check for validation

    Args:
        schema: Schema to check for references

    Returns:
        True if any Dify $ref is found, False otherwise
    """
    return _has_dify_refs_hybrid(schema)


def parse_dify_schema_uri(uri: str) -> tuple[str, str]:
    """
    Parse a Dify schema URI to extract version and schema name

    Args:
        uri: Schema URI to parse

    Returns:
        Tuple of (version, schema_name) or ("", "") if invalid
    """
    match = _DIFY_SCHEMA_PATTERN.match(uri)
    if not match:
        return "", ""

    return match.group(1), match.group(2)
