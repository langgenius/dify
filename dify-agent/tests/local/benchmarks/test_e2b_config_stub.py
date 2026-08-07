from __future__ import annotations

from contextlib import contextmanager
import io
from pathlib import Path
import threading
from typing import Iterator
from urllib.error import HTTPError
from urllib.request import urlopen
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


def test_health_and_file_pull_are_served_from_the_local_stub() -> None:
    name = "file-7-block-run_123.bin"
    with _running_server(item_bytes=73) as base_url:
        health = _get(f"{base_url}/health")
        first = _get(f"{base_url}/agent-stub/config/files/{name}/pull")

    assert health == (200, "application/json", b'{"status":"ok"}')
    assert first == (200, "application/octet-stream", fixed_payload(f"config:{name}", 73))


def test_skill_pull_is_a_deterministic_zip_containing_skill_markdown() -> None:
    name = "skill-2-block-run_123"
    with _running_server(item_bytes=89) as base_url:
        first = _get(f"{base_url}/agent-stub/config/skills/{name}/pull")
    with _running_server(item_bytes=89) as base_url:
        second = _get(f"{base_url}/agent-stub/config/skills/{name}/pull")

    assert first == second
    status, content_type, archive_bytes = first
    assert status == 200
    assert content_type == "application/zip"
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        assert archive.namelist() == ["SKILL.md"]
        assert archive.read("SKILL.md") == b"# Benchmark skill\n\n" + fixed_payload(f"skill:{name}", 89)


@pytest.mark.parametrize(
    ("path", "expected_status"),
    [
        ("/agent-stub/config/skills/skill-0-block-run_123/pull", 409),
        ("/agent-stub/config/files/file-0-block-run_123.bin/pull", 409),
        ("/agent-stub/config/skills/skill-3-block-run_123/pull", 400),
        ("/agent-stub/config/files/file-10-block-run_123.bin/pull", 400),
    ],
)
def test_pull_routes_enforce_one_request_per_fixed_scenario_item(path: str, expected_status: int) -> None:
    with _running_server(item_bytes=16) as base_url:
        if expected_status == 409:
            assert _get(f"{base_url}{path}")[0] == 200
        with pytest.raises(HTTPError) as exc_info:
            _get(f"{base_url}{path}")

    assert exc_info.value.code == expected_status


@pytest.mark.parametrize(
    "path",
    [
        "/agent-stub/config/skills/%2e%2e/pull",
        "/agent-stub/config/skills/skill-0%2Fetc/pull",
        "/agent-stub/config/skills/skill-0%00/pull",
        "/agent-stub/config/files/%2e%2e/pull",
        "/agent-stub/config/files/file-0%2Fetc.bin/pull",
        "/agent-stub/config/files/file-0%20bad.bin/pull",
        f"/agent-stub/config/files/file-0-{'a' * 256}.bin/pull",
        f"/agent-stub/config/files/{'file-0-' * 128}/pull",
    ],
)
def test_pull_routes_reject_invalid_or_traversal_names(path: str) -> None:
    with _running_server(item_bytes=16) as base_url:
        with pytest.raises(HTTPError) as exc_info:
            _get(f"{base_url}{path}")

    assert exc_info.value.code == 400
