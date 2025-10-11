import mimetypes
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, cast
from urllib.parse import unquote

import chardet
import cloudscraper
from readabilipy import simple_json_from_html_string

from core.helper import ssrf_proxy
from core.rag.extractor import extract_processor
from core.rag.extractor.extract_processor import ExtractProcessor

FULL_TEMPLATE = """
TITLE: {title}
AUTHOR: {author}
TEXT:

{text}
"""


def page_result(text: str, cursor: int, max_length: int) -> str:
    """Page through `text` and return a substring of `max_length` characters starting from `cursor`."""
    return text[cursor : cursor + max_length]


def get_url(url: str, user_agent: str | None = None) -> str:
    """Fetch URL and return the contents as a string."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
        " Chrome/91.0.4472.124 Safari/537.36"
    }
    if user_agent:
        headers["User-Agent"] = user_agent

    main_content_type = None
    supported_content_types = extract_processor.SUPPORT_URL_CONTENT_TYPES + ["text/html"]
    response = ssrf_proxy.head(url, headers=headers, follow_redirects=True, timeout=(5, 10))

    if response.status_code == 200:
        # check content-type
        content_type = response.headers.get("Content-Type")
        if content_type:
            main_content_type = response.headers.get("Content-Type").split(";")[0].strip()
        else:
            content_disposition = response.headers.get("Content-Disposition", "")
            filename_match = re.search(r'filename="([^"]+)"', content_disposition)
            if filename_match:
                filename = unquote(filename_match.group(1))
                extension = re.search(r"\.(\w+)$", filename)
                if extension:
                    main_content_type = mimetypes.guess_type(filename)[0]

        if main_content_type not in supported_content_types:
            return f"Unsupported content-type [{main_content_type}] of URL."

        if main_content_type in extract_processor.SUPPORT_URL_CONTENT_TYPES:
            return cast(str, ExtractProcessor.load_from_url(url, return_text=True))

        response = ssrf_proxy.get(url, headers=headers, follow_redirects=True, timeout=(120, 300))
    elif response.status_code == 403:
        scraper = cloudscraper.create_scraper()
        scraper.perform_request = ssrf_proxy.make_request
        response = scraper.get(url, headers=headers, timeout=(120, 300))

    if response.status_code != 200:
        return f"URL returned status code {response.status_code}."

    # Detect encoding using chardet
    detected_encoding = chardet.detect(response.content)
    encoding = detected_encoding["encoding"]
    if encoding:
        try:
            content = response.content.decode(encoding)
        except (UnicodeDecodeError, TypeError):
            content = response.text
    else:
        content = response.text

    article = extract_using_readabilipy(content)

    if not article.text:
        return ""

    res = FULL_TEMPLATE.format(
        title=article.title,
        author=article.author,
        text=article.text,
    )

    return res


@dataclass
class Article:
    title: str
    author: str
    text: Sequence[dict]


def extract_using_readabilipy(html: str):
    json_article: dict[str, Any] = simple_json_from_html_string(html, use_readability=True)
    article = Article(
        title=json_article.get("title") or "",
        author=json_article.get("byline") or "",
        text=json_article.get("plain_text") or [],
    )

    return article


def get_image_upload_file_ids(content):
    pattern = r"!\[image\]\((https?://.*?(file-preview|image-preview))\)"
    matches = re.findall(pattern, content)
    image_upload_file_ids = []
    for match in matches:
        if match[1] == "file-preview":
            content_pattern = r"files/([^/]+)/file-preview"
        else:
            content_pattern = r"files/([^/]+)/image-preview"
        content_match = re.search(content_pattern, match[0])
        if content_match:
            image_upload_file_id = content_match.group(1)
            image_upload_file_ids.append(image_upload_file_id)
    return image_upload_file_ids
