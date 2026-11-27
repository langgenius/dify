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
    file_reference,
    file_reference_record_id,
    format_media_observation,
    is_canonical_dify_file_reference,
    is_safe_dify_file_uri,
    normalize_agent_stub_api_base_url,
)


def _reference(record_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"record_id": record_id}, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{payload}"


def test_file_reference_has_canonical_wire_format() -> None:
    assert file_reference("00000000-0000-4000-8000-000000000001") == (
        "dify-file-ref:eyJyZWNvcmRfaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ=="
    )


@pytest.mark.parametrize(
    "reference",
    [
        "dify-file-ref:eyJyZWNvcmRfaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ==",
        # API references may also retain a storage_key for compatibility.
        "dify-file-ref:eyJyZWNvcmRfaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEi"
        "LCJzdG9yYWdlX2tleSI6InRvb2xfZmlsZXMvdC9maWxlLmJpbiJ9",
    ],
)
def test_file_reference_record_id_accepts_api_wire_formats(reference: str) -> None:
    assert is_canonical_dify_file_reference(reference)
    assert file_reference_record_id(reference) == "00000000-0000-4000-8000-000000000001"


@pytest.mark.parametrize(
    "reference",
    [
        "saved",
        "dify-file-ref:saved",
        "dify-file-ref:W10=",
        "dify-file-ref:e30=",
        "dify-file-ref:eyJyZWNvcmRfaWQiOiIifQ==",
    ],
)
def test_invalid_file_reference_has_no_record_id(reference: str) -> None:
    assert not is_canonical_dify_file_reference(reference)
    with pytest.raises(ValueError, match="canonical Dify file reference"):
        file_reference_record_id(reference)


@pytest.mark.parametrize(
    "mapping,filename,mime_type,size,delivered_to_user,expected",
    [
        (
            AgentStubFileMapping(
                transfer_method="tool_file",
                reference="dify-file-ref:eyJyZWNvcmRfaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ==",
            ),
            None,
            None,
            None,
            False,
            '\nTool generated media file: {"transfer_method":"tool_file",'
            '"reference":"dify-file-ref:eyJyZWNvcmRfaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ=="}'
            " (call `read_media` with `file` set to this object only if you need to inspect its content).\n",
        ),
        (
            AgentStubFileMapping(
                transfer_method="tool_file",
                reference="dify-file-ref:eyJyZWNvcmRfaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ==",
            ),
            "图.png",
            "image/png",
            3,
            False,
            '\nTool generated media file: {"transfer_method":"tool_file",'
            '"reference":"dify-file-ref:eyJyZWNvcmRfaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ==",'
            '"filename":"图.png","mime_type":"image/png","size":3}'
            " (call `read_media` with `file` set to this object only if you need to inspect its content).\n",
        ),
        (
            AgentStubFileMapping(
                transfer_method="tool_file",
                reference="dify-file-ref:eyJyZWNvcmRfaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ==",
            ),
            "report.pdf",
            "application/pdf",
            128,
            True,
            '\nTool generated media file: {"transfer_method":"tool_file",'
            '"reference":"dify-file-ref:eyJyZWNvcmRfaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ==",'
            '"filename":"report.pdf","mime_type":"application/pdf","size":128}'
            " (already delivered to the user as an attachment; call `read_media` with `file` set to this object"
            " only if you need to inspect its content).\n",
        ),
        (
            AgentStubFileMapping(transfer_method="remote_url", url="https://example.com/chart.png?key=original"),
            "chart.png",
            None,
            None,
            False,
            '\nTool generated media link: {"transfer_method":"remote_url",'
            '"url":"https://example.com/chart.png?key=original","filename":"chart.png"}'
            " (call `read_media` with `file` set to this object only if you need to inspect its content).\n",
        ),
    ],
)
def test_format_media_observation_wire_format(
    mapping: AgentStubFileMapping,
    filename: str | None,
    mime_type: str | None,
    size: int | None,
    delivered_to_user: bool,
    expected: str,
) -> None:
    assert (
        format_media_observation(
            mapping,
            filename=filename,
            mime_type=mime_type,
            size=size,
            delivered_to_user=delivered_to_user,
        )
        == expected
    )


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


@pytest.mark.parametrize(
    ("uri", "expected"),
    [
        ("/files/upload/for-plugin?sign=1", True),
        ("/files/tools/report.pdf?sign=1&timestamp=2", True),
        ("/files/tools/my%20report.pdf", True),
        ("/files/tools/../report.pdf", True),
        ("https://api.example/files/upload/for-plugin?sign=1", False),
        ("//api.example/files/upload/for-plugin?sign=1", False),
        ("/files/upload/for-plugin#fragment", False),
        ("files/upload/for-plugin", False),
        ("/other/report.pdf", False),
        ("/files/", False),
        ("/files/../other/report.pdf", False),
        ("/files/%2e%2e/other/report.pdf", False),
        ("/files/%252e%252e/other/report.pdf", False),
        ("/files/tools\\report.pdf", False),
        ("/files/tools%5creport.pdf", False),
        ("", False),
    ],
)
def test_is_safe_dify_file_uri(uri: str, expected: bool) -> None:
    assert is_safe_dify_file_uri(uri) is expected


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


@pytest.mark.parametrize("reference", ["raw-tool-file-uuid", "dify-file-ref:W10="])
def test_agent_stub_file_mapping_rejects_noncanonical_references(reference: str) -> None:
    with pytest.raises(ValidationError, match="canonical Dify file reference"):
        _ = AgentStubFileMapping(transfer_method="tool_file", reference=reference)


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
