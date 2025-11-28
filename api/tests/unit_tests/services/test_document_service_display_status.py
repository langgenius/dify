import sqlalchemy as sa

from models.dataset import Document
from services.dataset_service import DocumentService


def test_normalize_display_status_alias_mapping():
    assert DocumentService.normalize_display_status("ACTIVE") == "available"
    assert DocumentService.normalize_display_status("enabled") == "available"
    assert DocumentService.normalize_display_status("archived") == "archived"
    assert DocumentService.normalize_display_status("unknown") is None


def test_build_display_status_filters_available():
    filters = DocumentService.build_display_status_filters("available")
    assert len(filters) == 3
    for condition in filters:
        assert condition is not None


def test_apply_display_status_filter_applies_when_status_present():
    query = sa.select(Document)
    filtered = DocumentService.apply_display_status_filter(query, "queuing")
    compiled = str(filtered.compile(compile_kwargs={"literal_binds": True}))
    assert "WHERE" in compiled
    assert "documents.indexing_status = 'waiting'" in compiled


def test_apply_display_status_filter_returns_same_when_invalid():
    query = sa.select(Document)
    filtered = DocumentService.apply_display_status_filter(query, "invalid")
    compiled = str(filtered.compile(compile_kwargs={"literal_binds": True}))
    assert "WHERE" not in compiled
