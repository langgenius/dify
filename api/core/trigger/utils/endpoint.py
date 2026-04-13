from yarl import URL

from configs import dify_config

"""
Basic URL for thirdparty trigger services
"""
base_url = URL(dify_config.TRIGGER_URL)


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
