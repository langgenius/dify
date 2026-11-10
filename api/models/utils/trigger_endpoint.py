from yarl import URL

from configs import dify_config

"""
Basic URL for third-party trigger services
"""
base_url = URL(dify_config.TRIGGER_URL)


def generate_trigger_plugin_icon_url(tenant_id: str, filename: str | None) -> str:
    """Keep the legacy icon query string, including 'None' for a missing filename."""
    return (
        f"{dify_config.CONSOLE_API_URL}/console/api/workspaces/current/plugin/icon"
        f"?tenant_id={tenant_id}&filename={filename}"
    )


def generate_plugin_trigger_endpoint_url(endpoint_id: str) -> str:
    """
    Generate url for plugin trigger endpoint url
    """

    return str(base_url / "triggers" / "plugin" / endpoint_id)


def generate_webhook_trigger_endpoint(webhook_id: str, debug: bool = False) -> str:
    """
    Generate url for webhook trigger endpoint url
    """

    return str(base_url / "triggers" / ("webhook-debug" if debug else "webhook") / webhook_id)
