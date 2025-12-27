"""
Built-in Node Schemas for Vibe Workflow Generation.

These schemas define the parameter structures for each node type,
helping the LLM understand what configuration each node requires.
"""

from typing import Any

# Built-in node schemas with parameter definitions
# These help the model understand what config each node type requires
BUILTIN_NODE_SCHEMAS: dict[str, dict[str, Any]] = {
    "start": {
        "description": "Workflow entry point - defines input variables",
        "required": [],
        "parameters": {
            "variables": {
                "type": "array",
                "description": "Input variables for the workflow",
                "item_schema": {
                    "variable": "string - variable name",
                    "label": "string - display label",
                    "type": "enum: text-input, paragraph, number, select, file, file-list",
                    "required": "boolean",
                    "max_length": "number (optional)",
                },
            },
        },
        "outputs": ["All defined variables are available as {{#start.variable_name#}}"],
    },
    "end": {
        "description": "Workflow exit point - defines output variables",
        "required": ["outputs"],
        "parameters": {
            "outputs": {
                "type": "array",
                "description": "Output variables to return",
                "item_schema": {
                    "variable": "string - output variable name",
                    "type": "enum: string, number, object, array",
                    "value_selector": "array - path to source value, e.g. ['node_id', 'field']",
                },
            },
        },
    },
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
        "required": ["template"],
        "parameters": {
            "template": {
                "type": "string",
                "description": "Jinja2 template string",
            },
            "variables": {
                "type": "array",
                "description": "Variables to pass to template",
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
                        "enum: string, number, boolean, array[string], array[number], "
                        "array[object], array[boolean]"
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

