from collections.abc import Sequence

import requests
from yarl import URL

from configs import dify_config
from core.helper.download import download_with_size_limit
from core.plugin.entities.marketplace import MarketplacePluginDeclaration


def get_plugin_pkg_url(plugin_unique_identifier: str):
    return (URL(str(dify_config.MARKETPLACE_API_URL)) / "api/v1/plugins/download").with_query(
        unique_identifier=plugin_unique_identifier
    )


def download_plugin_pkg(plugin_unique_identifier: str):
    url = str(get_plugin_pkg_url(plugin_unique_identifier))
    return download_with_size_limit(url, dify_config.PLUGIN_MAX_PACKAGE_SIZE)


def batch_fetch_plugin_manifests(plugin_ids: list[str]) -> Sequence[MarketplacePluginDeclaration]:
    if len(plugin_ids) == 0:
        return []

    url = str(URL(str(dify_config.MARKETPLACE_API_URL)) / "api/v1/plugins/batch")
    proxies = None
    if dify_config.PROXY_HTTP_URL and dify_config.PROXY_HTTPS_URL:
        proxies = {
            "http": dify_config.PROXY_HTTP_URL,
            "https": dify_config.PROXY_HTTPS_URL,
        }
    response = requests.post(url, json={"plugin_ids": plugin_ids}, proxies=proxies)
    response.raise_for_status()
    return [MarketplacePluginDeclaration(**plugin) for plugin in response.json()["data"]["plugins"]]


def record_install_plugin_event(plugin_unique_identifier: str):
    url = str(URL(str(dify_config.MARKETPLACE_API_URL)) / "api/v1/stats/plugins/install_count")
    proxies = None
    if dify_config.PROXY_HTTP_URL and dify_config.PROXY_HTTPS_URL:
        proxies = {
            "http": dify_config.PROXY_HTTP_URL,
            "https": dify_config.PROXY_HTTPS_URL,
        }
    response = requests.post(url, json={"unique_identifier": plugin_unique_identifier}, proxies=proxies)
    response.raise_for_status()
