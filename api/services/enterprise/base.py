import logging
import os
from collections.abc import Mapping
from typing import Any

import httpx

from core.helper.trace_id_helper import generate_traceparent_header

logger = logging.getLogger(__name__)


class BaseRequest:
    proxies: Mapping[str, str] | None = {
        "http": "",
        "https": "",
    }
    base_url = ""
    secret_key = ""
    secret_key_header = ""

    @classmethod
    def _build_mounts(cls) -> dict[str, httpx.BaseTransport] | None:
        if not cls.proxies:
            return None

        mounts: dict[str, httpx.BaseTransport] = {}
        for scheme, value in cls.proxies.items():
            if not value:
                continue
            key = f"{scheme}://" if not scheme.endswith("://") else scheme
            mounts[key] = httpx.HTTPTransport(proxy=value)
        return mounts or None

    @classmethod
    def send_request(
        cls,
        method: str,
        endpoint: str,
        json: Any | None = None,
        params: Mapping[str, Any] | None = None,
    ) -> Any:
        headers = {"Content-Type": "application/json", cls.secret_key_header: cls.secret_key}
        url = f"{cls.base_url}{endpoint}"
        mounts = cls._build_mounts()

        try:
            # ensure traceparent even when OTEL is disabled
            traceparent = generate_traceparent_header()
            if traceparent:
                headers["traceparent"] = traceparent
        except Exception:
            logger.debug("Failed to generate traceparent header", exc_info=True)

        with httpx.Client(mounts=mounts) as client:
            response = client.request(method, url, json=json, params=params, headers=headers)
        return response.json()


class EnterpriseRequest(BaseRequest):
    base_url = os.environ.get("ENTERPRISE_API_URL", "ENTERPRISE_API_URL")
    secret_key = os.environ.get("ENTERPRISE_API_SECRET_KEY", "ENTERPRISE_API_SECRET_KEY")
    secret_key_header = "Enterprise-Api-Secret-Key"


class EnterprisePluginManagerRequest(BaseRequest):
    base_url = os.environ.get("ENTERPRISE_PLUGIN_MANAGER_API_URL", "ENTERPRISE_PLUGIN_MANAGER_API_URL")
    secret_key = os.environ.get("ENTERPRISE_PLUGIN_MANAGER_API_SECRET_KEY", "ENTERPRISE_PLUGIN_MANAGER_API_SECRET_KEY")
    secret_key_header = "Plugin-Manager-Inner-Api-Secret-Key"
