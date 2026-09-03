import pytest
from pydantic import ValidationError

from services.knowledge_fs.product_dto import (
    KnowledgeFSInitialWebsiteSourcePayload,
    knowledge_fs_initial_preview_configuration_fingerprint,
)


def _payload(*, limit: int = 2, urls: list[str] | None = None) -> dict[str, object]:
    selected = urls or ["HTTPS://Docs.Dify.AI:443/a/#section", "https://docs.dify.ai/b/"]
    return {
        "kind": "website_crawl",
        "name": "Dify docs",
        "provider": "firecrawl",
        "root_url": "https://docs.dify.ai",
        "crawl_options": {"include_subpages": True, "limit": limit},
        "selection": [{"source_url": url} for url in selected],
    }


def test_initial_website_selection_populates_stable_canonical_urls() -> None:
    payload = KnowledgeFSInitialWebsiteSourcePayload.model_validate(_payload())

    assert [item.canonical_url for item in payload.selection] == [
        "https://docs.dify.ai/a",
        "https://docs.dify.ai/b",
    ]


def test_initial_website_selection_preserves_canonical_duplicates() -> None:
    payload = KnowledgeFSInitialWebsiteSourcePayload.model_validate(
        _payload(urls=["https://docs.dify.ai/a/", "https://DOCS.dify.ai:443/a#section"])
    )

    assert [item.canonical_url for item in payload.selection] == [
        "https://docs.dify.ai/a",
        "https://docs.dify.ai/a",
    ]


def test_initial_website_selection_requires_crawl_limit_to_cover_selection() -> None:
    with pytest.raises(ValidationError, match="crawl limit must cover every selected URL"):
        KnowledgeFSInitialWebsiteSourcePayload.model_validate(_payload(limit=1))


def test_initial_website_source_rejects_stale_preview_configuration() -> None:
    payload = _payload()
    payload["previewConfigurationFingerprint"] = "0" * 64

    with pytest.raises(ValidationError, match="preview configuration no longer matches"):
        KnowledgeFSInitialWebsiteSourcePayload.model_validate(payload)


def test_initial_website_source_accepts_matching_preview_configuration() -> None:
    payload = KnowledgeFSInitialWebsiteSourcePayload.model_validate(_payload())
    raw = _payload()
    raw["previewConfigurationFingerprint"] = knowledge_fs_initial_preview_configuration_fingerprint(payload)

    validated = KnowledgeFSInitialWebsiteSourcePayload.model_validate(raw)

    assert validated.preview_configuration_fingerprint == knowledge_fs_initial_preview_configuration_fingerprint(
        validated
    )
