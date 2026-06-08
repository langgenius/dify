from __future__ import annotations

import base64
import json
from typing import Literal

import pytest

from dify_agent.agent_stub.protocol.back_proxy import (
    BackProxyFileMapping,
    back_proxy_connections_url,
    back_proxy_file_download_request_url,
    back_proxy_file_upload_request_url,
    normalize_back_proxy_base_url,
)


def _reference(record_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"record_id": record_id}, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{payload}"


def test_back_proxy_connections_url_handles_trailing_slash_and_no_trailing_slash() -> None:
    assert back_proxy_connections_url("https://agent.example.com/back-proxy") == (
        "https://agent.example.com/back-proxy/connections"
    )
    assert back_proxy_connections_url("https://agent.example.com/back-proxy/") == (
        "https://agent.example.com/back-proxy/connections"
    )


def test_back_proxy_file_request_urls_handle_trailing_slash() -> None:
    assert back_proxy_file_upload_request_url("https://agent.example.com/back-proxy/") == (
        "https://agent.example.com/back-proxy/files/upload-request"
    )
    assert back_proxy_file_download_request_url("https://agent.example.com/back-proxy") == (
        "https://agent.example.com/back-proxy/files/download-request"
    )


def test_normalize_back_proxy_base_url_rejects_query_and_fragment() -> None:
    with pytest.raises(ValueError, match="query string or fragment"):
        _ = normalize_back_proxy_base_url("https://agent.example.com/back-proxy?x=1")

    with pytest.raises(ValueError, match="query string or fragment"):
        _ = normalize_back_proxy_base_url("https://agent.example.com/back-proxy#fragment")


def test_normalize_back_proxy_base_url_rejects_non_http_urls_and_missing_host() -> None:
    with pytest.raises(ValueError, match="http or https"):
        _ = normalize_back_proxy_base_url("not-a-url")

    with pytest.raises(ValueError, match="http or https"):
        _ = normalize_back_proxy_base_url("ftp://agent.example.com/back-proxy")

    with pytest.raises(ValueError, match="include a host"):
        _ = normalize_back_proxy_base_url("https:///back-proxy")


def test_back_proxy_file_mapping_validates_reference_and_url_by_transfer_method() -> None:
    reference = _reference("tool-file-1")
    assert BackProxyFileMapping(transfer_method="tool_file", reference=reference).reference == reference
    assert BackProxyFileMapping(transfer_method="remote_url", url="https://example.com/file").url is not None

    with pytest.raises(ValueError, match="reference"):
        _ = BackProxyFileMapping(transfer_method="local_file")

    with pytest.raises(ValueError, match="url"):
        _ = BackProxyFileMapping(transfer_method="remote_url")

    with pytest.raises(ValueError, match="canonical Dify file reference"):
        _ = BackProxyFileMapping(transfer_method="tool_file", reference="raw-tool-file-uuid")


def test_back_proxy_file_mapping_rejects_remote_url_with_reference() -> None:
    reference = _reference("tool-file-1")
    with pytest.raises(ValueError, match="reference is not allowed"):
        _ = BackProxyFileMapping(
            transfer_method="remote_url",
            url="https://example.com/file",
            reference=reference,
        )


@pytest.mark.parametrize("transfer_method", ["tool_file", "local_file", "datasource_file"])
def test_back_proxy_file_mapping_rejects_non_remote_with_url(
    transfer_method: Literal["tool_file", "local_file", "datasource_file"],
) -> None:
    reference = _reference("tool-file-1")
    with pytest.raises(ValueError, match="url is not allowed"):
        _ = BackProxyFileMapping(
            transfer_method=transfer_method,
            reference=reference,
            url="https://example.com/file",
        )
