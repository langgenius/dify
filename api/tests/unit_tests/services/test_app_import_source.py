import io
from collections.abc import Callable
from unittest.mock import Mock

import httpx
import pytest

from core.tools.errors import ToolSSRFError
from services import app_import_source as module
from services.agent.errors import InvalidRosterAgentPackageError, RosterAgentPackageTooLargeError


@pytest.mark.parametrize(
    ("url", "download_url"),
    [
        (" https://example.com/agent.IFPKG?token=secret ", "https://example.com/agent.IFPKG?token=secret"),
        (
            "https://github.com/org/repo/blob/main/agent.ifpkg",
            "https://raw.githubusercontent.com/org/repo/main/agent.ifpkg",
        ),
    ],
)
def test_download_preserves_binary_and_closes_resources(
    monkeypatch: pytest.MonkeyPatch, url: str, download_url: str
) -> None:
    content = b"PK\x00\xff"
    response = httpx.Response(200, stream=httpx.ByteStream(content), request=httpx.Request("GET", download_url))
    fetch = Mock(return_value=response)
    monkeypatch.setattr(module.remote_fetcher, "make_request", fetch)
    with module.download_app_import_source(url) as source:
        assert response.is_closed
        assert source.read() == content
    assert source.closed
    fetch.assert_called_once_with(
        "GET",
        download_url,
        stream_response=True,
        follow_redirects=True,
        timeout=(10, 10),
        headers={"Accept-Encoding": "identity"},
    )


@pytest.mark.parametrize("failure", ["oversize", "encoding", "http", "network", "ssrf"])
def test_download_failure_never_imports(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], failure: str
) -> None:
    config_overrides(AGENT_PACKAGE_MAX_BYTES=3)
    monkeypatch.setattr(module, "DSL_MAX_SIZE", 3)
    response = httpx.Response(
        404 if failure == "http" else 200,
        headers={"content-encoding": "gzip"} if failure == "encoding" else {},
        stream=httpx.ByteStream(b"1234"),
        request=httpx.Request("GET", "https://example.com/agent.ifpkg"),
    )
    fetch = Mock(return_value=response)
    if failure == "network":
        fetch.side_effect = httpx.ReadTimeout("timeout")
    elif failure == "ssrf":
        fetch.side_effect = ToolSSRFError("blocked")
    monkeypatch.setattr(module.remote_fetcher, "make_request", fetch)
    error = RosterAgentPackageTooLargeError if failure == "oversize" else InvalidRosterAgentPackageError
    with pytest.raises(error), module.download_app_import_source("https://example.com/download"):
        pytest.fail("Failed downloads must not expose an import source")
    if failure not in {"network", "ssrf"}:
        assert response.is_closed


@pytest.mark.parametrize(
    "url", ["file:///tmp/agent.ifpkg", "ftp://example.com/agent.ifpkg", "/agent.ifpkg", "https://[bad/agent.ifpkg"]
)
def test_invalid_url_never_downloads(monkeypatch: pytest.MonkeyPatch, url: str) -> None:
    fetch = Mock()
    monkeypatch.setattr(module.remote_fetcher, "make_request", fetch)
    with pytest.raises(InvalidRosterAgentPackageError), module.download_app_import_source(url):
        pytest.fail("Invalid URLs must not expose an import source")
    fetch.assert_not_called()


@pytest.mark.parametrize(
    ("content", "is_yaml"),
    [(b"app: {}", True), (b"PK\x00\xff", False), (b"[broken", False), (b"hello", False), (b"", False)],
)
def test_yaml_detection_rewinds_for_package_fallback(content: bytes, is_yaml: bool) -> None:
    source = io.BytesIO(content)
    result = module.try_read_yaml(source)
    assert (result is not None) is is_yaml
    assert source.read() == content


def test_yaml_detection_does_not_parse_oversized_content(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(module, "DSL_MAX_SIZE", 3)
    source = io.BytesIO(b"app: {}")
    assert module.try_read_yaml(source) is None
    assert source.tell() == 0
