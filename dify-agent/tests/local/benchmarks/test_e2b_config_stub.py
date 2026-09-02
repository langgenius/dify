from __future__ import annotations

from contextlib import contextmanager
import io
import json
from pathlib import Path
import threading
from typing import Iterator
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

import pytest

from benchmarks.e2b_config_stub import (
    E2B_CONFIG_STUB_DEFAULT_ITEM_BYTES,
    E2B_CONFIG_STUB_ITEM_BYTES_ENV,
    E2B_CONFIG_STUB_SOURCE_PATH,
    build_server,
    configured_item_bytes,
    fixed_payload,
)
from benchmarks.fake_deps import _fixed_payload
from benchmarks.scenario import config_skill_name


@contextmanager
def _running_server(*, item_bytes: int) -> Iterator[str]:
    server = build_server(host="127.0.0.1", port=0, item_bytes=item_bytes)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host = server.server_address[0]
    port = server.server_address[1]
    try:
        yield f"http://{host}:{port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _get(url: str) -> tuple[int, str, bytes]:
    with urlopen(url, timeout=5) as response:  # noqa: S310 - loopback test server
        return response.status, response.headers.get_content_type(), response.read()


def _post_json(url: str, payload: object) -> tuple[int, str, bytes]:
    request = Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=5) as response:  # noqa: S310 - loopback test server
        return response.status, response.headers.get_content_type(), response.read()


def test_source_path_points_to_the_standalone_script() -> None:
    assert E2B_CONFIG_STUB_SOURCE_PATH == Path(__file__).parents[3] / "benchmarks" / "e2b_config_stub.py"


def test_fixed_payload_matches_the_existing_fake_dependency_contract() -> None:
    label = "config:file-9-block-run_123.bin"

    assert fixed_payload(label, 4097) == _fixed_payload(label, 4097)


def test_item_bytes_uses_the_default_and_environment_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(E2B_CONFIG_STUB_ITEM_BYTES_ENV, raising=False)
    assert configured_item_bytes() == E2B_CONFIG_STUB_DEFAULT_ITEM_BYTES

    monkeypatch.setenv(E2B_CONFIG_STUB_ITEM_BYTES_ENV, "73")
    assert configured_item_bytes() == 73


@pytest.mark.parametrize("value", ["", "0", "-1", "not-a-number"])
def test_item_bytes_rejects_invalid_environment_values(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv(E2B_CONFIG_STUB_ITEM_BYTES_ENV, value)

    with pytest.raises(ValueError, match=E2B_CONFIG_STUB_ITEM_BYTES_ENV):
        configured_item_bytes()


def test_health_and_current_file_download_contract_are_served_from_the_local_stub() -> None:
    name = "file-7-block-run_123.bin"
    with _running_server(item_bytes=73) as base_url:
        health = _get(f"{base_url}/health")
        allocation_status, allocation_type, allocation_body = _post_json(
            f"{base_url}/agent-stub/files/download-request",
            {"config": {"kind": "file", "name": name}, "for_frontend": False},
        )
        allocation = json.loads(allocation_body)
        downloaded = _get(allocation["download_url"])

    assert health == (200, "application/json", b'{"status":"ok"}')
    assert allocation_status == 200
    assert allocation_type == "application/json"
    assert allocation == {
        "download_url": f"{base_url}/files/benchmarks/config/file/{name}",
        "filename": name,
        "mime_type": "application/octet-stream",
        "size": 73,
    }
    assert downloaded == (200, "application/octet-stream", fixed_payload(f"config:{name}", 73))


def test_current_skill_download_is_a_deterministic_zip_containing_skill_markdown() -> None:
    name = "skill-2-block-run_123"
    with _running_server(item_bytes=89) as base_url:
        first_allocation = _post_json(
            f"{base_url}/agent-stub/files/download-request",
            {"config": {"kind": "skill", "name": name}, "for_frontend": False},
        )
        first_metadata = json.loads(first_allocation[2])
        first = _get(first_metadata["download_url"])
    with _running_server(item_bytes=89) as base_url:
        second_allocation = _post_json(
            f"{base_url}/agent-stub/files/download-request",
            {"config": {"kind": "skill", "name": name}, "for_frontend": False},
        )
        second_metadata = json.loads(second_allocation[2])
        second = _get(second_metadata["download_url"])

    assert first == second
    assert first_metadata["filename"] == f"{name}.zip"
    assert first_metadata["mime_type"] == "application/zip"
    assert first_metadata["size"] == len(first[2])
    status, content_type, archive_bytes = first
    assert status == 200
    assert content_type == "application/zip"
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        assert archive.namelist() == ["SKILL.md"]
        assert archive.read("SKILL.md") == b"# Benchmark skill\n\n" + fixed_payload(f"skill:{name}", 89)


def test_long_run_skill_name_is_accepted_by_the_fixed_scenario_contract() -> None:
    run_id = "20260820082543946049-config-c20-123-" + "a" * 32
    name = config_skill_name(run_id, 0)

    with _running_server(item_bytes=16) as base_url:
        status, content_type, body = _post_json(
            f"{base_url}/agent-stub/files/download-request",
            {"config": {"kind": "skill", "name": name}, "for_frontend": False},
        )

    assert status == 200
    assert content_type == "application/json"
    assert json.loads(body)["filename"] == f"{name}.zip"


@pytest.mark.parametrize(
    ("kind", "name"),
    [
        ("skill", "skill-0-block-run_123"),
        ("file", "file-0-block-run_123.bin"),
    ],
)
def test_data_routes_require_allocation_and_enforce_one_download(kind: str, name: str) -> None:
    with _running_server(item_bytes=16) as base_url:
        data_url = f"{base_url}/files/benchmarks/config/{kind}/{name}"
        with pytest.raises(HTTPError) as missing_allocation:
            _get(data_url)
        assert missing_allocation.value.code == 409

        allocation = _post_json(
            f"{base_url}/agent-stub/files/download-request",
            {"config": {"kind": kind, "name": name}, "for_frontend": False},
        )
        assert allocation[0] == 200
        assert _get(data_url)[0] == 200
        with pytest.raises(HTTPError) as exc_info:
            _get(data_url)

    assert exc_info.value.code == 409


def test_legacy_direct_pull_routes_are_not_exposed() -> None:
    with _running_server(item_bytes=16) as base_url:
        with pytest.raises(HTTPError) as exc_info:
            _get(f"{base_url}/agent-stub/config/files/file-0-block-run.bin/pull")

    assert exc_info.value.code == 404


@pytest.mark.parametrize(
    ("kind", "name", "for_frontend"),
    [
        ("skill", "..", False),
        ("skill", "skill-0/etc", False),
        ("skill", "skill-0\x00", False),
        ("file", "..", False),
        ("file", "file-0/etc.bin", False),
        ("file", "file-0 bad.bin", False),
        ("file", f"file-0-{'a' * 256}.bin", False),
        ("file", "file-10-block-run.bin", False),
        ("skill", "skill-3-block-run", False),
        ("file", "file-0-block-run.bin", True),
        ("drive", "file-0-block-run.bin", False),
    ],
)
def test_download_request_rejects_invalid_sources(kind: str, name: str, for_frontend: bool) -> None:
    with _running_server(item_bytes=16) as base_url:
        with pytest.raises(HTTPError) as exc_info:
            _post_json(
                f"{base_url}/agent-stub/files/download-request",
                {"config": {"kind": kind, "name": name}, "for_frontend": for_frontend},
            )

    assert exc_info.value.code == 400
