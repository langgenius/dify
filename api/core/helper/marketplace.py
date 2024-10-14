from yarl import URL

from configs import dify_config
from core.helper.download import download_with_size_limit


def get_plugin_pkg_url(plugin_unique_identifier: str):
    return (
        URL(str(dify_config.MARKETPLACE_API_URL))
        / "api/v1/plugins/download"
    ).with_query(unique_identifier=plugin_unique_identifier)


def download_plugin_pkg(plugin_unique_identifier: str):
    url = str(get_plugin_pkg_url(plugin_unique_identifier))
    return download_with_size_limit(url, 15 * 1024 * 1024)
