"""Pydantic schema models for Claude workflow import documents.

The parser keeps the Claude workflow format intentionally narrower than Dify's
native workflow DSL. It validates a constrained top-level document, only allows
node types that can be mapped deterministically later, and performs cross-node
reference checks before compilation.
"""

from __future__ import annotations

from typing import Literal, cast

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator, model_validator

from .errors import (
    ClaudeWorkflowSchemaErrorCode,
    ClaudeWorkflowSchemaValidationError,
    ClaudeWorkflowValidationIssue,
)


class ClaudeWorkflowApp(BaseModel):
    """Metadata for a Claude workflow app."""

    model_config = ConfigDict(extra="forbid")

    name: str
    description: str | None = None
    mode: Literal["workflow"]
    icon: str | None = None


class ClaudeWorkflowDependency(BaseModel):
    """A declared external dependency used by the workflow."""

    model_config = ConfigDict(extra="allow")


class ClaudeWorkflowInput(BaseModel):
    """A workflow input that later maps to the Dify start node."""

    model_config = ConfigDict(extra="forbid")

    name: str
    type: Literal["text"]
    required: bool = True


class VariableSelector(BaseModel):
    """Explicit source selector used instead of free-form string interpolation."""

    model_config = ConfigDict(extra="forbid")

    value: tuple[str, str]

    @model_validator(mode="before")
    @classmethod
    def _coerce_sequence(cls, value: object) -> object:
        if isinstance(value, list):
            return {"value": tuple(str(item) for item in value)}
        return value

    @field_validator("value")
    @classmethod
    def _validate_length(cls, value: tuple[str, str]) -> tuple[str, str]:
        if len(value) != 2:
            raise ValueError("selector must contain exactly two path segments")
        return value


class PromptMessage(BaseModel):
    """A single prompt block for an LLM node."""

    model_config = ConfigDict(extra="forbid")

    role: Literal["system", "user", "assistant"]
    text: str | None = None
    selector: VariableSelector | None = None

    @model_validator(mode="after")
    def _validate_message_payload(self) -> "PromptMessage":
        if (self.text is None) == (self.selector is None):
            raise ValueError("prompt message must define exactly one of text or selector")
        return self


class EndOutput(BaseModel):
    """Output mapping declared by an end node."""

    model_config = ConfigDict(extra="forbid")

    name: str
    selector: VariableSelector


class ClaudeWorkflowNodeBase(BaseModel):
    """Shared required fields across all supported Claude nodes."""

    model_config = ConfigDict(extra="allow")

    id: str
    type: str
    title: str


class LlmModelConfig(BaseModel):
    """Subset of model metadata needed for LLM node validation."""

    model_config = ConfigDict(extra="forbid")

    provider: str
    name: str
    mode: str


class LlmNode(ClaudeWorkflowNodeBase):
    """LLM node configuration with explicit prompt blocks."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["llm"]
    model: LlmModelConfig
    prompt: list[PromptMessage]


class EndNode(ClaudeWorkflowNodeBase):
    """Terminal node that exposes workflow outputs."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["end"]
    outputs: list[EndOutput]


class IfElseNode(ClaudeWorkflowNodeBase):
    """Placeholder schema for future conditional node compilation."""

    type: Literal["if_else"]


class HttpRequestNode(ClaudeWorkflowNodeBase):
    """Placeholder schema for future HTTP request node compilation."""

    type: Literal["http_request"]


class CodeNode(ClaudeWorkflowNodeBase):
    """Placeholder schema for future code node compilation."""

    type: Literal["code"]


SupportedNode = LlmNode | EndNode | IfElseNode | HttpRequestNode | CodeNode

SUPPORTED_NODE_TYPES: dict[str, type[SupportedNode]] = {
    "code": CodeNode,
    "end": EndNode,
    "http_request": HttpRequestNode,
    "if_else": IfElseNode,
    "llm": LlmNode,
}


class ClaudeWorkflowEdge(BaseModel):
    """A directed edge between workflow nodes."""

    model_config = ConfigDict(extra="forbid")

    source: str
    target: str
    source_handle: str | None = None
    target_handle: str | None = None


class _ClaudeWorkflowDocumentEnvelope(BaseModel):
    """Validated top-level document before node-specific parsing."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["claude-workflow"]
    version: str
    app: ClaudeWorkflowApp
    dependencies: list[ClaudeWorkflowDependency] = []
    inputs: list[ClaudeWorkflowInput]
    nodes: list[dict]
    edges: list[ClaudeWorkflowEdge]


class ClaudeWorkflowDocument(BaseModel):
    """Validated Claude workflow document used by later compiler stages."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["claude-workflow"]
    version: str
    app: ClaudeWorkflowApp
    dependencies: list[ClaudeWorkflowDependency]
    inputs: list[ClaudeWorkflowInput]
    nodes: list[SupportedNode]
    edges: list[ClaudeWorkflowEdge]


def parse_claude_workflow_document(raw_document: dict) -> ClaudeWorkflowDocument:
    """Validate a raw Claude workflow document and return the typed model."""

    envelope = _validate_envelope(raw_document)
    parsed_nodes = _parse_nodes(envelope.nodes)

    document = ClaudeWorkflowDocument.model_construct(
        kind=envelope.kind,
        version=envelope.version,
        app=envelope.app,
        dependencies=envelope.dependencies,
        inputs=envelope.inputs,
        nodes=parsed_nodes,
        edges=envelope.edges,
    )

    _validate_cross_references(document)
    return document


def _validate_envelope(raw_document: dict) -> _ClaudeWorkflowDocumentEnvelope:
    try:
        return _ClaudeWorkflowDocumentEnvelope.model_validate(raw_document)
    except ValidationError as exc:
        raise ClaudeWorkflowSchemaValidationError(_issues_from_pydantic_error(exc)) from exc


def _parse_nodes(raw_nodes: list[dict]) -> list[SupportedNode]:
    issues: list[ClaudeWorkflowValidationIssue] = []
    parsed_nodes: list[SupportedNode] = []

    for index, raw_node in enumerate(raw_nodes):
        node_type = raw_node.get("type")
        if not isinstance(node_type, str) or node_type not in SUPPORTED_NODE_TYPES:
            issues.append(
                ClaudeWorkflowValidationIssue(
                    code=ClaudeWorkflowSchemaErrorCode.UNSUPPORTED_NODE_TYPE,
                    path=("nodes", index, "type"),
                    message=f"Unsupported node type: {node_type!r}",
                )
            )
            continue

        node_model = SUPPORTED_NODE_TYPES[node_type]

        try:
            parsed_nodes.append(node_model.model_validate(raw_node))
        except ValidationError as exc:
            issues.extend(_issues_from_pydantic_error(exc, prefix=("nodes", index)))

    if issues:
        raise ClaudeWorkflowSchemaValidationError(issues)

    return parsed_nodes


def _validate_cross_references(document: ClaudeWorkflowDocument) -> None:
    node_ids = {node.id for node in document.nodes}
    valid_sources = {"start", *node_ids}
    issues: list[ClaudeWorkflowValidationIssue] = []

    for index, edge in enumerate(document.edges):
        if edge.target not in node_ids:
            issues.append(
                ClaudeWorkflowValidationIssue(
                    code=ClaudeWorkflowSchemaErrorCode.UNKNOWN_EDGE_TARGET,
                    path=("edges", index, "target"),
                    message=f"Unknown edge target: {edge.target}",
                )
            )

    for node_index, node in enumerate(document.nodes):
        if isinstance(node, LlmNode):
            for prompt_index, prompt_message in enumerate(node.prompt):
                if prompt_message.selector and prompt_message.selector.value[0] not in valid_sources:
                    issues.append(
                        ClaudeWorkflowValidationIssue(
                            code=ClaudeWorkflowSchemaErrorCode.UNKNOWN_VARIABLE_SELECTOR_SOURCE,
                            path=("nodes", node_index, "prompt", prompt_index, "selector"),
                            message=f"Unknown selector source: {prompt_message.selector.value[0]}",
                        )
                    )
        elif isinstance(node, EndNode):
            for output_index, output in enumerate(node.outputs):
                if output.selector.value[0] not in valid_sources:
                    issues.append(
                        ClaudeWorkflowValidationIssue(
                            code=ClaudeWorkflowSchemaErrorCode.UNKNOWN_VARIABLE_SELECTOR_SOURCE,
                            path=("nodes", node_index, "outputs", output_index, "selector"),
                            message=f"Unknown selector source: {output.selector.value[0]}",
                        )
                    )

    if issues:
        raise ClaudeWorkflowSchemaValidationError(issues)


def _issues_from_pydantic_error(
    exc: ValidationError, *, prefix: tuple[str | int, ...] = ()
) -> list[ClaudeWorkflowValidationIssue]:
    issues: list[ClaudeWorkflowValidationIssue] = []

    for error in exc.errors():
        location = prefix + tuple(cast(tuple[str | int, ...], error["loc"]))
        issues.append(
            ClaudeWorkflowValidationIssue(
                code=ClaudeWorkflowSchemaErrorCode.INVALID_FIELD,
                path=location,
                message=str(error["msg"]),
            )
        )

    return issues
