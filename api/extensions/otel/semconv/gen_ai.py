"""
GenAI semantic conventions.
"""


class GenAIAttributes:
    """Common GenAI attribute keys."""

    USER_ID = "gen_ai.user.id"
    """Identifier of the end user in the application layer."""

    FRAMEWORK = "gen_ai.framework"
    """Framework type. Fixed to 'dify' in this project."""

    SPAN_KIND = "gen_ai.span.kind"
    """Operation type. Extended specification, not in OTel standard."""


class ChainAttributes:
    """Chain operation attribute keys."""

    OPERATION_NAME = "gen_ai.operation.name"
    """Secondary operation type, e.g. WORKFLOW, TASK."""

    INPUT_VALUE = "input.value"
    """Input content."""

    OUTPUT_VALUE = "output.value"
    """Output content."""

    TIME_TO_FIRST_TOKEN = "gen_ai.user.time_to_first_token"
    """Time to first token in nanoseconds from receiving the request to first token return."""


class RetrieverAttributes:
    """Retriever operation attribute keys."""

    QUERY = "retrieval.query"
    """Retrieval query string."""

    DOCUMENT = "retrieval.document"
    """Retrieved document list as JSON array."""


class ToolAttributes:
    """Tool operation attribute keys."""

    TOOL_CALL_ID = "gen_ai.tool.call.id"
    """Tool call identifier."""

    TOOL_DESCRIPTION = "gen_ai.tool.description"
    """Tool description."""

    TOOL_NAME = "gen_ai.tool.name"
    """Tool name."""

    TOOL_TYPE = "gen_ai.tool.type"
    """Tool type. Examples: function, extension, datastore."""

    TOOL_CALL_ARGUMENTS = "gen_ai.tool.call.arguments"
    """Tool invocation arguments."""

    TOOL_CALL_RESULT = "gen_ai.tool.call.result"
    """Tool invocation result."""


class LLMAttributes:
    """LLM operation attribute keys."""

    REQUEST_MODEL = "gen_ai.request.model"
    """Model identifier."""

    PROVIDER_NAME = "gen_ai.provider.name"
    """Provider name."""

    USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
    """Number of input tokens."""

    USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"
    """Number of output tokens."""

    USAGE_TOTAL_TOKENS = "gen_ai.usage.total_tokens"
    """Total number of tokens."""

    PROMPT = "gen_ai.prompt"
    """Prompt text."""

    COMPLETION = "gen_ai.completion"
    """Completion text."""

    RESPONSE_FINISH_REASON = "gen_ai.response.finish_reason"
    """Finish reason for the response."""

    INPUT_MESSAGE = "gen_ai.input.messages"
    """Input messages in structured format."""

    OUTPUT_MESSAGE = "gen_ai.output.messages"
    """Output messages in structured format."""
