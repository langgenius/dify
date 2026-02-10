import logging
from collections.abc import Sequence

import httpx
from yarl import URL

from configs import dify_config
from core.helper.download import download_with_size_limit
from core.plugin.entities.marketplace import MarketplacePluginDeclaration, MarketplacePluginSnapshot
from extensions.ext_redis import redis_client

marketplace_api_url = URL(str(dify_config.MARKETPLACE_API_URL))
logger = logging.getLogger(__name__)


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


def record_install_plugin_event(plugin_unique_identifier: str):
    url = str(marketplace_api_url / "api/v1/stats/plugins/install_count")
    response = httpx.post(url, json={"unique_identifier": plugin_unique_identifier})
    response.raise_for_status()


def fetch_global_plugin_manifest(cache_key_prefix: str, cache_ttl: int) -> None:
    """
    Fetch all plugin manifests from marketplace and cache them in Redis.
    This should be called once per check cycle to populate the instance-level cache.

    Args:
        cache_key_prefix: Redis key prefix for caching plugin manifests
        cache_ttl: Cache TTL in seconds

    Raises:
        httpx.HTTPError: If the HTTP request fails
        Exception: If any other error occurs during fetching or caching
    """
    url = str(marketplace_api_url / "api/v1/dist/plugins/manifest.json")
    response = httpx.get(url, headers={"X-Dify-Version": dify_config.project.version}, timeout=30)
    response.raise_for_status()

    raw_json = response.json()
    plugins_data = raw_json.get("plugins", [])

    # Parse and cache all plugin snapshots
    for plugin_data in plugins_data:
        plugin_snapshot = MarketplacePluginSnapshot.model_validate(plugin_data)
        redis_client.setex(
            name=f"{cache_key_prefix}{plugin_snapshot.plugin_id}",
            time=cache_ttl,
            value=plugin_snapshot.model_dump_json(),
        )
