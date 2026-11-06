"""Framework-neutral trigger failures."""


class WebhookBodyTooLargeError(Exception):
    """The webhook payload exceeds the configured admission limit."""
