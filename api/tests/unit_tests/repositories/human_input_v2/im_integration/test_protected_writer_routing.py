"""Boundary tests for Organization-guarded IM writes."""

from __future__ import annotations

from pathlib import Path


def test_account_and_membership_writes_are_outside_the_im_write_lock_boundary() -> None:
    api_root = Path(__file__).resolve().parents[5]
    account_service_source = (api_root / "services/account_service.py").read_text(encoding="utf-8")

    assert "services.human_input_v2.im_contact_sync" not in account_service_source
    assert "repositories.human_input_v2.organization_write_unit_of_work" not in account_service_source
    assert not (api_root / "services/human_input_v2/im_contact_sync/protected_writes.py").exists()
