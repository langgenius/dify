"""MLflow auth plugins with attempt-owned providers and SSRF-protected Requests transport."""

import logging
from importlib import metadata
from time import monotonic
from typing import Any, override
from urllib.parse import urlsplit

import httpx
import requests

from core.helper.ssrf_requests import SSRFRequestsAdapter
from core.ops.provider_export import TraceExportError, TraceProviderHttpClient
from core.tools.errors import ToolSSRFError


def _provider_settings(name: str, entrypoint: metadata.EntryPoint) -> dict[str, str | None]:
    distribution = entrypoint.dist
    return {
        "name": name,
        "entrypoint": entrypoint.name,
        "value": entrypoint.value,
        "distribution": distribution.metadata["Name"] if distribution else None,
        "version": distribution.version if distribution else None,
    }


def capture_request_auth_provider(name: str) -> dict[str, str | None]:
    """Bind plugin selection, not opaque plugin credentials, before crossing the queue.

    The Requests auth-provider contract only exposes get_name/get_auth. Plugins
    resolve their own credentials per request; never probe a dummy request or
    serialize their authentication objects to guess a credential identity.
    """
    try:
        for entrypoint in metadata.entry_points(group="mlflow.request_auth_provider"):
            try:
                provider = entrypoint.load()()
            except (AttributeError, ImportError):
                # The SDK skips unloadable entry points. Exception text may contain secrets.
                logging.getLogger(__name__).warning("Cannot load MLflow request authentication plugin")
                continue
            if provider.get_name() == name:
                return _provider_settings(name, entrypoint)
    except Exception:
        raise ValueError("Cannot resolve MLflow request authentication plugin") from None
    # Like the SDK, an unknown provider leaves existing Basic/Bearer headers intact.
    logging.getLogger(__name__).warning("Selected MLflow request authentication plugin is unavailable")
    return {"name": name}


def load_request_auth_provider(settings: dict[str, Any] | None) -> Any:
    if not settings or "entrypoint" not in settings:
        return None
    try:
        for entrypoint in metadata.entry_points(group="mlflow.request_auth_provider"):
            if _provider_settings(settings["name"], entrypoint) == settings:
                provider = entrypoint.load()()
                if provider.get_name() == settings["name"]:
                    return provider
    except Exception:
        raise TraceExportError("mlflow_auth_plugin_unavailable") from None
    raise TraceExportError("mlflow_auth_plugin_changed")


class MLflowRequestAdapter(SSRFRequestsAdapter):
    """Keep native authentication connections and raw responses under one export deadline."""

    def __init__(self, owner: TraceProviderHttpClient):
        self.owner = owner
        super().__init__(ssl_context=owner.ssl_context)

    @override
    def send(
        self,
        request: requests.PreparedRequest,
        stream: bool = False,
        timeout: Any = None,
        verify: Any = True,
        cert: Any = None,
        proxies: Any = None,
    ) -> requests.Response:
        if request.url is None or request.method is None:
            raise TraceExportError("mlflow_auth_request_invalid")
        parsed = urlsplit(request.url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise TraceExportError("mlflow_auth_request_invalid")
        remaining = self.owner.deadline - monotonic()
        if remaining <= 0:
            raise TraceExportError("export_deadline_exceeded", retryable=True)
        return super().send(
            request,
            stream=stream,
            timeout=min(self.owner.request_timeout, remaining),
            verify=verify,
            cert=cert,
            proxies=proxies,
        )


def send_authenticated_request(
    client: TraceProviderHttpClient, provider: Any, method: str, path: str, **kwargs: Any
) -> httpx.Response:
    try:
        headers = {**client.headers, **kwargs.pop("headers", {})}
        if "content" in kwargs:
            kwargs["data"] = kwargs.pop("content")
        with requests.Session() as session:
            # Authentication selection, proxy and TLS policy belong to this operation.
            session.trust_env = False
            adapter = MLflowRequestAdapter(client)
            session.mount("http://", adapter)
            session.mount("https://", adapter)
            response = session.request(
                method,
                f"{client.endpoint}/{path.lstrip('/')}" if path else client.endpoint,
                headers=headers,
                auth=provider.get_auth(),
                allow_redirects=False,
                **kwargs,
            )
            return client.check_response(
                httpx.Response(
                    response.status_code,
                    # Requests exposes a decoded body; HTTPX must not decode it again.
                    headers={
                        key: value
                        for key, value in response.headers.items()
                        if key.lower() not in {"content-encoding", "transfer-encoding", "content-length"}
                    },
                    content=response.content,
                    request=httpx.Request(response.request.method or method, response.url),
                )
            )
    except TraceExportError:
        raise
    except (
        requests.ConnectionError,
        requests.Timeout,
        requests.exceptions.ChunkedEncodingError,
        requests.exceptions.ContentDecodingError,
    ):
        raise TraceExportError("provider_unreachable", retryable=True) from None
    except ToolSSRFError:
        raise TraceExportError("provider_ssrf_blocked") from None
    except Exception:
        raise TraceExportError("mlflow_authentication_failed") from None
