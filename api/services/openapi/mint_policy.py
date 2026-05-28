"""Hard mint policy.

``validate_mint_policy`` cross-checks a (subject_type, prefix, scopes)
triple a caller intends to mint against ``MINTABLE_PROFILES`` —
the single source of truth in ``libs.oauth_bearer``.

The defense-in-depth value: if a future caller assembles ``prefix`` or
``scopes`` from a non-canonical source (env, request body, plug-in
contribution), the mismatch fails closed at approve time before any
row hits the DB. When the caller reads straight from
``MINTABLE_PROFILES``, the check is a structural pin — it confirms the
table entry is well-formed and the caller picked the right key.
"""

from __future__ import annotations

from libs.oauth_bearer import MINTABLE_PROFILES, Scope, SubjectType


class MintPolicyViolation(Exception):  # noqa: N818 — spec-defined name, used in BadRequest message
    """Raised on a (subject_type, prefix, scopes) mismatch. Callers translate
    to 400 ``mint_policy_violation``."""


def validate_mint_policy(
    *,
    subject_type: SubjectType,
    prefix: str,
    scopes: frozenset[Scope],
) -> None:
    """Raise ``MintPolicyViolation`` when the triple does not match the
    canonical ``MINTABLE_PROFILES`` entry for ``subject_type``.
    """
    profile = MINTABLE_PROFILES.get(subject_type)
    if profile is None:
        raise MintPolicyViolation(f"mint_policy_violation: unknown subject_type={subject_type!r}")

    drift = []
    if profile.prefix != prefix:
        drift.append(f"prefix got={prefix!r} expected={profile.prefix!r}")
    if frozenset(scopes) != profile.scopes:
        got = sorted(s.value for s in scopes)
        want = sorted(s.value for s in profile.scopes)
        drift.append(f"scopes got={got} expected={want}")

    if drift:
        raise MintPolicyViolation(f"mint_policy_violation: subject_type={subject_type.value} — " + "; ".join(drift))
