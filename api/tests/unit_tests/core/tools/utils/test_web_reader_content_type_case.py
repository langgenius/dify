"""Regression tests for case-insensitive HTTP Content-Type handling in get_url."""

import httpx
import pytest

import core.tools.utils.web_reader_tool as web_reader


def _response(content_type: str) -> httpx.Response:
    return httpx.Response(
        200,
        headers={"Content-Type": content_type},
        request=httpx.Request("GET", "https://example.test/page"),
    )


@pytest.mark.parametrize(
    "content_type",
    [
        "APPLICATION/PDF",
        "Text/Plain; charset=utf-8",
        "APPLICATION/JSON",
    ],
)
def test_get_url_accepts_mixed_case_supported_content_type(monkeypatch: pytest.MonkeyPatch, content_type: str) -> None:
    calls: list[str] = []

    def fake_make_request(_method: str, _url: str, **_kwargs: object) -> httpx.Response:
        return _response(content_type)

    def fake_load_from_url(url: str, **_kwargs: object) -> str:
        calls.append(url)
        return "extracted content"

    monkeypatch.setattr(web_reader.remote_fetcher, "make_request", fake_make_request)
    monkeypatch.setattr(web_reader.ExtractProcessor, "load_from_url", staticmethod(fake_load_from_url))

    result = web_reader.get_url("https://example.test/doc")

    assert result == "extracted content"
    assert calls == ["https://example.test/doc"]


def test_get_url_lowercase_and_unsupported_content_type_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_make_request(_method: str, _url: str, **_kwargs: object) -> httpx.Response:
        return _response("application/pdf")

    def fake_load_from_url(_url: str, **_kwargs: object) -> str:
        return "extracted content"

    monkeypatch.setattr(web_reader.remote_fetcher, "make_request", fake_make_request)
    monkeypatch.setattr(web_reader.ExtractProcessor, "load_from_url", staticmethod(fake_load_from_url))
    assert web_reader.get_url("https://example.test/doc") == "extracted content"

    def fake_make_request_unsupported(_method: str, _url: str, **_kwargs: object) -> httpx.Response:
        return _response("image/png")

    monkeypatch.setattr(web_reader.remote_fetcher, "make_request", fake_make_request_unsupported)
    assert web_reader.get_url("https://example.test/img") == "Unsupported content-type [image/png] of URL."
