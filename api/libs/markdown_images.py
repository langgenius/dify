"""Shared Markdown image parsing for persisted file references."""

from urllib.parse import unquote, urlsplit

import markdown
from bs4 import BeautifulSoup


def extract_markdown_image_sources(content: str) -> tuple[str, ...]:
    """Return image sources using the same Markdown parser as rendered content."""

    if not content:
        return ()
    rendered = markdown.markdown(content, output_format="html")
    soup = BeautifulSoup(rendered, "html.parser")
    return tuple(source for image in soup.find_all("img") if isinstance(source := image.get("src"), str) and source)


def resolve_upload_file_id_from_preview_source(source: str) -> str | None:
    """Resolve a local upload id from an absolute or relative preview source."""

    try:
        parsed = urlsplit(source)
    except ValueError:
        return None
    if parsed.scheme and parsed.scheme not in {"http", "https"}:
        return None
    path_parts = unquote(parsed.path).split("/")
    for index in range(len(path_parts) - 2):
        if path_parts[index] != "files" or path_parts[index + 2] not in {"file-preview", "image-preview"}:
            continue
        file_id = path_parts[index + 1]
        if file_id:
            return file_id
    return None


def extract_upload_file_ids_from_markdown(content: str) -> tuple[str, ...]:
    """Return upload ids referenced by Markdown images, preserving occurrence order."""

    return tuple(
        file_id
        for source in extract_markdown_image_sources(content)
        if (file_id := resolve_upload_file_id_from_preview_source(source)) is not None
    )
