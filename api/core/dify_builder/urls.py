"""Where a URL's HOST sits, reading a Dify template as one opaque unit.

Pure, no I/O, stdlib-only -- ``core/dify_builder`` must not import from
``services``, so this is the single shared definition of a URL's host
position. Both ``services/dify_builder/agent`` (deciding whether a URL is
user-supplied, and grounding an invented one) and
``core/dify_builder/handlers_fix.py`` (``endpoint_variable_names``: which
start variables a mocked form must leave for the human) need the SAME rule,
or a template grounding creates could be mocked, or a path/query data input
could be withheld from mocking.

``urllib.parse.urlsplit`` cannot be used on a templated URL: a Dify template
(``{{#node.var#}}``) contains ``#``, which ``urlsplit`` reads as the start of
the fragment -- ``https://{{#s.host#}}/v1`` would have host ``{{``.
"""

import re
from typing import NamedTuple

# A Dify workflow template reference, e.g. ``{{#node1.url#}}``: a variable,
# not a literal.
TEMPLATE_MARKER = "{{#"

# ``scheme://authority`` at the very start of a URL. A template inside the
# authority is matched as one unit (tried first), so its ``#`` does not end
# the authority the way a bare ``/``, ``?`` or ``#`` does.
_ORIGIN_RE = re.compile(r"[A-Za-z][A-Za-z0-9+.\-]*://(?:\{\{#[^#]*#\}\}|[^/?#\s])*")


class UrlOrigin(NamedTuple):
    """A URL split at the end of its authority, both halves exactly as written."""

    origin: str  # ``scheme://[userinfo@]host[:port]``
    host: str  # the authority's host alone (no userinfo, no port), NOT lowercased
    rest: str  # everything after the origin -- path, query, fragment -- verbatim


def split_origin(url: str) -> UrlOrigin | None:
    """``url`` (stripped of surrounding whitespace) split into its origin,
    host and the rest, or None when it does not start with ``scheme://``
    (a bare ``host/path``, or a URL that starts with a template)."""
    text = (url or "").strip()
    match = _ORIGIN_RE.match(text)
    if match is None:
        return None
    origin = match.group(0)
    host_port = origin.partition("://")[2].rpartition("@")[2]
    host = host_port[1:].partition("]")[0] if host_port.startswith("[") else host_port.partition(":")[0]
    return UrlOrigin(origin=origin, host=host, rest=text[len(origin) :])


def host_is_templated(url: str) -> bool:
    """True when a template occupies ``url``'s HOST position: the stripped
    url STARTS with a template (``{{#s.h_url#}}/v1/render``), or its host
    contains one (``https://{{#s.host#}}/v1``). A template only in the path
    or query (``https://wttr.in/{{#s.city#}}``) does NOT count -- that is an
    ordinary data input on a literal host."""
    text = (url or "").strip()
    if text.startswith(TEMPLATE_MARKER):
        return True
    parts = split_origin(text)
    return parts is not None and TEMPLATE_MARKER in parts.host
