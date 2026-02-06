from enum import StrEnum


class EnterpriseTelemetrySpan(StrEnum):
    WORKFLOW_RUN = "dify.workflow.run"
    NODE_EXECUTION = "dify.node.execution"
    DRAFT_NODE_EXECUTION = "dify.node.execution.draft"


class EnterpriseTelemetryEvent(StrEnum):
    """Event names for enterprise telemetry logs."""

    APP_CREATED = "dify.app.created"
    APP_UPDATED = "dify.app.updated"
    APP_DELETED = "dify.app.deleted"
    FEEDBACK_CREATED = "dify.feedback.created"
    WORKFLOW_RUN = "dify.workflow.run"
    MESSAGE_RUN = "dify.message.run"
    TOOL_EXECUTION = "dify.tool.execution"
    MODERATION_CHECK = "dify.moderation.check"
    SUGGESTED_QUESTION_GENERATION = "dify.suggested_question.generation"
    DATASET_RETRIEVAL = "dify.dataset.retrieval"
    GENERATE_NAME_EXECUTION = "dify.generate_name.execution"
    PROMPT_GENERATION_EXECUTION = "dify.prompt_generation.execution"
    REHYDRATION_FAILED = "dify.telemetry.rehydration_failed"


class EnterpriseTelemetryCounter(StrEnum):
    TOKENS = "tokens"
    INPUT_TOKENS = "input_tokens"
    OUTPUT_TOKENS = "output_tokens"
    REQUESTS = "requests"
    ERRORS = "errors"
    FEEDBACK = "feedback"
    DATASET_RETRIEVALS = "dataset_retrievals"
    APP_CREATED = "app_created"
    APP_UPDATED = "app_updated"
    APP_DELETED = "app_deleted"


class EnterpriseTelemetryHistogram(StrEnum):
    WORKFLOW_DURATION = "workflow_duration"
    NODE_DURATION = "node_duration"
    MESSAGE_DURATION = "message_duration"
    MESSAGE_TTFT = "message_ttft"
    TOOL_DURATION = "tool_duration"
    PROMPT_GENERATION_DURATION = "prompt_generation_duration"


__all__ = [
    "EnterpriseTelemetryCounter",
    "EnterpriseTelemetryEvent",
    "EnterpriseTelemetryHistogram",
    "EnterpriseTelemetrySpan",
]
