from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from dify_agent.agent_stub.cli._files import download_file_from_environment, upload_file_from_environment
from dify_agent.agent_stub.client._back_proxy import BackProxyTransferError


def _reference(record_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"record_id": record_id}, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{payload}"


def test_upload_file_from_environment_requests_signed_url_and_normalizes_output(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    source = tmp_path / "report.pdf"
    source.write_bytes(b"report-bytes")
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_URL", "https://agent.example.com/back-proxy")
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_AUTH_JWE", "test-jwe")

    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._files.request_back_proxy_file_upload_sync",
        lambda **_kwargs: type("Response", (), {"upload_url": "https://files.example.com/upload"})(),
    )
    captured = {}

    def fake_upload_file_to_signed_url_sync(**kwargs):
        captured["filename"] = kwargs["filename"]
        captured["mimetype"] = kwargs["mimetype"]
        captured["file_bytes"] = kwargs["file_obj"].read()
        kwargs["file_obj"].seek(0)
        return {
            "reference": _reference("tool-file-1"),
        }

    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._files.upload_file_to_signed_url_sync",
        fake_upload_file_to_signed_url_sync,
    )

    result = upload_file_from_environment(path=str(source))

    assert result.model_dump() == {
        "transfer_method": "tool_file",
        "reference": _reference("tool-file-1"),
    }
    assert captured == {
        "filename": "report.pdf",
        "mimetype": "application/pdf",
        "file_bytes": b"report-bytes",
    }


def test_download_file_from_environment_saves_bytes_and_renames_on_collision(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    target_dir = tmp_path / "downloads"
    target_dir.mkdir()
    (target_dir / "report.pdf").write_bytes(b"existing")
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_URL", "https://agent.example.com/back-proxy")
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_AUTH_JWE", "test-jwe")

    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._files.request_back_proxy_file_download_sync",
        lambda **_kwargs: type(
            "Response",
            (),
            {
                "filename": "report.pdf",
                "mime_type": "application/pdf",
                "size": 12,
                "download_url": "https://files.example.com/download",
            },
        )(),
    )
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._files.download_file_bytes_from_signed_url_sync",
        lambda **_kwargs: b"downloaded",
    )

    result = download_file_from_environment(
        transfer_method="tool_file",
        reference_or_url=_reference("tool-file-1"),
        directory=str(target_dir),
    )

    assert result.path.name == "report (1).pdf"
    assert result.path.read_bytes() == b"downloaded"


def test_download_file_from_environment_sanitizes_server_filename(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    target_dir = tmp_path / "downloads"
    target_dir.mkdir()
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_URL", "https://agent.example.com/back-proxy")
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_AUTH_JWE", "test-jwe")

    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._files.request_back_proxy_file_download_sync",
        lambda **_kwargs: type(
            "Response",
            (),
            {
                "filename": "../nested/evil.txt",
                "mime_type": "text/plain",
                "size": 12,
                "download_url": "https://files.example.com/download",
            },
        )(),
    )
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._files.download_file_bytes_from_signed_url_sync",
        lambda **_kwargs: b"downloaded",
    )

    result = download_file_from_environment(
        transfer_method="tool_file",
        reference_or_url=_reference("tool-file-1"),
        directory=str(target_dir),
    )

    assert result.path.parent == target_dir
    assert result.path.name == "evil.txt"
    assert result.path.read_bytes() == b"downloaded"


def test_upload_file_from_environment_rejects_non_canonical_reference(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    source = tmp_path / "report.pdf"
    source.write_bytes(b"report-bytes")
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_URL", "https://agent.example.com/back-proxy")
    monkeypatch.setenv("DIFY_AGENT_BACK_PROXY_AUTH_JWE", "test-jwe")

    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._files.request_back_proxy_file_upload_sync",
        lambda **_kwargs: type("Response", (), {"upload_url": "https://files.example.com/upload"})(),
    )
    monkeypatch.setattr(
        "dify_agent.agent_stub.cli._files.upload_file_to_signed_url_sync",
        lambda **_kwargs: {"reference": "raw-tool-file-uuid"},
    )

    with pytest.raises(BackProxyTransferError, match="invalid canonical reference"):
        _ = upload_file_from_environment(path=str(source))
