"""Dify-specific semantic convention definitions."""


class DifySpanAttributes:
    """Attribute names for Dify-specific spans."""

    APP_ID = "dify.app.id"
    """Application identifier."""

    TENANT_ID = "dify.tenant.id"
    """Tenant identifier."""

    USER_TYPE = "dify.user.type"
    """User type, e.g. Account, EndUser."""

    STREAMING = "dify.streaming"
    """Whether streaming response is enabled."""

    WORKFLOW_ID = "dify.workflow.id"
    """Workflow identifier."""

    INVOKE_FROM = "dify.invoke_from"
    """Invocation source, e.g. SERVICE_API, WEB_APP, DEBUGGER."""
