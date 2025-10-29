from collections.abc import Mapping
from typing import Any

from core.file import helpers as file_helpers
from models.dataset import Document as DatasetDocument


def document_url_for_dataset_document(document: DatasetDocument) -> str | None:
    """
    Compute a user-accessible URL for the original document referenced by a dataset Document.
    - upload_file: returns a signed preview URL
    - website_crawl: returns the crawled page URL if available
    - notion_import: returns the Notion page link or constructs one from page id
    - fallback: tries common metadata url-like fields
    """
    try:
        ds_type = document.data_source_type
        if ds_type == "upload_file":
            info = document.data_source_info_dict or {}
            upload_file_id = info.get("upload_file_id")
            if upload_file_id:
                return file_helpers.get_signed_file_url(upload_file_id)
            return None
        if ds_type == "website_crawl":
            info = document.data_source_info_dict or {}
            return info.get("url") or (document.doc_metadata or {}).get("source_url")
        if ds_type == "notion_import":
            meta = document.doc_metadata or {}
            url = meta.get("notion_page_link")
            if url:
                return url
            info = document.data_source_info_dict or {}
            page_id = info.get("notion_page_id")
            if page_id:
                return f"https://www.notion.so/{str(page_id).replace('-', '')}"
            return None

        # other types: best-effort
        meta = document.doc_metadata or {}
        info = document.data_source_info_dict or {}
        return meta.get("source_url") or meta.get("github_link") or info.get("url")
    except Exception:
        return None


def document_url_for_external_metadata(metadata: Mapping[str, Any] | None) -> str | None:
    if not metadata:
        return None
    return metadata.get("url") or metadata.get("source_url")  # type: ignore[index]
