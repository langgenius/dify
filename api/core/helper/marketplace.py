from collections.abc import Sequence

import httpx
from yarl import URL

from configs import dify_config
from core.helper.download import download_with_size_limit
from core.plugin.entities.marketplace import MarketplacePluginDeclaration

marketplace_api_url = URL(str(dify_config.MARKETPLACE_API_URL))


def get_plugin_pkg_url(plugin_unique_identifier: str) -> str:
    return str((marketplace_api_url / "api/v1/plugins/download").with_query(unique_identifier=plugin_unique_identifier))


def download_plugin_pkg(plugin_unique_identifier: str):
    return download_with_size_limit(get_plugin_pkg_url(plugin_unique_identifier), dify_config.PLUGIN_MAX_PACKAGE_SIZE)


def batch_fetch_plugin_manifests(plugin_ids: list[str]) -> Sequence[MarketplacePluginDeclaration]:
    if len(plugin_ids) == 0:
        return []

    url = str(marketplace_api_url / "api/v1/plugins/batch")
    response = httpx.post(url, json={"plugin_ids": plugin_ids}, headers={"X-Dify-Version": dify_config.project.version})
    response.raise_for_status()

    return [MarketplacePluginDeclaration.model_validate(plugin) for plugin in response.json()["data"]["plugins"]]


def batch_fetch_plugin_by_ids(plugin_ids: list[str]) -> list[dict]:
    if not plugin_ids:
        return []

    url = str(marketplace_api_url / "api/v1/plugins/batch")
    response = httpx.post(url, json={"plugin_ids": plugin_ids}, headers={"X-Dify-Version": dify_config.project.version})
    response.raise_for_status()

    data = response.json()
    return data.get("data", {}).get("plugins", [])


def batch_fetch_plugin_manifests_ignore_deserialization_error(
    plugin_ids: list[str],
) -> Sequence[MarketplacePluginDeclaration]:
    if len(plugin_ids) == 0:
        return []

    url = str(marketplace_api_url / "api/v1/plugins/batch")
    response = httpx.post(url, json={"plugin_ids": plugin_ids}, headers={"X-Dify-Version": dify_config.project.version})
    response.raise_for_status()
    result: list[MarketplacePluginDeclaration] = []
    for plugin in response.json()["data"]["plugins"]:
        try:
            result.append(MarketplacePluginDeclaration.model_validate(plugin))
        except Exception:
            pass

    return result


def record_install_plugin_event(plugin_unique_identifier: str):
    url = str(marketplace_api_url / "api/v1/stats/plugins/install_count")
    response = httpx.post(url, json={"unique_identifier": plugin_unique_identifier})
    response.raise_for_status()
