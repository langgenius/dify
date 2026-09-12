"""Operation-owned OpenTelemetry credential factories and SSRF-safe HTTP sessions."""

from importlib import metadata
from typing import Any, override
from urllib.parse import urlsplit

import httpx
import requests
from requests.auth import _basic_auth_str

from core.helper.ssl_context import create_ssl_context, read_tls_files
from core.ops.provider_export import TraceExportError, TraceProviderHttpClient
from core.tools.errors import ToolSSRFError
from dify_trace_mlflow.request_auth import MLflowRequestAdapter


class MLflowCollectorRequestAdapter(MLflowRequestAdapter):
    """Select captured TLS when an HTTP request or redirect first reaches HTTPS."""

    def __init__(self, owner: TraceProviderHttpClient, settings: dict[str, Any], session: requests.Session):
        super().__init__(owner)
        self.settings = settings
        self.use_requests_ca = session.trust_env and settings["use_requests_ca"]
        self.session_certificate = session.cert if settings["use_session_certificate"] else None
        self.tls_ready = False

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
        if request.url and urlsplit(request.url).scheme == "https" and not self.tls_ready:
            if self.settings["tls_read_failed"] or (self.use_requests_ca and self.settings["requests_tls_read_failed"]):
                raise ValueError("Cannot read TLS configuration")
            tls = {**self.settings["tls"], **(self.settings["requests_tls"] if self.use_requests_ca else {})}
            if self.session_certificate:
                certificate, key = (
                    (self.session_certificate, None)
                    if isinstance(self.session_certificate, str)
                    else self.session_certificate
                )
                tls.update(read_tls_files({"client_certificate": certificate, "client_key": key}))
            self.ssl_context = create_ssl_context(tls, verify=self.settings["verify"])
            self.tls_ready = True
        return super().send(request, stream=stream, timeout=timeout, verify=verify, cert=cert, proxies=proxies)


def _entrypoint_settings(entrypoint: metadata.EntryPoint) -> dict[str, str | None]:
    distribution = entrypoint.dist
    return {
        "name": entrypoint.name,
        "value": entrypoint.value,
        "distribution": distribution.metadata["Name"] if distribution else None,
        "version": distribution.version if distribution else None,
    }


def capture_credential_provider(name: str | None) -> dict[str, str | None] | None:
    if not name:
        return None
    for entrypoint in metadata.entry_points(group="opentelemetry_otlp_credential_provider", name=name):
        return _entrypoint_settings(entrypoint)
    raise ValueError("MLflow OTLP credential provider is unavailable")


def load_credential_provider(settings: dict[str, Any]) -> Any:
    try:
        for entrypoint in metadata.entry_points(group="opentelemetry_otlp_credential_provider", name=settings["name"]):
            if _entrypoint_settings(entrypoint) == settings:
                return entrypoint.load()()
    except Exception:
        raise TraceExportError("mlflow_otlp_credentials_unavailable") from None
    raise TraceExportError("mlflow_otlp_credentials_changed")


def send_collector_request(client: TraceProviderHttpClient, settings: dict[str, Any], serialized: bytes) -> bytes:
    provider = settings.get("credential_provider")
    session = load_credential_provider(provider) if provider else requests.Session()
    if not isinstance(session, requests.Session):
        raise TraceExportError("mlflow_otlp_http_credentials_invalid")
    try:
        with session:
            adapter = MLflowCollectorRequestAdapter(client, settings, session)
            use_netrc = session.trust_env
            session.trust_env = False
            headers = dict(client.headers)
            netrc_auth = settings.get("netrc_auth", {})

            def apply_netrc(url: str, destination_headers: Any) -> None:
                credentials = netrc_auth.get(urlsplit(url).hostname, netrc_auth.get("default"))
                if credentials and any(credentials):
                    destination_headers["Authorization"] = _basic_auth_str(*credentials)

            if use_netrc and not session.auth:
                apply_netrc(client.endpoint, headers)
            original_rebuild_auth = session.rebuild_auth

            def rebuild_auth(prepared_request: requests.PreparedRequest, response: requests.Response) -> None:
                original_rebuild_auth(prepared_request, response)
                if use_netrc and prepared_request.url:
                    apply_netrc(prepared_request.url, prepared_request.headers)

            # Wrap only this operation-owned Session's redirect authentication.
            session.rebuild_auth = rebuild_auth  # type: ignore[method-assign]
            session.mount("http://", adapter)
            session.mount("https://", adapter)
            response = session.post(client.endpoint, data=serialized, headers=headers)
            return client.check_response(
                httpx.Response(
                    response.status_code,
                    headers={
                        key: value
                        for key, value in response.headers.items()
                        if key.lower() not in {"content-encoding", "transfer-encoding", "content-length"}
                    },
                    content=response.content,
                )
            ).content
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
        raise TraceExportError("mlflow_otlp_authentication_failed") from None
