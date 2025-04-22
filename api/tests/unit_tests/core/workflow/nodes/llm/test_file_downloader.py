from unittest import mock

import httpx
import pytest

from core.workflow.nodes.llm.file_downloader import (
    FileDownloadError,
    HTTPStatusError,
    Response,
    SSRFProxyFileDownloader,
    ssrf_proxy,
)

_TEST_URL = "https://example.com"


class TestSSRFProxyFileDownloader:
    def test(self, monkeypatch):
        mock_request = httpx.Request("GET", _TEST_URL)
        mock_response = httpx.Response(
            status_code=200,
            content=b"test-data",
            headers={"Content-Type": "text/plain"},
            request=mock_request,
        )
        mock_get = mock.MagicMock(spec=ssrf_proxy.get, return_value=mock_response)
        monkeypatch.setattr(ssrf_proxy, "get", mock_get)

        downloader = SSRFProxyFileDownloader()
        response = downloader.get(_TEST_URL)
        mock_get.assert_called_once_with(_TEST_URL)
        assert response == Response(body=mock_response.content, content_type="text/plain")

    def test_should_raise_when_status_is_not_successful(self, monkeypatch):
        mock_request = httpx.Request("GET", _TEST_URL)
        mock_response = httpx.Response(
            status_code=401,
            request=mock_request,
        )
        mock_get = mock.MagicMock(spec=ssrf_proxy.get, return_value=mock_response)
        monkeypatch.setattr(ssrf_proxy, "get", mock_get)

        downloader = SSRFProxyFileDownloader()
        with pytest.raises(HTTPStatusError) as exc:
            response = downloader.get(_TEST_URL)
        mock_get.assert_called_once_with(_TEST_URL)
        assert exc.value.status_code == 401

    def test_should_convert_timeout_to_file_download_error(self, monkeypatch):
        mock_get = mock.MagicMock(spec=ssrf_proxy.get, side_effect=httpx.TimeoutException("timeout"))
        monkeypatch.setattr(ssrf_proxy, "get", mock_get)

        downloader = SSRFProxyFileDownloader()
        with pytest.raises(FileDownloadError) as exc:
            response = downloader.get(_TEST_URL)
        mock_get.assert_called_once_with(_TEST_URL)
