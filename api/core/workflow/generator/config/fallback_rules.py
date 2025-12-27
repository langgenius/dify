"""
Fallback Rules for Vibe Workflow Generation.

This module defines keyword-based rules for determining fallback node types
when the LLM generates invalid tool references.

Note: These definitions are mirrored in node_definitions.json for frontend sync.
When updating these values, also update the JSON file.
"""

# Keyword rules for smart fallback detection
# Maps node type to keywords that suggest using that node type as a fallback
FALLBACK_RULES: dict[str, list[str]] = {
    "http-request": [
        "http",
        "url",
        "web",
        "scrape",
        "scraper",
        "fetch",
        "api",
        "request",
        "download",
        "upload",
        "webhook",
        "endpoint",
        "rest",
        "get",
        "post",
    ],
    "code": [
        "code",
        "script",
        "calculate",
        "compute",
        "process",
        "transform",
        "parse",
        "convert",
        "format",
        "filter",
        "sort",
        "math",
        "logic",
    ],
    "llm": [
        "analyze",
        "summarize",
        "summary",
        "extract",
        "classify",
        "translate",
        "generate",
        "write",
        "rewrite",
        "explain",
        "answer",
        "chat",
    ],
}


# Node type aliases for inference from natural language
# Maps common terms to canonical node type names
NODE_TYPE_ALIASES: dict[str, str] = {
    # Start node aliases
    "start": "start",
    "begin": "start",
    "input": "start",
    # End node aliases
    "end": "end",
    "finish": "end",
    "output": "end",
    # LLM node aliases
    "llm": "llm",
    "ai": "llm",
    "gpt": "llm",
    "model": "llm",
    "chat": "llm",
    # Code node aliases
    "code": "code",
    "script": "code",
    "python": "code",
    "javascript": "code",
    # HTTP request node aliases
    "http-request": "http-request",
    "http": "http-request",
    "request": "http-request",
    "api": "http-request",
    "fetch": "http-request",
    "webhook": "http-request",
    # Conditional node aliases
    "if-else": "if-else",
    "condition": "if-else",
    "branch": "if-else",
    "switch": "if-else",
    # Loop node aliases
    "iteration": "iteration",
    "loop": "loop",
    "foreach": "iteration",
    # Tool node alias
    "tool": "tool",
}


# Field name corrections for LLM-generated node configs
# Maps incorrect field names to correct ones for specific node types
FIELD_NAME_CORRECTIONS: dict[str, dict[str, str]] = {
    "http-request": {
        "text": "body",  # LLM might use "text" instead of "body"
        "content": "body",
        "response": "body",
    },
    "code": {
        "text": "result",  # LLM might use "text" instead of "result"
        "output": "result",
    },
    "llm": {
        "response": "text",
        "answer": "text",
    },
}


def get_corrected_field_name(node_type: str, field: str) -> str:
    """
    Get the corrected field name for a node type.

    Args:
        node_type: The type of the node (e.g., "http-request", "code")
        field: The field name to correct

    Returns:
        The corrected field name, or the original if no correction needed
    """
    corrections = FIELD_NAME_CORRECTIONS.get(node_type, {})
    return corrections.get(field, field)

