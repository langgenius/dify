"""Whether a header/param/field key names a credential.

Pure, no I/O, stdlib-only -- ``core/dify_builder`` must not import from
``services``, so this is the single shared home for ``is_credential_key``
(moved here in the Task 3 review fix round) and its params-only sibling
``is_credential_param_key``. Both ``core/dify_builder/handlers_fix.py``
(deciding which start variables a mocked/prefilled form must skip) and
``services/dify_builder/agent/build.py`` (deciding which literals to ground)
need the SAME rule, so there is one definition; ``user_supplied.py`` imports
and re-exports both so existing ``services``-side callers see no API change.
"""

import re

# A dict/field key's last word-segment that, by itself, names a credential
# regardless of what comes before it (so "access_token" and "auth" both
# qualify, but "token_limit" does not -- "limit" is the last segment).
_CREDENTIAL_LAST_SEGMENTS = {"authorization", "auth", "token", "secret", "password", "passwd"}

# A last segment of "key" only counts as a credential when the segment (or
# merged word) before it names what kind of key it is -- otherwise ordinary
# fields like "key_points" would match on "key" alone.
_CREDENTIAL_KEY_PREFIXES = {"api", "access", "secret", "private", "auth"}

# Splits an identifier into camelCase words: an uppercase run immediately
# followed by "Xy" (e.g. the "API" in "APIKey"), or an optional leading
# capital plus a run of lowercase/digits (e.g. "api", "Key", "3").
_CAMEL_SEGMENT_RE = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z0-9]+|[A-Z]+|[0-9]+")


def _key_segments(key: str) -> list[str]:
    """Lowercase word-segments of a dict/field key, split on ``_``, ``-``,
    ``.``, whitespace, and camelCase boundaries -- so ``x-api-key``,
    ``apiKey`` and ``api_key`` all segment to ``["api", "key"]``."""
    segments: list[str] = []
    for part in re.split(r"[_\-.\s]+", key or ""):
        if not part:
            continue
        segments.extend(match.lower() for match in _CAMEL_SEGMENT_RE.findall(part))
    return segments


def is_credential_key(key: str) -> bool:
    """True iff ``key`` names a credential, decided by its LAST segment --
    not by containing a credential-ish substring anywhere. So
    ``password_policy``, ``token_limit``, ``session_token_expiry`` and
    ``max_tokens`` are NOT credential keys, but ``api_key``, ``apiKey``,
    ``x-api-key``, ``access_token`` and ``Authorization`` are.
    """
    segments = _key_segments(key)
    if not segments:
        return False
    last = segments[-1]
    if last in _CREDENTIAL_LAST_SEGMENTS or last == "apikey":
        return True
    return last == "key" and len(segments) >= 2 and segments[-2] in _CREDENTIAL_KEY_PREFIXES


def is_credential_param_key(key: str) -> bool:
    """``is_credential_key`` PLUS a bare ``key`` (case-insensitive, the WHOLE
    key -- not merely its last segment): a raw ``?key=...`` query parameter is
    a common way an API names its API key, which ``is_credential_key`` alone
    misses (its last-segment rule requires a qualifying prefix like
    ``api``/``access`` before a bare ``key``). Params-only -- a header simply
    named ``key`` is not a realistic credential header the way a query param
    is, so this rule is not applied to headers. ``cache_key``/``key_points``
    still segment to more than just ``key`` and stay non-credential, same as
    under ``is_credential_key``.
    """
    return is_credential_key(key) or (key or "").strip().lower() == "key"
