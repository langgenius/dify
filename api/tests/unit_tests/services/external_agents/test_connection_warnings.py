"""Verified Card changes are advisory and keep technical/business axes separate."""

import copy
from datetime import UTC, datetime

import pytest

from services.external_agents.asset_service import connection_change_warnings
from services.external_agents.contracts import ConnectionRevision
from services.external_agents.protocol import TRACEABILITY_URI


def baseline() -> dict[str, object]:
    return {
        "name": "Remote",
        "description": "Service",
        "defaultInputModes": ["text/plain", "application/pdf"],
        "defaultOutputModes": ["text/plain", "application/pdf"],
        "capabilities": {"streaming": True, "extensions": [{"uri": TRACEABILITY_URI}]},
        "skills": [{"id": "skill", "name": "Work", "inputModes": ["application/pdf"]}],
    }


def previous(card: dict[str, object]) -> ConnectionRevision:
    return ConnectionRevision(
        id="revision",
        tenant_id="tenant",
        agent_id="agent",
        endpoint="https://agent.test",
        interface_url="https://agent.test/a2a",
        auth_type="none",
        credential_ciphertext=None,
        card=card,
        capabilities={"streaming": True},
        auth_check="not_exercised",
        verified_at=datetime.now(UTC),
    )


def test_first_unchanged_and_expanded_cards_have_no_technical_warning() -> None:
    card = baseline()
    assert connection_change_warnings(None, card) == {"technical": [], "business": []}
    assert connection_change_warnings(previous(card), copy.deepcopy(card)) == {"technical": [], "business": []}
    expanded = {
        **card,
        "defaultInputModes": ["text/plain", "application/pdf", "image/png"],
        "defaultOutputModes": ["application/pdf", "text/plain"],
    }
    assert connection_change_warnings(previous(card), expanded) == {"technical": [], "business": []}


def test_skill_change_is_business_only_and_never_widens_default_input_modes() -> None:
    card = baseline()
    changed = {**card, "skills": [{"id": "skill", "name": "Work", "inputModes": ["application/pdf", "image/png"]}]}
    assert connection_change_warnings(previous(card), changed) == {"technical": [], "business": ["skills_changed"]}
    assert changed["defaultInputModes"] == ["text/plain", "application/pdf"]


def test_combined_change_returns_both_warning_groups_without_mutating_either_card() -> None:
    card = baseline()
    changed: dict[str, object] = {
        "name": "Changed",
        "description": "Changed service",
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
        "capabilities": {"streaming": False, "extensions": []},
        "skills": [{"id": "new"}],
        "securityRequirements": [{"schemes": {}}],
    }
    before = copy.deepcopy(changed)
    warnings = connection_change_warnings(previous(card), changed)
    assert warnings == {
        "technical": [
            "input_modes_narrowed",
            "output_modes_narrowed",
            "streaming_removed",
            "auth_requirements_changed",
            "traceability_removed",
        ],
        "business": ["agent_info_changed", "skills_changed"],
    }
    assert changed == before
    assert card == baseline()


@pytest.mark.parametrize(
    ("old_modes", "new_modes", "narrowed"),
    [
        (["application/pdf"], ["*/*"], False),
        (["application/pdf"], ["application/*"], False),
        (["image/jpg"], ["image/jpeg"], False),
        (["IMAGE/JPEG; quality=80"], ["image/jpg"], False),
        (["text/plain; charset=UTF-8", "application/x-pdf"], ["text/plain", "application/pdf"], False),
        (["image/*"], ["*/*"], False),
        (["image/*"], ["image/png", "image/jpeg"], True),
        (["*/*"], ["image/*"], True),
        (["application/pdf"], ["text/plain"], True),
    ],
)
def test_mode_warnings_compare_coverage_not_mime_spelling(
    old_modes: list[str], new_modes: list[str], narrowed: bool
) -> None:
    """Expansion/normalization stays quiet, but replacing wildcard coverage warns."""
    card = {**baseline(), "defaultInputModes": old_modes, "defaultOutputModes": old_modes}
    proposed = {**card, "defaultInputModes": new_modes, "defaultOutputModes": new_modes}
    warnings = connection_change_warnings(previous(card), proposed)
    assert warnings["technical"] == (["input_modes_narrowed", "output_modes_narrowed"] if narrowed else [])
    assert warnings["business"] == []
    assert card["defaultInputModes"] == old_modes
    assert proposed["defaultInputModes"] == new_modes
