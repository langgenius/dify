"""Translate shared discovery failures into sanitized native plugin errors."""

from collections.abc import Mapping

from dify_plugin.errors.model import (
    InvokeAuthorizationError,
    InvokeConnectionError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)

from model_catalog import (
    CatalogAuthorizationError,
    CatalogConnectionError,
    CatalogRateLimitError,
    CatalogUnavailableError,
    fetch_catalog,
)


def discover_models(
    credentials: Mapping, *, force_refresh: bool = False
) -> list[dict]:
    try:
        return fetch_catalog(credentials.get("api_key", ""), force_refresh=force_refresh)
    except CatalogAuthorizationError:
        raise InvokeAuthorizationError(
            "AMDGPUCloud model catalog credentials are invalid"
        ) from None
    except CatalogConnectionError:
        raise InvokeConnectionError("AMDGPUCloud model discovery connection failed") from None
    except CatalogRateLimitError:
        raise InvokeRateLimitError("AMDGPUCloud model discovery was rate limited") from None
    except CatalogUnavailableError:
        raise InvokeServerUnavailableError("AMDGPUCloud model catalog is unavailable") from None