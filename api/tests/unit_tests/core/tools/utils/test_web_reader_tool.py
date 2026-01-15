from types import SimpleNamespace

import pytest

from core.tools.utils.web_reader_tool import (
    extract_using_readabilipy,
    get_image_upload_file_ids,
    get_url,
    page_result,
)


class FakeResponse:
    """Minimal fake response object for ssrf_proxy / cloudscraper."""

    def __init__(self, *, status_code=200, headers=None, content=b"", text=""):
        self.status_code = status_code
        self.headers = headers or {}
        self.content = content
        self.text = text or content.decode("utf-8", errors="ignore")


# ---------------------------
# Tests: page_result
# ---------------------------
@pytest.mark.parametrize(
    ("text", "cursor", "maxlen", "expected"),
    [
        ("abcdef", 0, 3, "abc"),
        ("abcdef", 2, 10, "cdef"),  # maxlen beyond end
        ("abcdef", 6, 5, ""),  # cursor at end
        ("abcdef", 7, 5, ""),  # cursor beyond end
        ("", 0, 5, ""),  # empty text
    ],
)
def test_page_result(text, cursor, maxlen, expected):
    assert page_result(text, cursor, maxlen) == expected


# ---------------------------
# Tests: get_url
# ---------------------------
@pytest.fixture
def stub_support_types(monkeypatch: pytest.MonkeyPatch):
    """Stub supported content types list."""
    import core.tools.utils.web_reader_tool as mod

    # e.g. binary types supported by ExtractProcessor
    monkeypatch.setattr(mod.extract_processor, "SUPPORT_URL_CONTENT_TYPES", ["application/pdf", "text/plain"])
    return mod


def test_get_url_unsupported_content_type(monkeypatch: pytest.MonkeyPatch, stub_support_types):
    # HEAD 200 but content-type not supported and not text/html
    def fake_head(url, headers=None, follow_redirects=True, timeout=None):
        return FakeResponse(
            status_code=200,
            headers={"Content-Type": "image/png"},  # not supported
        )

    monkeypatch.setattr(stub_support_types.ssrf_proxy, "head", fake_head)

    result = get_url("https://x.test/file.png")
    assert result == "Unsupported content-type [image/png] of URL."


def test_get_url_supported_binary_type_uses_extract_processor(monkeypatch: pytest.MonkeyPatch, stub_support_types):
    """
    When content-type is in SUPPORT_URL_CONTENT_TYPES,
    should call ExtractProcessor.load_from_url and return its text.
    """
    calls = {"load": 0}

    def fake_head(url, headers=None, follow_redirects=True, timeout=None):
        return FakeResponse(
            status_code=200,
            headers={"Content-Type": "application/pdf"},
        )

    def fake_load_from_url(url, return_text=False):
        calls["load"] += 1
        assert return_text is True
        return "PDF extracted text"

    monkeypatch.setattr(stub_support_types.ssrf_proxy, "head", fake_head)
    monkeypatch.setattr(stub_support_types.ExtractProcessor, "load_from_url", staticmethod(fake_load_from_url))

    result = get_url("https://x.test/doc.pdf")
    assert calls["load"] == 1
    assert result == "PDF extracted text"


def test_get_url_html_flow_with_chardet_and_readability(monkeypatch: pytest.MonkeyPatch, stub_support_types):
    """200 + text/html → GET, chardet detects encoding, readability returns article which is templated."""

    def fake_head(url, headers=None, follow_redirects=True, timeout=None):
        return FakeResponse(status_code=200, headers={"Content-Type": "text/html"})

    def fake_get(url, headers=None, follow_redirects=True, timeout=None):
        html = b"<html><head><title>x</title></head><body>hello</body></html>"
        return FakeResponse(status_code=200, headers={"Content-Type": "text/html"}, content=html)

    # chardet.detect returns utf-8
    import core.tools.utils.web_reader_tool as mod

    monkeypatch.setattr(mod.ssrf_proxy, "head", fake_head)
    monkeypatch.setattr(mod.ssrf_proxy, "get", fake_get)

    mock_best = SimpleNamespace(encoding="utf-8")
    mock_from_bytes = SimpleNamespace(best=lambda: mock_best)
    monkeypatch.setattr(mod.charset_normalizer, "from_bytes", lambda _: mock_from_bytes)

    # readability → a dict that maps to Article, then FULL_TEMPLATE
    def fake_simple_json_from_html_string(html, use_readability=True):
        return {
            "title": "My Title",
            "byline": "Bob",
            "plain_text": [{"type": "text", "text": "Hello world"}],
        }

    monkeypatch.setattr(mod, "simple_json_from_html_string", fake_simple_json_from_html_string)

    out = get_url("https://x.test/page")
    assert "TITLE: My Title" in out
    assert "AUTHOR: Bob" in out
    assert "Hello world" in out


def test_get_url_html_flow_empty_article_text_returns_empty(monkeypatch: pytest.MonkeyPatch, stub_support_types):
    """If readability returns no text, should return empty string."""

    def fake_head(url, headers=None, follow_redirects=True, timeout=None):
        return FakeResponse(status_code=200, headers={"Content-Type": "text/html"})

    def fake_get(url, headers=None, follow_redirects=True, timeout=None):
        return FakeResponse(status_code=200, headers={"Content-Type": "text/html"}, content=b"<html/>")

    import core.tools.utils.web_reader_tool as mod

    monkeypatch.setattr(mod.ssrf_proxy, "head", fake_head)
    monkeypatch.setattr(mod.ssrf_proxy, "get", fake_get)
    mock_best = SimpleNamespace(encoding="utf-8")
    mock_from_bytes = SimpleNamespace(best=lambda: mock_best)
    monkeypatch.setattr(mod.charset_normalizer, "from_bytes", lambda _: mock_from_bytes)
    # readability returns empty plain_text
    monkeypatch.setattr(mod, "simple_json_from_html_string", lambda html, use_readability=True: {"plain_text": []})

    out = get_url("https://x.test/empty")
    assert out == ""


def test_get_url_403_cloudscraper_fallback(monkeypatch: pytest.MonkeyPatch, stub_support_types):
    """HEAD 403 → use cloudscraper.get via ssrf_proxy.make_request, then proceed."""

    def fake_head(url, headers=None, follow_redirects=True, timeout=None):
        return FakeResponse(status_code=403, headers={})

    # cloudscraper.create_scraper() → object with .get()
    class FakeScraper:
        def __init__(self):
            pass  # removed unused attribute

        def get(self, url, headers=None, follow_redirects=True, timeout=None):
            # mimic html 200
            html = b"<html><body>hi</body></html>"
            return FakeResponse(status_code=200, headers={"Content-Type": "text/html"}, content=html)

    import core.tools.utils.web_reader_tool as mod

    monkeypatch.setattr(mod.ssrf_proxy, "head", fake_head)
    monkeypatch.setattr(mod.cloudscraper, "create_scraper", lambda: FakeScraper())
    mock_best = SimpleNamespace(encoding="utf-8")
    mock_from_bytes = SimpleNamespace(best=lambda: mock_best)
    monkeypatch.setattr(mod.charset_normalizer, "from_bytes", lambda _: mock_from_bytes)
    monkeypatch.setattr(
        mod,
        "simple_json_from_html_string",
        lambda html, use_readability=True: {"title": "T", "byline": "A", "plain_text": [{"type": "text", "text": "X"}]},
    )

    out = get_url("https://x.test/403")
    assert "TITLE: T" in out
    assert "AUTHOR: A" in out
    assert "X" in out


def test_get_url_head_non_200_returns_status(monkeypatch: pytest.MonkeyPatch, stub_support_types):
    """HEAD returns non-200 and non-403 → should directly return code message."""

    def fake_head(url, headers=None, follow_redirects=True, timeout=None):
        return FakeResponse(status_code=500)

    import core.tools.utils.web_reader_tool as mod

    monkeypatch.setattr(mod.ssrf_proxy, "head", fake_head)

    out = get_url("https://x.test/fail")
    assert out == "URL returned status code 500."


def test_get_url_content_disposition_filename_detection(monkeypatch: pytest.MonkeyPatch, stub_support_types):
    """
    If HEAD 200 with no Content-Type but Content-Disposition filename suggests a supported type,
    it should route to ExtractProcessor.load_from_url.
    """
    calls = {"load": 0}

    def fake_head(url, headers=None, follow_redirects=True, timeout=None):
        return FakeResponse(status_code=200, headers={"Content-Disposition": 'attachment; filename="doc.pdf"'})

    def fake_load_from_url(url, return_text=False):
        calls["load"] += 1
        return "From ExtractProcessor via filename"

    import core.tools.utils.web_reader_tool as mod

    monkeypatch.setattr(mod.ssrf_proxy, "head", fake_head)
    monkeypatch.setattr(mod.ExtractProcessor, "load_from_url", staticmethod(fake_load_from_url))

    out = get_url("https://x.test/fname")
    assert calls["load"] == 1
    assert out == "From ExtractProcessor via filename"


def test_get_url_html_encoding_fallback_when_decode_fails(monkeypatch: pytest.MonkeyPatch, stub_support_types):
    """
    If chardet returns an encoding but content.decode raises, should fallback to response.text.
    """

    def fake_head(url, headers=None, follow_redirects=True, timeout=None):
        return FakeResponse(status_code=200, headers={"Content-Type": "text/html"})

    # Return bytes that will raise with the chosen encoding
    def fake_get(url, headers=None, follow_redirects=True, timeout=None):
        return FakeResponse(
            status_code=200,
            headers={"Content-Type": "text/html"},
            content=b"\xff\xfe\xfa",  # likely to fail under utf-8
            text="<html>fallback text</html>",
        )

    import core.tools.utils.web_reader_tool as mod

    monkeypatch.setattr(mod.ssrf_proxy, "head", fake_head)
    monkeypatch.setattr(mod.ssrf_proxy, "get", fake_get)

    mock_best = SimpleNamespace(encoding="utf-8")
    mock_from_bytes = SimpleNamespace(best=lambda: mock_best)
    monkeypatch.setattr(mod.charset_normalizer, "from_bytes", lambda _: mock_from_bytes)
    monkeypatch.setattr(
        mod,
        "simple_json_from_html_string",
        lambda html, use_readability=True: {"title": "", "byline": "", "plain_text": [{"type": "text", "text": "ok"}]},
    )

    out = get_url("https://x.test/enc-fallback")
    assert "ok" in out


# ---------------------------
# Tests: extract_using_readabilipy
# ---------------------------


def test_extract_using_readabilipy_field_mapping_and_defaults(monkeypatch: pytest.MonkeyPatch):
    # stub readabilipy.simple_json_from_html_string
    def fake_simple_json_from_html_string(html, use_readability=True):
        return {
            "title": "Hello",
            "byline": "Alice",
            "plain_text": [{"type": "text", "text": "world"}],
        }

    import core.tools.utils.web_reader_tool as mod

    monkeypatch.setattr(mod, "simple_json_from_html_string", fake_simple_json_from_html_string)

    article = extract_using_readabilipy("<html>...</html>")
    assert article.title == "Hello"
    assert article.author == "Alice"
    assert isinstance(article.text, list)
    assert article.text
    assert article.text[0]["text"] == "world"


def test_extract_using_readabilipy_defaults_when_missing(monkeypatch: pytest.MonkeyPatch):
    def fake_simple_json_from_html_string(html, use_readability=True):
        return {}  # all missing

    import core.tools.utils.web_reader_tool as mod

    monkeypatch.setattr(mod, "simple_json_from_html_string", fake_simple_json_from_html_string)

    article = extract_using_readabilipy("<html>...</html>")
    assert article.title == ""
    assert article.author == ""
    assert article.text == []


# ---------------------------
# Tests: get_image_upload_file_ids
# ---------------------------
def test_get_image_upload_file_ids():
    # should extract id from https + file-preview
    content = "![image](https://example.com/a/b/files/abc123/file-preview)"
    assert get_image_upload_file_ids(content) == ["abc123"]

    # should extract id from http + image-preview
    content = "![image](http://host/files/xyz789/image-preview)"
    assert get_image_upload_file_ids(content) == ["xyz789"]

    # should not match invalid scheme 'htt://'
    content = "![image](htt://host/files/bad/file-preview)"
    assert get_image_upload_file_ids(content) == []

    # should extract multiple ids in order
    content = """
    some text
    ![image](https://h/files/id1/file-preview)
    middle
    ![image](http://h/files/id2/image-preview)
    end
    """
    assert get_image_upload_file_ids(content) == ["id1", "id2"]
