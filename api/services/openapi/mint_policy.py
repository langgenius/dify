"""Hard mint policy.

``validate_mint_policy`` cross-checks a (subject_type, prefix, scopes)
triple a caller intends to mint against ``subject_type``'s own prefix
and scopes — the single source of truth on ``libs.oauth_bearer.SubjectType``.

The defense-in-depth value: if a future caller assembles ``prefix`` or
``scopes`` from a non-canonical source (env, request body, plug-in
contribution), the mismatch fails closed at approve time before any
row hits the DB. When the caller reads straight from
``subject_type.prefix`` / ``subject_type.scopes``, the check is a
structural pin — it confirms the caller picked the right values.
"""

from __future__ import annotations

from libs.oauth_bearer import Scope, SubjectType


class MintPolicyViolation(Exception):  # noqa: N818 — spec-defined name, used in BadRequest message
    """Raised on a (subject_type, prefix, scopes) mismatch. Callers translate
    to 400 ``mint_policy_violation``."""


def validate_mint_policy(
    *,
    subject_type: SubjectType,
    prefix: str,
    scopes: frozenset[Scope],
) -> None:
    """Raise ``MintPolicyViolation`` when the triple does not match
    ``subject_type``'s canonical prefix/scopes.
    """
    drift = []
    if subject_type.prefix != prefix:
        drift.append(f"prefix got={prefix!r} expected={subject_type.prefix!r}")
    if frozenset(scopes) != subject_type.scopes:
        got = sorted(s.value for s in scopes)
        want = sorted(s.value for s in subject_type.scopes)
        drift.append(f"scopes got={got} expected={want}")

    if drift:
        raise MintPolicyViolation(f"mint_policy_violation: subject_type={subject_type.value} — " + "; ".join(drift))
