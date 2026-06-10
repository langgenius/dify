from __future__ import annotations

import base64
import json
from typing import Literal

import pytest

from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubFileMapping,
    agent_stub_connections_url,
    agent_stub_file_download_request_url,
    agent_stub_file_upload_request_url,
    normalize_agent_stub_url,
    parse_agent_stub_endpoint,
)


def _reference(record_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"record_id": record_id}, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{payload}"


def test_agent_stub_connections_url_handles_trailing_slash_and_no_trailing_slash() -> None:
    assert agent_stub_connections_url("https://agent.example.com/agent-stub") == (
        "https://agent.example.com/agent-stub/connections"
    )
    assert agent_stub_connections_url("https://agent.example.com/agent-stub/") == (
        "https://agent.example.com/agent-stub/connections"
    )


def test_agent_stub_file_request_urls_handle_trailing_slash() -> None:
    assert agent_stub_file_upload_request_url("https://agent.example.com/agent-stub/") == (
        "https://agent.example.com/agent-stub/files/upload-request"
    )
    assert agent_stub_file_download_request_url("https://agent.example.com/agent-stub") == (
        "https://agent.example.com/agent-stub/files/download-request"
    )


def test_normalize_agent_stub_url_rejects_query_and_fragment() -> None:
    with pytest.raises(ValueError, match="query string or fragment"):
        _ = normalize_agent_stub_url("https://agent.example.com/agent-stub?x=1")

    with pytest.raises(ValueError, match="query string or fragment"):
        _ = normalize_agent_stub_url("https://agent.example.com/agent-stub#fragment")


def test_parse_agent_stub_endpoint_rejects_invalid_schemes_and_missing_host() -> None:
    with pytest.raises(ValueError, match="http, https, or grpc"):
        _ = normalize_agent_stub_url("not-a-url")

    with pytest.raises(ValueError, match="http, https, or grpc"):
        _ = normalize_agent_stub_url("ftp://agent.example.com/agent-stub")

    with pytest.raises(ValueError, match="include a host"):
        _ = normalize_agent_stub_url("https:///agent-stub")


def test_parse_agent_stub_endpoint_accepts_grpc_host_and_port() -> None:
    endpoint = parse_agent_stub_endpoint("grpc://agent.example.com:9091")

    assert endpoint.url == "grpc://agent.example.com:9091"
    assert endpoint.is_grpc is True
    assert endpoint.host == "agent.example.com"
    assert endpoint.port == 9091


@pytest.mark.parametrize("invalid_url", ["grpc://agent.example.com", "grpc://agent.example.com:9091/path"])
def test_parse_agent_stub_endpoint_rejects_invalid_grpc_urls(invalid_url: str) -> None:
    with pytest.raises(ValueError):
        _ = parse_agent_stub_endpoint(invalid_url)


def test_agent_stub_file_mapping_validates_reference_and_url_by_transfer_method() -> None:
    reference = _reference("tool-file-1")
    assert AgentStubFileMapping(transfer_method="tool_file", reference=reference).reference == reference
    assert AgentStubFileMapping(transfer_method="remote_url", url="https://example.com/file").url is not None

    with pytest.raises(ValueError, match="reference"):
        _ = AgentStubFileMapping(transfer_method="local_file")

    with pytest.raises(ValueError, match="url"):
        _ = AgentStubFileMapping(transfer_method="remote_url")

    with pytest.raises(ValueError, match="canonical Dify file reference"):
        _ = AgentStubFileMapping(transfer_method="tool_file", reference="raw-tool-file-uuid")


def test_agent_stub_file_mapping_rejects_remote_url_with_reference() -> None:
    reference = _reference("tool-file-1")
    with pytest.raises(ValueError, match="reference is not allowed"):
        _ = AgentStubFileMapping(
            transfer_method="remote_url",
            url="https://example.com/file",
            reference=reference,
        )


@pytest.mark.parametrize("transfer_method", ["tool_file", "local_file", "datasource_file"])
def test_agent_stub_file_mapping_rejects_non_remote_with_url(
    transfer_method: Literal["tool_file", "local_file", "datasource_file"],
) -> None:
    reference = _reference("tool-file-1")
    with pytest.raises(ValueError, match="url is not allowed"):
        _ = AgentStubFileMapping(
            transfer_method=transfer_method,
            reference=reference,
            url="https://example.com/file",
        )
