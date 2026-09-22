"""Telling a user-supplied URL or credential from one an LLM invented.

Pure, no I/O -- these helpers make no network or model calls and import
nothing from ``services`` (besides each other), ``flask``, or model-runtime,
so they are safe to call from anywhere in Dify Builder's cognition.

ESQ1-302 traces to the Builder inventing a plausible-looking endpoint when a
goal gave it none (``https://api.example.com/ppt/generate``); S5b/F2 shows
the same failure one step earlier, in requirements analysis, which also
invented an ``Authorization: Bearer YOUR_API_KEY`` header. These helpers let
callers decide "did the user actually write this?" by comparing literal text
against what the user actually typed -- never by asking an LLM to judge its
own output (no control flow here is keyed on LLM prose).
"""

import json
import re
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit

# A URL literal as it appears embedded in freeform prose. Restricted to the
# ASCII characters RFC 3986 allows in a URI, so it stops before CJK or other
# non-URL text glued onto the URL with no separating space (e.g. a Chinese
# sentence with no space before or after the URL). Trailing sentence
# punctuation this still picks up (a period ending a sentence, say) is
# stripped separately below, since ``.`` is itself a valid URI character.
_URL_RE = re.compile(r"https?://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+", re.IGNORECASE)

# Punctuation that ends a sentence or closes a bracket/quote rather than
# belonging to the URL itself, stripped from the end of each regex match.
_URL_TRAILING_PUNCTUATION = ".,;:!?)]'\""

# A Dify workflow template reference, e.g. ``{{#node1.url#}}``. It names a
# variable, not a literal value, so it can never be "invented" the way a
# hardcoded URL or secret can -- it's already bound to whatever that
# variable resolves to at runtime.
_TEMPLATE_MARKER = "{{#"

_AUTH_SCHEME_PREFIX_RE = re.compile(r"^(?:bearer|basic|token)\s+", re.IGNORECASE)

# Case-insensitive tokens an LLM writes in place of a secret it doesn't have.
CREDENTIAL_PLACEHOLDER_RE = re.compile(
    r"YOUR[_-]?(API[_-]?)?(KEY|TOKEN|SECRET)"
    r"|(API[_-]?KEY|TOKEN|SECRET)[_-]?HERE"
    r"|<[^>]+>"
    r"|REPLACE[_-]?ME"
    r"|CHANGE[_-]?ME"
    r"|x{6,}"
    r"|\*{6,}",
    re.IGNORECASE,
)

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


def url_hosts(text: str) -> set[str]:
    """Lowercase hostnames of every ``http(s)://…`` URL literally present in
    ``text``. This is the trust set for a URL check: a host the user's own
    text actually names."""
    hosts: set[str] = set()
    for raw_url in _URL_RE.findall(text or ""):
        url = raw_url.rstrip(_URL_TRAILING_PUNCTUATION)
        try:
            host = urlsplit(url).hostname
        except ValueError:
            continue
        if host:
            hosts.add(host.lower())
    return hosts


def is_user_supplied_url(url: str, trusted_text: str) -> bool:
    """True iff ``url`` is something the user actually gave: its host
    appears among the URLs literally present in ``trusted_text``.

    A Dify template reference (contains ``{{#``) is a variable, not a
    literal, so it is never a fabrication and always returns True.
    """
    if not url:
        return False
    if _TEMPLATE_MARKER in url:
        return True
    try:
        host = urlsplit(url).hostname
    except ValueError:
        return False
    if not host:
        return False
    return host.lower() in url_hosts(trusted_text)


def strip_auth_scheme(value: str) -> str:
    """Strip a leading ``Bearer ``/``Basic ``/``Token `` auth-scheme prefix
    (case-insensitive) from ``value``, if present; otherwise return it
    unchanged. Shared so every credential check strips the same way."""
    return _AUTH_SCHEME_PREFIX_RE.sub("", value or "", count=1)


def is_user_supplied_secret(value: str, trusted_text: str) -> bool:
    """True iff ``value`` -- after stripping a leading ``Bearer ``/``Basic
    ``/``Token `` auth-scheme prefix -- is a literal the user actually
    wrote, rather than an LLM's placeholder for a secret it does not have.
    """
    remainder = strip_auth_scheme(value)
    if not remainder:
        return False
    if _TEMPLATE_MARKER in remainder:
        return True
    if CREDENTIAL_PLACEHOLDER_RE.search(remainder):
        return False
    return remainder in (trusted_text or "")


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


def trusted_text_for(goal_text: str, requirements: Mapping[str, Any]) -> str:
    """The text a candidate URL/credential is checked against: what the user
    actually submitted -- the goal prose plus the requirements form they
    filled in, as they submitted it (never anything an LLM wrote about
    either)."""
    return f"{goal_text}\n{json.dumps(dict(requirements), ensure_ascii=False)}"
