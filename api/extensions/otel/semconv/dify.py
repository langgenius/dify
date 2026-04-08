"""Dify-specific semantic convention definitions."""


class DifySpanAttributes:
    """Attribute names for Dify-specific spans."""

    APP_ID = "dify.app_id"
    """Application identifier."""

    TENANT_ID = "dify.tenant_id"
    """Tenant identifier."""

    USER_TYPE = "dify.user_type"
    """User type, e.g. Account, EndUser."""

    STREAMING = "dify.streaming"
    """Whether streaming response is enabled."""

    WORKFLOW_ID = "dify.workflow_id"
    """Workflow identifier."""

    INVOKE_FROM = "dify.invoke_from"
    """Invocation source, e.g. SERVICE_API, WEB_APP, DEBUGGER."""

    INVOKED_BY = "dify.invoked_by"
    """Invoked by, e.g. end_user, account, user."""

    USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
    """Number of input tokens (prompt tokens) used."""

    USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"
    """Number of output tokens (completion tokens) generated."""

    USAGE_TOTAL_TOKENS = "gen_ai.usage.total_tokens"
    """Total number of tokens used."""
