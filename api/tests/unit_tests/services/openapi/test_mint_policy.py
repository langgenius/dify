"""Tests for the mint-policy validator.

Cross-checks the (subject_type, prefix, scopes) triple a caller intends
to mint against ``MINTABLE_PROFILES``. The validator's defense-in-depth
value kicks in when a caller wires scopes or prefix from a non-canonical
source — the well-formed canonical path is the no-violation case.
"""

from __future__ import annotations

import pytest

from libs.oauth_bearer import MINTABLE_PROFILES, Scope, SubjectType
from services.openapi.mint_policy import MintPolicyViolation, validate_mint_policy


def test_canonical_account_profile_passes():
    profile = MINTABLE_PROFILES[SubjectType.ACCOUNT]
    validate_mint_policy(
        subject_type=profile.subject_type,
        prefix=profile.prefix,
        scopes=profile.scopes,
    )


def test_canonical_external_sso_profile_passes():
    profile = MINTABLE_PROFILES[SubjectType.EXTERNAL_SSO]
    validate_mint_policy(
        subject_type=profile.subject_type,
        prefix=profile.prefix,
        scopes=profile.scopes,
    )


def test_wrong_prefix_rejected():
    with pytest.raises(MintPolicyViolation) as exc:
        validate_mint_policy(
            subject_type=SubjectType.ACCOUNT,
            prefix="dfoe_",  # SSO prefix on an account subject
            scopes=frozenset({Scope.FULL}),
        )
    assert "prefix" in str(exc.value)


def test_wrong_scopes_rejected():
    with pytest.raises(MintPolicyViolation) as exc:
        validate_mint_policy(
            subject_type=SubjectType.ACCOUNT,
            prefix="dfoa_",
            scopes=frozenset({Scope.APPS_RUN}),  # account should be {FULL}
        )
    assert "scopes" in str(exc.value)


def test_external_sso_with_full_scope_rejected():
    with pytest.raises(MintPolicyViolation):
        validate_mint_policy(
            subject_type=SubjectType.EXTERNAL_SSO,
            prefix="dfoe_",
            scopes=frozenset({Scope.FULL}),  # FULL never applies to dfoe_
        )


def test_message_carries_both_drift_reasons():
    """Mismatched prefix AND mismatched scopes both surface in one error."""
    with pytest.raises(MintPolicyViolation) as exc:
        validate_mint_policy(
            subject_type=SubjectType.ACCOUNT,
            prefix="dfoe_",
            scopes=frozenset({Scope.APPS_RUN}),
        )
    msg = str(exc.value)
    assert "prefix" in msg
    assert "scopes" in msg


def test_license_required_decorator_skips_on_ce():
    from unittest.mock import patch

    from services.openapi.license_gate import license_required

    @license_required
    def view():
        return "ok"

    with patch("services.openapi.license_gate.dify_config") as cfg:
        cfg.ENTERPRISE_ENABLED = False
        assert view() == "ok"


def test_license_required_decorator_403_on_invalid_ee_license():
    from unittest.mock import patch

    from werkzeug.exceptions import Forbidden

    from services.openapi.license_gate import license_required

    @license_required
    def view():
        return "ok"

    with (
        patch("services.openapi.license_gate.dify_config") as cfg,
        patch("services.openapi.license_gate._is_license_valid", return_value=False),
    ):
        cfg.ENTERPRISE_ENABLED = True
        with pytest.raises(Forbidden) as exc:
            view()
        assert "license_required" in exc.value.description


def test_license_required_decorator_passes_on_valid_ee_license():
    from unittest.mock import patch

    from services.openapi.license_gate import license_required

    @license_required
    def view():
        return "ok"

    with (
        patch("services.openapi.license_gate.dify_config") as cfg,
        patch("services.openapi.license_gate._is_license_valid", return_value=True),
    ):
        cfg.ENTERPRISE_ENABLED = True
        assert view() == "ok"
