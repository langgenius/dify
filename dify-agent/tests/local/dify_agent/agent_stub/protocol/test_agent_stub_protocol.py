from __future__ import annotations

import base64
import json
from typing import Literal

import pytest
from pydantic import ValidationError

from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubConfigDownloadSource,
    AgentStubFileDownloadRequest,
    AgentStubFileMapping,
    AgentStubFileUploadRequest,
    agent_stub_connections_url,
    agent_stub_file_download_request_url,
    agent_stub_file_upload_request_url,
    normalize_agent_stub_api_base_url,
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


def test_agent_stub_connections_url_normalizes_service_root_to_agent_stub_base() -> None:
    assert agent_stub_connections_url("https://agent.example.com") == (
        "https://agent.example.com/agent-stub/connections"
    )


def test_agent_stub_file_request_urls_handle_trailing_slash() -> None:
    assert agent_stub_file_upload_request_url("https://agent.example.com/agent-stub/") == (
        "https://agent.example.com/agent-stub/files/upload-request"
    )
    assert agent_stub_file_download_request_url("https://agent.example.com/agent-stub") == (
        "https://agent.example.com/agent-stub/files/download-request"
    )


def test_agent_stub_file_upload_request_rejects_client_max_size() -> None:
    with pytest.raises(ValidationError, match="extra_forbidden"):
        AgentStubFileUploadRequest.model_validate(
            {"filename": "report.pdf", "mimetype": "application/pdf", "max_size": 1024}
        )


def test_normalize_agent_stub_api_base_url_rejects_query_and_fragment() -> None:
    with pytest.raises(ValueError, match="query string or fragment"):
        _ = normalize_agent_stub_api_base_url("https://agent.example.com/agent-stub?x=1")

    with pytest.raises(ValueError, match="query string or fragment"):
        _ = normalize_agent_stub_api_base_url("https://agent.example.com/agent-stub#fragment")


def test_normalize_agent_stub_api_base_url_accepts_service_root_or_agent_stub_root_only() -> None:
    assert normalize_agent_stub_api_base_url("https://agent.example.com") == "https://agent.example.com/agent-stub"
    assert normalize_agent_stub_api_base_url("https://agent.example.com/agent-stub/") == (
        "https://agent.example.com/agent-stub"
    )

    with pytest.raises(ValueError, match="empty or /agent-stub"):
        _ = normalize_agent_stub_api_base_url("https://agent.example.com/foo")


def test_parse_agent_stub_endpoint_rejects_invalid_schemes_and_missing_host() -> None:
    with pytest.raises(ValueError, match="http or https"):
        _ = normalize_agent_stub_api_base_url("not-a-url")

    with pytest.raises(ValueError, match="http or https"):
        _ = normalize_agent_stub_api_base_url("ftp://agent.example.com/agent-stub")

    with pytest.raises(ValueError, match="include a host"):
        _ = normalize_agent_stub_api_base_url("https:///agent-stub")


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


def test_agent_stub_file_download_request_accepts_legacy_http_audience_alias() -> None:
    mapping = {"transfer_method": "tool_file", "reference": _reference("tool-file-1")}

    request = AgentStubFileDownloadRequest.model_validate({"file": mapping, "for_external": False})

    assert request.for_frontend is False
    assert request.model_dump() == {
        "file": {"transfer_method": "tool_file", "reference": _reference("tool-file-1"), "url": None},
        "config": None,
        "for_frontend": False,
    }

    with pytest.raises(ValidationError):
        _ = AgentStubFileDownloadRequest.model_validate({"file": mapping, "for_frontend": True, "for_external": False})


def test_agent_stub_file_download_request_accepts_exactly_one_sandbox_config_source() -> None:
    request = AgentStubFileDownloadRequest(
        config=AgentStubConfigDownloadSource(kind="skill", name="alpha"),
        for_frontend=False,
    )

    assert request.config == AgentStubConfigDownloadSource(kind="skill", name="alpha")
    with pytest.raises(ValidationError, match="exactly one"):
        _ = AgentStubFileDownloadRequest(for_frontend=False)
    with pytest.raises(ValidationError, match="exactly one"):
        _ = AgentStubFileDownloadRequest(
            file=AgentStubFileMapping(transfer_method="tool_file", reference=_reference("tool-file-1")),
            config=AgentStubConfigDownloadSource(kind="file", name="guide.txt"),
            for_frontend=False,
        )
    with pytest.raises(ValidationError, match="Sandbox data plane"):
        _ = AgentStubFileDownloadRequest(
            config=AgentStubConfigDownloadSource(kind="file", name="guide.txt"),
            for_frontend=True,
        )


@pytest.mark.parametrize(
    ("source", "message"),
    [
        ({"kind": "file", "name": "../guide.txt"}, "safe path segment"),
        ({"kind": "skill", "name": "Alpha"}, "skill name is invalid"),
        ({"kind": "file", "name": "guide.txt", "tenant_id": "tenant-1"}, "extra_forbidden"),
    ],
)
def test_agent_stub_config_download_source_rejects_invalid_names_and_identity_fields(
    source: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(ValidationError, match=message):
        _ = AgentStubConfigDownloadSource.model_validate(source)


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
