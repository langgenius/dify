"""The generic MCP tools over the op catalog: which ops a caller can use, found and described.

A caller's token decides which catalog ops it can call. The filter hides, per entry,
what an agent could not use anyway (streams, files, internal or deprecated ops) and,
when the token kind is known, what the op itself would refuse that kind. The refusal
stays the op's: an unknown token or none sees every entry that passes the first rules.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Final

from flask import Flask, current_app

from constants.oauth_bearer import Scope, TokenType
from controllers.openapi._catalog import Bind, current_catalog, iter_handlers
from controllers.openapi._mcp_call import (
    FileInputUnsupported,
    OpCall,
    OpResult,
    RouteMismatch,
    UnknownOp,
    UnsafePathValue,
    call_op,
)
from controllers.openapi.auth.requirements import CheckScope, CheckSubject
from controllers.openapi.auth.spec import Effect, EndpointSpec, Kind, spec_of
from core.mcp import types as mcp_types
from core.mcp.server.streamable_http import STRUCTURED_OUTPUT_MIN_VERSION

FIND_LIMIT: Final = 20
FIND_TOOL: Final = "dify_find"
TOOL_RESULT_MAX_CHARS: Final = 40_000
_BEARER_SCHEME: Final = "bearer"
_PASSED_HEADERS: Final = ("WWW-Authenticate", "Cache-Control")
_HTTP_UNAUTHORIZED: Final = 401
_HTTP_ERROR_MIN: Final = 400
_TEXT_TYPE: Final = "text"
_HINTS_KEY: Final = "hints"
_OP_KEY: Final = "op"
_INPUT_KEY: Final = "input"
_QUERY_KEY: Final = "query"
_SPECS_EXT_KEY: Final = "openapi_mcp_op_specs"
_HIDDEN_KINDS: Final = frozenset({Kind.SSE.value, Kind.FILE.value})
_ID_SEPARATOR: Final = "."


class CallTool(StrEnum):
    """The tool that calls an op of a given effect."""

    effect: Effect

    READ = ("dify_read", Effect.READ)
    WRITE = ("dify_write", Effect.WRITE)
    DESTRUCTIVE = ("dify_destructive", Effect.DESTRUCTIVE)

    def __new__(cls, value: str, effect: Effect) -> CallTool:
        obj = str.__new__(cls, value)
        obj._value_ = value
        obj.effect = effect
        return obj

    @classmethod
    def for_effect(cls, effect: Effect) -> CallTool:
        """Postcondition: the member for ``effect``; ``ValueError`` when none."""
        for tool in cls:
            if tool.effect == effect:
                return tool
        raise ValueError(f"no call tool for effect {effect!r}")


@dataclass(frozen=True, slots=True, kw_only=True)
class FoundOps:
    total: int
    ops: list[dict[str, Any]]  # each: {"op", "summary", "effect", "tool"}; "tool" is the call tool for that effect


@dataclass(frozen=True, slots=True)
class _Candidate:
    entry: Mapping[str, Any]
    spec: EndpointSpec
    token_type: TokenType | None


type _HiddenWhen = Callable[[_Candidate], bool]


def _hides_streams_and_files(candidate: _Candidate) -> bool:
    """Hides ops whose response is a stream or a file: a tool call returns one JSON-text result."""
    return candidate.entry["kind"] in _HIDDEN_KINDS


def _hides_flagged_ops(candidate: _Candidate) -> bool:
    """Hides internal and deprecated ops: they are not part of the surface agents should use."""
    if candidate.entry["internal"]:
        return True
    return bool(candidate.entry["deprecated"])


def _hides_required_file_input(candidate: _Candidate) -> bool:
    """Hides ops that cannot run without a file upload: a tool call carries JSON only."""
    required = set(candidate.entry["input"]["required"])
    return bool(required & _file_names(candidate.entry))


def _hides_other_subjects(candidate: _Candidate) -> bool:
    """Hides ops whose subject check admits no class of the token kind's subject: the op would answer 403."""
    token_type = candidate.token_type
    if token_type is None:
        return False
    for requirement in candidate.spec.requirements:
        if isinstance(requirement, CheckSubject) and not _admits(requirement, token_type):
            return True
    return False


def _hides_out_of_scope(candidate: _Candidate) -> bool:
    """Hides ops that need a scope the token kind's subject lacks (not for PATs, which carry no OAuth scopes)."""
    token_type = candidate.token_type
    if token_type is None:
        return False
    if token_type is TokenType.PERSONAL_ACCESS:
        return False
    scopes = token_type.subject.scopes
    if Scope.FULL in scopes:
        return False
    for requirement in candidate.spec.requirements:
        if isinstance(requirement, CheckScope) and requirement.scope not in scopes:
            return True
    return False


def _hides_without_pat_policy(candidate: _Candidate) -> bool:
    """Hides ops with no PAT policy from personal access tokens: the op refuses every PAT."""
    if candidate.token_type is not TokenType.PERSONAL_ACCESS:
        return False
    return candidate.spec.pat_policy is None


_ENTRY_RULES: Final[tuple[_HiddenWhen, ...]] = (
    _hides_streams_and_files,
    _hides_flagged_ops,
    _hides_required_file_input,
)
_CALLER_RULES: Final[tuple[_HiddenWhen, ...]] = (
    _hides_other_subjects,
    _hides_out_of_scope,
    _hides_without_pat_policy,
)
_RULES: Final[tuple[_HiddenWhen, ...]] = (*_ENTRY_RULES, *_CALLER_RULES)


def _admits(requirement: CheckSubject, token_type: TokenType) -> bool:
    return any(subject.subject_type == token_type.subject for subject in requirement.allowed)


def _file_names(entry: Mapping[str, Any]) -> set[str]:
    return {name for name, bind in entry["bind"].items() if bind == Bind.FILE}


def _op_specs(app: Flask) -> Mapping[str, EndpointSpec]:
    """Each op id mapped to its endpoint spec.

    Postcondition: built once per app from ``iter_handlers`` and kept in
    ``app.extensions`` (the handler walk touches every url rule), like the catalog it mirrors.
    """
    specs = app.extensions.get(_SPECS_EXT_KEY)
    if specs is None:
        specs = app.extensions[_SPECS_EXT_KEY] = {
            spec.catalog.op: spec for _, _, handler in iter_handlers(app) if (spec := spec_of(handler)) is not None
        }
    return specs


def _token_type(token: str | None) -> TokenType | None:
    if token is None:
        return None
    return TokenType.for_token(token)


def callable_ops(token: str | None) -> dict[str, Mapping[str, Any]]:
    """The catalog entries the bearer's token kind can call.

    Precondition: inside a Flask request. Postcondition: the catalog is parsed once;
    the entries are fresh dicts the caller may keep. A token with an unknown prefix,
    or no token, gets every entry that passes the entry rules.
    """
    raw, _ = current_catalog()
    specs = _op_specs(current_app._get_current_object())  # type: ignore[attr-defined]
    token_type = _token_type(token)
    entries: dict[str, Mapping[str, Any]] = json.loads(raw)["ops"]
    return {
        op: entry
        for op, entry in entries.items()
        if not any(rule(_Candidate(entry, specs[op], token_type)) for rule in _RULES)
    }


def _tool_for(entry: Mapping[str, Any]) -> str:
    return CallTool.for_effect(Effect(entry["effect"])).value


def _matches(words: list[str], op: str, entry: Mapping[str, Any]) -> bool:
    haystack = f"{op.replace(_ID_SEPARATOR, ' ')} {entry['summary']}".lower()
    return all(word in haystack for word in words)


def find_ops(query: str, *, token: str | None) -> FoundOps:
    """The ops the token can call whose id or summary holds every word of ``query``.

    Precondition: inside a Flask request. Postcondition: matching is case-insensitive
    and an empty query matches all; results are sorted by op id and cut to
    ``FIND_LIMIT``; ``total`` counts the matches before the cut.
    """
    words = query.lower().split()
    entries = callable_ops(token)
    matched = sorted(op for op, entry in entries.items() if _matches(words, op, entry))
    ops = [
        {
            "op": op,
            "summary": entries[op]["summary"],
            "effect": entries[op]["effect"],
            "tool": _tool_for(entries[op]),
        }
        for op in matched[:FIND_LIMIT]
    ]
    return FoundOps(total=len(matched), ops=ops)


def describe_op(op: str, *, token: str | None) -> dict[str, Any]:
    """One op's input schema and examples, without its file-bound fields.

    Precondition: inside a Flask request. Postcondition: returns
    ``{"op", "summary", "effect", "tool", "input", "examples"}``; raises ``UnknownOp``
    when the op is missing or hidden from this token. The parsed catalog is not shared.
    """
    entry = callable_ops(token).get(op)
    if entry is None:
        raise UnknownOp(op)
    schema = copy.deepcopy(entry["input"])
    for name in _file_names(entry):
        schema["properties"].pop(name, None)
    schema["required"] = [name for name in schema["required"] if name in schema["properties"]]
    return {
        "op": op,
        "summary": entry["summary"],
        "effect": entry["effect"],
        "tool": _tool_for(entry),
        "input": schema,
        "examples": entry["examples"],
    }


MCP_INSTRUCTIONS: Final = """This server runs operations of a Dify server. Four tools: dify_find, dify_read, dify_write, dify_destructive.

1. First call dify_read with op "get.workspace" and input {}. It confirms the login and lists workspaces with their ids.
2. Many operations take workspace_id. Nothing fills it in for you: pass the id from step 1.
3. Before calling an operation, look it up: dify_find with a few words lists operations; dify_find with op "<id>" returns its input schema and examples. Operation ids can change between server versions, so do not guess them.
4. Call an operation with the tool that dify_find names for it. dify_destructive operations cannot be undone: confirm with the human first.
5. To run an app, call its start operation (start.console_app.<mode>), then wait.job with the returned job id until the status is final. A status of "paused" means the run needs human input: follow the hints.
6. Every result may carry "hints": ready-made next calls. Prefer them over building a call yourself.
7. A file variable of an app takes a file mapping with a URL in "inputs": {"transfer_method": "remote_url", "url": "https://...", "type": "document"}.
8. An operation that dify_find does not list is not available to this login."""  # noqa: E501

_STRING: Final = {"type": "string"}
_CALL_SCHEMA: Final = {
    "type": "object",
    "properties": {_OP_KEY: _STRING, _INPUT_KEY: {"type": "object"}},
    "required": [_OP_KEY, _INPUT_KEY],
    "additionalProperties": False,
}
_FIND_SCHEMA: Final = {
    "type": "object",
    "properties": {_QUERY_KEY: _STRING, _OP_KEY: _STRING},
    "additionalProperties": False,
}


class Unauthenticated(Exception):  # noqa: N818
    """An operation answered 401: the whole MCP request must answer 401 with these headers."""

    def __init__(self, headers: Mapping[str, str]) -> None:
        super().__init__("unauthenticated")
        self.headers = dict(headers)


def tool_list() -> list[mcp_types.Tool]:
    """Postcondition: the four tools, fixed; needs no request, database or catalog."""
    find = mcp_types.Tool(
        name=FIND_TOOL,
        description="List the operations this login can call, or describe one operation by id.",
        inputSchema=_FIND_SCHEMA,
        annotations=mcp_types.ToolAnnotations(readOnlyHint=True),
    )
    calls = [
        mcp_types.Tool(
            name=tool.value,
            description=f"Call an operation whose effect is {tool.effect.value}.",
            inputSchema=_CALL_SCHEMA,
            annotations=mcp_types.ToolAnnotations(
                readOnlyHint=tool.effect is Effect.READ,
                destructiveHint=tool.effect is Effect.DESTRUCTIVE,
            ),
        )
        for tool in CallTool
    ]
    return [find, *calls]


def _error(message: str) -> mcp_types.CallToolResult:
    return mcp_types.CallToolResult(isError=True, content=[mcp_types.TextContent(type=_TEXT_TYPE, text=message)])


def _compact(body: Any) -> str:
    return json.dumps(body, separators=(",", ":"), ensure_ascii=False)


def _supports_structured_output(protocol_version: str) -> bool:
    """MCP versions are YYYY-MM-DD strings, so lexical order is chronological (as in the app-level server)."""
    return protocol_version >= STRUCTURED_OUTPUT_MIN_VERSION


def _json_result(body: Any, *, protocol_version: str) -> mcp_types.CallToolResult:
    """Postcondition: the body as compact JSON text, or a tool error when the text is above
    ``TOOL_RESULT_MAX_CHARS``; ``structuredContent`` only for an object body on a protocol that has it."""
    text = _compact(body)
    if len(text) > TOOL_RESULT_MAX_CHARS:
        return _error(
            f"The result is {len(text)} characters, above the {TOOL_RESULT_MAX_CHARS} limit. "
            "Narrow the request (use `limit`, a filter, or a more specific operation)."
        )
    result = mcp_types.CallToolResult(content=[mcp_types.TextContent(type=_TEXT_TYPE, text=text)])
    if not isinstance(body, dict):
        return result
    if not _supports_structured_output(protocol_version):
        return result
    result.structuredContent = body
    return result


def _bearer_token(authorization: str | None) -> str | None:
    """Postcondition: the token after the ``Bearer`` scheme (any case), or None."""
    if authorization is None:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != _BEARER_SCHEME:
        return None
    return value.strip() or None


def _unknown_op(op: str) -> mcp_types.CallToolResult:
    return _error(f"No operation `{op}`. Use {FIND_TOOL} to search.")


def _string_argument(arguments: Mapping[str, Any], name: str) -> str | None:
    """Postcondition: the argument when it is a non-empty string, else None."""
    value = arguments.get(name)
    if not isinstance(value, str):
        return None
    return value or None


def _run_find(arguments: Mapping[str, Any], *, token: str | None, protocol_version: str) -> mcp_types.CallToolResult:
    """Precondition: inside a Flask request. Postcondition: ``describe_op`` when ``op`` is given, else a search."""
    if _OP_KEY in arguments:
        op = _string_argument(arguments, _OP_KEY)
        if op is None:
            return _error("`op` must be a non-empty string.")
        try:
            return _json_result(describe_op(op, token=token), protocol_version=protocol_version)
        except UnknownOp:
            return _unknown_op(op)
    query = arguments.get(_QUERY_KEY, "")
    if not isinstance(query, str):
        return _error("`query` must be a string.")
    found = find_ops(query, token=token)
    return _json_result({"total": found.total, "ops": found.ops}, protocol_version=protocol_version)


_REFUSAL_MESSAGES: Final[Mapping[type[Exception], Callable[[Exception], str]]] = {
    UnsafePathValue: lambda exc: f"Nothing ran: the input is not usable ({exc}).",
    RouteMismatch: lambda exc: "Nothing ran: the input does not address this operation.",
    FileInputUnsupported: lambda exc: (
        "Nothing ran: this operation takes a file upload, which a tool call cannot carry."
    ),
}


def _is_callable_hint(hint: Any, allowed: Mapping[str, Any]) -> bool:
    if not isinstance(hint, dict):
        return False
    return hint.get(_OP_KEY) in allowed


def _without_uncallable_hints(body: Any, allowed: Mapping[str, Any]) -> Any:
    """Postcondition: for an object body with a ``hints`` list, the same body with only the hints whose op is
    in ``allowed``, in order; any other body is returned as it is."""
    if not isinstance(body, dict):
        return body
    hints = body.get(_HINTS_KEY)
    if not isinstance(hints, list):
        return body
    return {**body, _HINTS_KEY: [hint for hint in hints if _is_callable_hint(hint, allowed)]}


def _map_result(result: OpResult, *, allowed: Mapping[str, Any], protocol_version: str) -> mcp_types.CallToolResult:
    """Postcondition: the op's response as a tool result; raises ``Unauthenticated`` on 401."""
    if result.status == _HTTP_UNAUTHORIZED:
        raise Unauthenticated({name: result.headers[name] for name in _PASSED_HEADERS if name in result.headers})
    if result.status >= _HTTP_ERROR_MIN:
        if result.is_json:
            return _error(_compact(result.body))
        return _error(f"The operation answered {result.status} without a JSON body.")
    if not result.is_json:
        return _error("The operation returned a non-JSON response, which a tool call cannot carry.")
    body = _without_uncallable_hints(result.body, allowed)
    return _json_result(body, protocol_version=protocol_version)


def _run_call(
    tool: CallTool,
    arguments: Mapping[str, Any],
    *,
    authorization: str | None,
    trace_id: str | None,
    protocol_version: str,
) -> mcp_types.CallToolResult:
    """Precondition: inside a Flask request. Postcondition: the op ran, or a tool error says why it did not."""
    op = _string_argument(arguments, _OP_KEY)
    if op is None:
        return _error("`op` must be a non-empty string.")
    op_input = arguments.get(_INPUT_KEY)
    if not isinstance(op_input, dict):
        return _error("`input` must be a JSON object.")
    allowed = callable_ops(_bearer_token(authorization))
    entry = allowed.get(op)
    if entry is None:
        return _unknown_op(op)
    effect = Effect(entry["effect"])
    if effect != tool.effect:
        return _error(f"`{op}` is a {effect.value} operation. Call it with {CallTool.for_effect(effect).value}.")
    try:
        result = call_op(OpCall(op=op, input=op_input, authorization=authorization, trace_id=trace_id))
    except tuple(_REFUSAL_MESSAGES) as refusal:
        return _error(_REFUSAL_MESSAGES[type(refusal)](refusal))
    return _map_result(result, allowed=allowed, protocol_version=protocol_version)


def run_tool(
    name: str,
    arguments: Mapping[str, Any],
    *,
    authorization: str | None,
    trace_id: str | None,
    protocol_version: str,
) -> mcp_types.CallToolResult:
    """Run one tool call.

    Precondition: inside a Flask request. Postcondition: a result for the call, with
    ``isError`` set for every failure except a 401 from the op, which raises
    ``Unauthenticated``. A name that is not one of the four tools is a tool error.
    """
    if name == FIND_TOOL:
        return _run_find(arguments, token=_bearer_token(authorization), protocol_version=protocol_version)
    try:
        tool = CallTool(name)
    except ValueError:
        return _error(f"Unknown tool `{name}`.")
    return _run_call(tool, arguments, authorization=authorization, trace_id=trace_id, protocol_version=protocol_version)
