from core.workflow.nodes.base.exc import BaseNodeError


class WebhookNodeError(BaseNodeError):
    """Base webhook node error."""

    pass


class WebhookTimeoutError(WebhookNodeError):
    """Webhook timeout error."""

    pass


class WebhookNotFoundError(WebhookNodeError):
    """Webhook not found error."""

    pass


class WebhookConfigError(WebhookNodeError):
    """Webhook configuration error."""

    pass
