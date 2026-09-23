"""Keeping a node's secrets out of the Builder's prompts -- and keeping the
model's stand-in for them out of the draft.

The Builder inlines a node's ``data`` into an LLM prompt so an edit can leave
the fields it was not asked about byte-identical. An http-request node's
``data`` is also where a live bearer token or API key sits, so that inlining
has to stop at the credential.

TWO HALVES, AND NEITHER WORKS ALONE
-----------------------------------
``redact_node_config`` replaces a secret VALUE with ``REDACTED`` while keeping
its KEY: the model still sees that an ``Authorization`` header exists and can
reason about it, but never learns the token.

Redaction on its own creates a worse bug than the leak. The model reads
``Authorization:__DIFY_BUILDER_REDACTED__``, decides to rewrite ``headers``,
and writes the sentinel back -- destroying a working credential and leaving a
node that fails at run time with an unrecognizable token. So
``carries_redaction`` is the other half: ``graph_ops.validate_intent_args``
refuses any mutation whose value carries the sentinel, and the stored value
stands. The refusal is keyed on this exact, generated string -- never on
anything the model says about its own intentions.

The sentinel is deliberately ugly and unmistakable. It must never be
confusable with a real credential, and it must survive a JSON round trip
unchanged (pure ASCII, nothing JSON escapes), because the refusal check
serializes whatever it is handed and looks for it verbatim.

SCOPE, AND WHAT IS DELIBERATELY OUTSIDE IT
-----------------------------------------
This module knows only what the graph itself carries, and only in three places:
an http-request node's ``authorization`` block and its ``headers`` / ``params``
lines. Those are where a workflow author types a secret into a FIELD THAT EXISTS
TO HOLD ONE. Credentials held by a provider or a tool live outside the graph and
never reach a prompt this way.

NOT covered: a secret typed into a request ``body`` value (``body.data[].value``
-- e.g. a JSON payload with an ``api_key`` in it). Verified: it reaches
``preflight``'s refusal text verbatim, because pydantic's ``input_value`` repr
for a model-level error is the node's whole ``data``. Callers must not claim
otherwise.

It is not closed here on purpose, and the obvious fix makes things worse.
``graph_ops.validate_intent_args`` refuses any write carrying ``REDACTED``
(that guard is what stops the model handing the placeholder back and destroying
a live credential). Redaction and that guard are the same profile, so putting
body values in scope would make http-request BODIES UNEDITABLE: the model would
only ever see the sentinel, write it back, and be refused every time -- and a
request body is ordinary, frequently-edited content, not a credential field.
Closing it properly needs a second, persistence-and-prompt-only redaction
profile that the write guard does NOT consult, which is a design change beyond
the plan this comment was written in. Tracked as a follow-up.
"""

import copy
import json
from typing import Any

__all__ = ["REDACTED", "carries_redaction", "redact_node_config"]

REDACTED = "__DIFY_BUILDER_REDACTED__"

# graphon's ``HttpRequestNodeAuthorizationConfig`` (nodes/http_request/
# entities.py:40-43) is ``{type, api_key, header}``. ``type`` ("bearer" /
# "basic" / "custom") and ``header`` (a header NAME) are structure the model
# needs; everything else in that block is treated as the secret, so a field
# added there later is redacted by default rather than leaked by default.
_SAFE_AUTHORIZATION_CONFIG_KEYS = frozenset({"type", "header"})

# Newline-separated ``name: value`` strings, split on the FIRST colon by
# graphon (``executor._parse_header_string`` and ``_init_params``,
# nodes/http_request/executor.py:179-230).
_HEADER_LINE_KEYS = ("headers", "params")


def redact_node_config(config: dict[str, Any]) -> dict[str, Any]:
    """A copy of ``config`` with every credential value replaced by ``REDACTED``.

    Returns a new mapping and never mutates ``config`` or anything reachable
    from it -- callers hand in a view derived from the live draft graph, whose
    nested values are shared references with it.
    """
    out = dict(config)
    authorization = out.get("authorization")
    if isinstance(authorization, dict):
        out["authorization"] = _redact_authorization(authorization)
    for key in _HEADER_LINE_KEYS:
        value = out.get(key)
        if isinstance(value, str) and value:
            out[key] = _redact_header_lines(value)
    return out


def carries_redaction(value: Any) -> bool:
    """True when ``value`` -- at any depth -- contains the redaction sentinel.

    Serializing and substring-matching covers a bare string, a rewritten
    ``authorization`` dict and a list of header entries with one rule instead
    of three, and cannot miss a nesting shape nobody thought of.
    """
    if isinstance(value, str):
        return REDACTED in value
    try:
        text = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        text = str(value)
    return REDACTED in text


def _redact_authorization(authorization: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(authorization)
    config = out.get("config")
    if isinstance(config, dict):
        out["config"] = {k: (v if k in _SAFE_AUTHORIZATION_CONFIG_KEYS else REDACTED) for k, v in config.items()}
    return out


def _redact_header_lines(text: str) -> str:
    """Keep every header/param NAME and drop EVERY non-empty VALUE.

    Every value, not the suspicious-looking ones. Deciding by name would mean a
    denylist (``Authorization``, ``X-Api-Key``, ...) and a denylist misses
    ``X-Company-Token``, ``Cookie``, and whatever this tenant calls its header
    -- one miss is a leaked credential, so the rule has no exceptions. The
    known cost is that a harmless ``Content-Type: application/json`` is
    withheld too, and the model cannot usefully rewrite a content type through
    ``headers``. That is the intended trade; please do not "improve" it into a
    denylist.

    A line with no colon, or with an empty value, carries no secret and is
    left exactly as it is -- graphon reads both as "name with an empty value"
    and the model may need to see that.
    """
    lines = []
    for line in text.splitlines():
        name, separator, value = line.partition(":")
        if separator and value.strip():
            lines.append(f"{name}:{REDACTED}")
        else:
            lines.append(line)
    return "\n".join(lines)
