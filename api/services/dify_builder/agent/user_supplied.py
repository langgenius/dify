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

# A URL literal as it appears embedded in freeform prose -- stops at
# whitespace or a quoting/bracketing character so "https://a.com/x." at the
# end of a sentence doesn't pull in trailing punctuation.
_URL_RE = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)

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
        try:
            host = urlsplit(raw_url).hostname
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


def is_user_supplied_secret(value: str, trusted_text: str) -> bool:
    """True iff ``value`` -- after stripping a leading ``Bearer ``/``Basic
    ``/``Token `` auth-scheme prefix -- is a literal the user actually
    wrote, rather than an LLM's placeholder for a secret it does not have.
    """
    remainder = _AUTH_SCHEME_PREFIX_RE.sub("", value or "", count=1)
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
