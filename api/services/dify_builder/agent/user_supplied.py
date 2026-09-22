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

from core.dify_builder import urls
from core.dify_builder.credentials import is_credential_key, is_credential_param_key

__all__ = [
    "CREDENTIAL_PLACEHOLDER_RE",
    "is_credential_key",
    "is_credential_param_key",
    "is_user_supplied_secret",
    "is_user_supplied_url",
    "strip_auth_scheme",
    "trusted_text_for",
    "url_hosts",
]

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

    A Dify template in the HOST position (``urls.host_is_templated``: the url
    starts with one, or its host contains one) is a variable, not a literal,
    so it is never a fabrication and returns True. A template only in the
    path or query does NOT exempt the url -- ``https://api.pptrender.io/v1/
    render?topic={{#node1.topic#}}`` still names a literal host, which is
    checked like any other.
    """
    if not url:
        return False
    if urls.host_is_templated(url):
        return True
    parts = urls.split_origin(url)
    if parts is None or not parts.host:
        return False
    return parts.host.lower() in url_hosts(trusted_text)


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


def trusted_text_for(goal_text: str, requirements: Mapping[str, Any]) -> str:
    """The text a candidate URL/credential is checked against: what the user
    actually submitted -- the goal prose plus the requirements form they
    filled in, as they submitted it (never anything an LLM wrote about
    either)."""
    return f"{goal_text}\n{json.dumps(dict(requirements), ensure_ascii=False)}"
