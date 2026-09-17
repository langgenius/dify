from unittest.mock import Mock

import httpx
import pytest

from core.tools.errors import ToolSSRFError
from services.agent import roster_package_importer as module
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
def test_download_preserves_binary_and_closes_resources(monkeypatch, url, download_url):
    content = b"PK\x00\xff"
    response = httpx.Response(200, stream=httpx.ByteStream(content), request=httpx.Request("GET", download_url))
    fetch = Mock(return_value=response)
    monkeypatch.setattr(module.remote_fetcher, "make_request", fetch)
    importer = module.RosterAgentPackageImporter()
    captured = []
    expected_account = Mock()

    def import_package(*, source, tenant_id, account):
        assert response.is_closed
        assert source.read() == content
        assert tenant_id == "tenant-1"
        assert account is expected_account
        captured.append(source)
        return "result"

    monkeypatch.setattr(importer, "import_package", import_package)
    assert importer.import_from_url(url=url, tenant_id="tenant-1", account=expected_account) == "result"
    assert captured[0].closed
    fetch.assert_called_once_with(
        "GET",
        download_url,
        stream_response=True,
        follow_redirects=True,
        timeout=(10, 10),
        headers={"Accept-Encoding": "identity"},
    )


@pytest.mark.parametrize("failure", ["oversize", "encoding", "http", "network", "ssrf"])
def test_download_failure_never_imports(monkeypatch, config_overrides, failure):
    config_overrides(AGENT_PACKAGE_MAX_BYTES=3)
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
    importer = module.RosterAgentPackageImporter()
    import_package = Mock()
    monkeypatch.setattr(importer, "import_package", import_package)
    error = RosterAgentPackageTooLargeError if failure == "oversize" else InvalidRosterAgentPackageError
    with pytest.raises(error):
        importer.import_from_url(url="https://example.com/agent.ifpkg", tenant_id="tenant-1", account=Mock())
    import_package.assert_not_called()
    if failure not in {"network", "ssrf"}:
        assert response.is_closed


@pytest.mark.parametrize(
    "url", ["file:///tmp/agent.ifpkg", "ftp://example.com/agent.ifpkg", "/agent.ifpkg", "https://[bad/agent.ifpkg"]
)
def test_invalid_url_never_downloads(monkeypatch, url):
    fetch = Mock()
    monkeypatch.setattr(module.remote_fetcher, "make_request", fetch)
    with pytest.raises(InvalidRosterAgentPackageError):
        module.RosterAgentPackageImporter().import_from_url(url=url, tenant_id="tenant-1", account=Mock())
    fetch.assert_not_called()
