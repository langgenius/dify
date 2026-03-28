import logging
import os
from collections.abc import Mapping
from typing import Any

import httpx

from core.helper.trace_id_helper import generate_traceparent_header
from services.errors.enterprise import (
    EnterpriseAPIBadRequestError,
    EnterpriseAPIError,
    EnterpriseAPIForbiddenError,
    EnterpriseAPINotFoundError,
    EnterpriseAPIUnauthorizedError,
)

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
        *,
        timeout: float | httpx.Timeout | None = None,
        raise_for_status: bool = False,
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
            # IMPORTANT:
            # - In httpx, passing timeout=None disables timeouts (infinite) and overrides the library default.
            # - To preserve httpx's default timeout behavior for existing call sites, only pass the kwarg when set.
            request_kwargs: dict[str, Any] = {"json": json, "params": params, "headers": headers}
            if timeout is not None:
                request_kwargs["timeout"] = timeout

            response = client.request(method, url, **request_kwargs)

            # Validate HTTP status and raise domain-specific errors
            if not response.is_success:
                cls._handle_error_response(response)
        return response.json()

    @classmethod
    def _handle_error_response(cls, response: httpx.Response) -> None:
        """
        Handle non-2xx HTTP responses by raising appropriate domain errors.

        Attempts to extract error message from JSON response body,
        falls back to status text if parsing fails.
        """
        error_message = f"Enterprise API request failed: {response.status_code} {response.reason_phrase}"

        # Try to extract error message from JSON response
        try:
            error_data = response.json()
            if isinstance(error_data, dict):
                # Common error response formats:
                # {"error": "...", "message": "..."}
                # {"message": "..."}
                # {"detail": "..."}
                error_message = (
                    error_data.get("message") or error_data.get("error") or error_data.get("detail") or error_message
                )
        except Exception:
            # If JSON parsing fails, use the default message
            logger.debug(
                "Failed to parse error response from enterprise API (status=%s)", response.status_code, exc_info=True
            )

        # Raise specific error based on status code
        if response.status_code == 400:
            raise EnterpriseAPIBadRequestError(error_message)
        elif response.status_code == 401:
            raise EnterpriseAPIUnauthorizedError(error_message)
        elif response.status_code == 403:
            raise EnterpriseAPIForbiddenError(error_message)
        elif response.status_code == 404:
            raise EnterpriseAPINotFoundError(error_message)
        else:
            raise EnterpriseAPIError(error_message, status_code=response.status_code)


class EnterpriseRequest(BaseRequest):
    base_url = os.environ.get("ENTERPRISE_API_URL", "ENTERPRISE_API_URL")
    secret_key = os.environ.get("ENTERPRISE_API_SECRET_KEY", "ENTERPRISE_API_SECRET_KEY")
    secret_key_header = "Enterprise-Api-Secret-Key"


class EnterprisePluginManagerRequest(BaseRequest):
    base_url = os.environ.get("ENTERPRISE_PLUGIN_MANAGER_API_URL", "ENTERPRISE_PLUGIN_MANAGER_API_URL")
    secret_key = os.environ.get("ENTERPRISE_PLUGIN_MANAGER_API_SECRET_KEY", "ENTERPRISE_PLUGIN_MANAGER_API_SECRET_KEY")
    secret_key_header = "Plugin-Manager-Inner-Api-Secret-Key"
