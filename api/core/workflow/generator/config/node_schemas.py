"""
Unified Node Configuration for Vibe Workflow Generation.

This module centralizes all node-related configuration:
- Node schemas (parameter definitions)
- Fallback rules (keyword-based node type inference)
- Node type aliases (natural language to canonical type mapping)
- Field name corrections (LLM output normalization)
- Validation utilities

Note: These definitions are the single source of truth.
Frontend has a mirrored copy at web/app/components/workflow/hooks/use-workflow-vibe-config.ts
"""

from typing import Any

# =============================================================================
# NODE SCHEMAS
# =============================================================================

# Built-in node schemas with parameter definitions
# These help the model understand what config each node type requires
_HARDCODED_SCHEMAS: dict[str, dict[str, Any]] = {
    "http-request": {
        "description": "Send HTTP requests to external APIs or fetch web content",
        "required": ["url", "method"],
        "parameters": {
            "url": {
                "type": "string",
                "description": "Full URL including protocol (https://...)",
                "example": "{{#start.url#}} or https://api.example.com/data",
            },
            "method": {
                "type": "enum",
                "options": ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"],
                "description": "HTTP method",
            },
            "headers": {
                "type": "string",
                "description": "HTTP headers as newline-separated 'Key: Value' pairs",
                "example": "Content-Type: application/json\nAuthorization: Bearer {{#start.api_key#}}",
            },
            "params": {
                "type": "string",
                "description": "URL query parameters as newline-separated 'key: value' pairs",
            },
            "body": {
                "type": "object",
                "description": "Request body with type field required",
                "example": {"type": "none", "data": []},
            },
            "authorization": {
                "type": "object",
                "description": "Authorization config",
                "example": {"type": "no-auth"},
            },
            "timeout": {
                "type": "number",
                "description": "Request timeout in seconds",
                "default": 60,
            },
        },
        "outputs": ["body (response content)", "status_code", "headers"],
    },
    "code": {
        "description": "Execute Python or JavaScript code for custom logic",
        "required": ["code", "language"],
        "parameters": {
            "code": {
                "type": "string",
                "description": "Code to execute. Must define a main() function that returns a dict.",
            },
            "language": {
                "type": "enum",
                "options": ["python3", "javascript"],
            },
            "variables": {
                "type": "array",
                "description": "Input variables passed to the code",
                "item_schema": {"variable": "string", "value_selector": "array"},
            },
            "outputs": {
                "type": "object",
                "description": "Output variable definitions",
            },
        },
        "outputs": ["Variables defined in outputs schema"],
    },
    "llm": {
        "description": "Call a large language model for text generation/processing",
        "required": ["prompt_template"],
        "parameters": {
            "model": {
                "type": "object",
                "description": "Model configuration (provider, name, mode)",
            },
            "prompt_template": {
                "type": "array",
                "description": "Messages for the LLM",
                "item_schema": {
                    "role": "enum: system, user, assistant",
                    "text": "string - message content, can include {{#node_id.field#}} references",
                },
            },
            "context": {
                "type": "object",
                "description": "Optional context settings",
            },
            "memory": {
                "type": "object",
                "description": "Optional memory/conversation settings",
            },
        },
        "outputs": ["text (generated response)"],
    },
    "if-else": {
        "description": "Conditional branching based on conditions",
        "required": ["cases"],
        "parameters": {
            "cases": {
                "type": "array",
                "description": "List of condition cases. Each case defines when 'true' branch is taken.",
                "item_schema": {
                    "case_id": "string - unique case identifier (e.g., 'case_1')",
                    "logical_operator": "enum: and, or - how multiple conditions combine",
                    "conditions": {
                        "type": "array",
                        "item_schema": {
                            "variable_selector": "array of strings - path to variable, e.g. ['node_id', 'field']",
                            "comparison_operator": (
                                "enum: =, ≠, >, <, ≥, ≤, contains, not contains, is, is not, empty, not empty"
                            ),
                            "value": "string or number - value to compare against",
                        },
                    },
                },
            },
        },
        "outputs": ["Branches: true (first case conditions met), false (else/no case matched)"],
    },
    "knowledge-retrieval": {
        "description": "Query knowledge base for relevant content",
        "required": ["query_variable_selector", "dataset_ids"],
        "parameters": {
            "query_variable_selector": {
                "type": "array",
                "description": "Path to query variable, e.g. ['start', 'query']",
            },
            "dataset_ids": {
                "type": "array",
                "description": "List of knowledge base IDs to search",
            },
            "retrieval_mode": {
                "type": "enum",
                "options": ["single", "multiple"],
            },
        },
        "outputs": ["result (retrieved documents)"],
    },
    "template-transform": {
        "description": "Transform data using Jinja2 templates",
        "required": ["template", "variables"],
        "parameters": {
            "template": {
                "type": "string",
                "description": "Jinja2 template string. Use {{ variable_name }} to reference variables.",
            },
            "variables": {
                "type": "array",
                "description": "Input variables defined for the template",
                "item_schema": {
                    "variable": "string - variable name to use in template",
                    "value_selector": "array - path to source value, e.g. ['start', 'user_input']",
                },
            },
        },
        "outputs": ["output (transformed string)"],
    },
    "variable-aggregator": {
        "description": "Aggregate variables from multiple branches",
        "required": ["variables"],
        "parameters": {
            "variables": {
                "type": "array",
                "description": "List of variable selectors to aggregate",
                "item_schema": "array of strings - path to source variable, e.g. ['node_id', 'field']",
            },
        },
        "outputs": ["output (aggregated value)"],
    },
    "iteration": {
        "description": "Loop over array items",
        "required": ["iterator_selector"],
        "parameters": {
            "iterator_selector": {
                "type": "array",
                "description": "Path to array variable to iterate",
            },
        },
        "outputs": ["item (current iteration item)", "index (current index)"],
    },
    "parameter-extractor": {
        "description": "Extract structured parameters from user input using LLM",
        "required": ["query", "parameters"],
        "parameters": {
            "model": {
                "type": "object",
                "description": "Model configuration (provider, name, mode)",
            },
            "query": {
                "type": "array",
                "description": "Path to input text to extract parameters from, e.g. ['start', 'user_input']",
            },
            "parameters": {
                "type": "array",
                "description": "Parameters to extract from the input",
                "item_schema": {
                    "name": "string - parameter name (required)",
                    "type": (
                        "enum: string, number, boolean, array[string], array[number], array[object], array[boolean]"
                    ),
                    "description": "string - description of what to extract (required)",
                    "required": "boolean - whether this parameter is required (MUST be specified)",
                    "options": "array of strings (optional) - for enum-like selection",
                },
            },
            "instruction": {
                "type": "string",
                "description": "Additional instructions for extraction",
            },
            "reasoning_mode": {
                "type": "enum",
                "options": ["function_call", "prompt"],
                "description": "How to perform extraction (defaults to function_call)",
            },
        },
        "outputs": ["Extracted parameters as defined in parameters array", "__is_success", "__reason"],
    },
    "question-classifier": {
        "description": "Classify user input into predefined categories using LLM",
        "required": ["query", "classes"],
        "parameters": {
            "model": {
                "type": "object",
                "description": "Model configuration (provider, name, mode)",
            },
            "query": {
                "type": "array",
                "description": "Path to input text to classify, e.g. ['start', 'user_input']",
            },
            "classes": {
                "type": "array",
                "description": "Classification categories",
                "item_schema": {
                    "id": "string - unique class identifier",
                    "name": "string - class name/label",
                },
            },
            "instruction": {
                "type": "string",
                "description": "Additional instructions for classification",
            },
        },
        "outputs": ["class_name (selected class)"],
    },
}


def _get_dynamic_schemas() -> dict[str, dict[str, Any]]:
    """
    Dynamically load schemas from node classes.
    Uses lazy import to avoid circular dependency.
    """
    from core.workflow.nodes.node_mapping import LATEST_VERSION, NODE_TYPE_CLASSES_MAPPING

    schemas = {}
    for node_type, version_map in NODE_TYPE_CLASSES_MAPPING.items():
        # Get the latest version class
        node_cls = version_map.get(LATEST_VERSION)
        if not node_cls:
            continue

        # Get schema from the class
        schema = node_cls.get_default_config_schema()
        if schema:
            schemas[node_type.value] = schema

    return schemas


# Cache for built-in schemas (populated on first access)
_builtin_schemas_cache: dict[str, dict[str, Any]] | None = None


def get_builtin_node_schemas() -> dict[str, dict[str, Any]]:
    """
    Get the complete set of built-in node schemas.
    Combines hardcoded schemas with dynamically loaded ones.
    Results are cached after first call.
    """
    global _builtin_schemas_cache
    if _builtin_schemas_cache is None:
        _builtin_schemas_cache = {**_HARDCODED_SCHEMAS, **_get_dynamic_schemas()}
    return _builtin_schemas_cache


# For backward compatibility - but use get_builtin_node_schemas() for lazy loading
BUILTIN_NODE_SCHEMAS: dict[str, dict[str, Any]] = _HARDCODED_SCHEMAS.copy()


# =============================================================================
# FALLBACK RULES
# =============================================================================

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


# =============================================================================
# NODE TYPE ALIASES
# =============================================================================

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


# =============================================================================
# FIELD NAME CORRECTIONS
# =============================================================================

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


# =============================================================================
# VALIDATION UTILITIES
# =============================================================================

# Node types that are internal and don't need schemas for LLM generation
_INTERNAL_NODE_TYPES: set[str] = {
    # Internal workflow nodes
    "answer",  # Internal to chatflow
    "loop",  # Uses iteration internally
    "assigner",  # Variable assignment utility
    "variable-assigner",  # Variable assignment utility
    "agent",  # Agent node (complex, handled separately)
    "document-extractor",  # Internal document processing
    "list-operator",  # Internal list operations
    # Iteration internal nodes
    "iteration-start",  # Internal to iteration loop
    "loop-start",  # Internal to loop
    "loop-end",  # Internal to loop
    # Trigger nodes (not user-creatable via LLM)
    "trigger-plugin",  # Plugin trigger
    "trigger-schedule",  # Scheduled trigger
    "trigger-webhook",  # Webhook trigger
    # Other internal nodes
    "datasource",  # Data source configuration
    "human-input",  # Human-in-the-loop node
    "knowledge-index",  # Knowledge indexing node
}


def validate_node_schemas() -> list[str]:
    """
    Validate that all registered node types have corresponding schemas.

    This function checks if BUILTIN_NODE_SCHEMAS covers all node types
    registered in NODE_TYPE_CLASSES_MAPPING, excluding internal node types.

    Returns:
        List of warning messages for missing schemas (empty if all valid)
    """
    from core.workflow.nodes.node_mapping import NODE_TYPE_CLASSES_MAPPING

    schemas = get_builtin_node_schemas()
    warnings = []
    for node_type in NODE_TYPE_CLASSES_MAPPING:
        type_value = node_type.value
        if type_value in _INTERNAL_NODE_TYPES:
            continue
        if type_value not in schemas:
            warnings.append(f"Missing schema for node type: {type_value}")
    return warnings
