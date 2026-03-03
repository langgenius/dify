from services.dataset_service import DocumentService


def test_normalize_display_status_alias_mapping():
    assert DocumentService.normalize_display_status("ACTIVE") == "available"
    assert DocumentService.normalize_display_status("enabled") == "available"
    assert DocumentService.normalize_display_status("archived") == "archived"
    assert DocumentService.normalize_display_status("unknown") is None
