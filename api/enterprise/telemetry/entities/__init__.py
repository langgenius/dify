from enum import StrEnum


class EnterpriseTelemetrySpan(StrEnum):
    WORKFLOW_RUN = "dify.workflow.run"
    NODE_EXECUTION = "dify.node.execution"
    DRAFT_NODE_EXECUTION = "dify.node.execution.draft"


class EnterpriseTelemetryCounter(StrEnum):
    TOKENS = "tokens"
    INPUT_TOKENS = "input_tokens"
    OUTPUT_TOKENS = "output_tokens"
    REQUESTS = "requests"
    ERRORS = "errors"
    FEEDBACK = "feedback"
    DATASET_RETRIEVALS = "dataset_retrievals"


class EnterpriseTelemetryHistogram(StrEnum):
    WORKFLOW_DURATION = "workflow_duration"
    NODE_DURATION = "node_duration"
    MESSAGE_DURATION = "message_duration"
    MESSAGE_TTFT = "message_ttft"
    TOOL_DURATION = "tool_duration"
    PROMPT_GENERATION_DURATION = "prompt_generation_duration"


__all__ = [
    "EnterpriseTelemetryCounter",
    "EnterpriseTelemetryHistogram",
    "EnterpriseTelemetrySpan",
]
