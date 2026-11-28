"""Pure Builder runtime input contract, including Chatflow's system message.

Start variables retain their own namespace; ``sys.query`` is reserved for the
advanced-chat user message and is removed only at the native adapter boundary.
"""

import hashlib
import json

from core.dify_builder.models import Graph, Inputs, StartSchema, TestInput

SYSTEM_QUERY = "sys.query"


def start_schema(graph: Graph, app_mode: str = "workflow") -> StartSchema:
    """Compose declared Start inputs with the trusted app mode's runtime inputs.

    The workflow default preserves existing callers that need only Start
    declarations. Runtime handlers explicitly supply the persisted app mode.
    The system_query marker distinguishes runtime requirements from ordinary
    workflow variables, even if a legacy variable happens to use the same key.
    Graph data is never mutated.
    """
    variables = []
    for node in graph.get("nodes", []):
        data = node.get("data") or {}
        if data.get("type") == "start":
            variables = list(data.get("variables") or [])
            break
    if app_mode == "advanced-chat":
        variables = [v for v in variables if not isinstance(v, dict) or v.get("variable") != SYSTEM_QUERY]
        variables.append({"variable": SYSTEM_QUERY, "type": "paragraph", "label": "User message", "required": True})
    schema: StartSchema = {"variables": variables}
    if app_mode == "advanced-chat":
        schema["system_query"] = SYSTEM_QUERY
    return schema


def schema_hash(schema: StartSchema) -> str:
    """Stable hash of the complete input contract persisted with test data."""
    return hashlib.sha256(json.dumps(schema, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def validate_query(inputs: Inputs) -> None:
    """Reject absent, blank or non-text system messages before native execution."""
    query = inputs.get(SYSTEM_QUERY)
    if not isinstance(query, str) or not query.strip():
        raise ValueError("query is required")


def validate_runtime_inputs(schema: StartSchema, inputs: Inputs, saved: TestInput | None = None) -> None:
    """Validate Chatflow's message and saved contract; keep workflow reuse intact.

    Native execution continues to own ordinary Start/file validation. Historical
    saved inputs without hashes remain usable when they satisfy the query contract.
    """
    if schema.get("system_query") == SYSTEM_QUERY:
        validate_query(inputs)
        if saved is not None and saved.start_schema_hash and saved.start_schema_hash != schema_hash(schema):
            raise ValueError("missing input: saved test data no longer matches the input form")
