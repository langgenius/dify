"""The generic MCP tools over the op catalog: which ops a caller can use, found and described.

A caller's token decides which catalog ops it can call. The filter hides, per entry,
what an agent could not use anyway (files, internal or deprecated ops) and,
when the token kind is known, what the op itself would refuse that kind. The refusal
stays the op's: an unknown token or none sees every entry that passes the first rules.
"""

from __future__ import annotations

import copy
import json
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from http import HTTPStatus
from typing import Any, Final

from configs import dify_config
from constants.oauth_bearer import TokenType
from controllers.openapi._catalog import Bind, CatalogOp, RegisteredOp, op_registry
from controllers.openapi._mcp_call import (
    FileInputUnsupported,
    OpCall,
    OpResult,
    RouteMismatch,
    UnknownOp,
    UnsafeHeaderValue,
    UnsafePathValue,
    call_op,
)
from controllers.openapi.auth.spec import Effect, Kind
from core.mcp import types as mcp_types
from core.mcp.server.streamable_http import STRUCTURED_OUTPUT_MIN_VERSION
from services.run_job import JobStartFields

FIND_TOOL: Final = "dify_find"
_CUT_NOTE: Final = (
    "The result was cut at {limit:,} of {length:,} characters. The operation ran; calling it again with the same "
    "input will not return the rest. Narrow the request with `limit`, a filter, or a more specific operation."
)
_PASSED_HEADERS: Final = ("WWW-Authenticate", "Cache-Control")
_RETRY_AFTER_HEADER: Final = "Retry-After"
_RETRY_AFTER_MESSAGE: Final = "Retry after {seconds} seconds."
_TEXT_TYPE: Final = "text"
_HINTS_KEY: Final = "hints"
_OP_KEY: Final = "op"
_TOOL_KEY: Final = "tool"
_TOTAL_KEY: Final = "total"
_QUERY_KEY: Final = "query"
_OFFSET_KEY: Final = "offset"
_NEXT_OFFSET_KEY: Final = "next_offset"
_OPS_KEY: Final = "ops"
_INPUT_KEY: Final = "input"
_EXAMPLES_KEY: Final = "examples"
_PROPERTIES_KEY: Final = "properties"
_REQUIRED_KEY: Final = "required"
_PLACEHOLDER: Final = "<{name}>"
# A word is a run of letters or digits; everything else separates words.
_WORD: Final = re.compile(r"[^\W_]+")
_PLURAL_IES: Final = "ies"
_SINGULAR_Y: Final = "y"
_PLURAL_S: Final = "s"
_DOUBLE_S: Final = "ss"
# The shortest word that matches longer words it begins, so "plugin" finds "plugins" but "app" does not find "apply".
MIN_PREFIX_LETTERS: Final = 4
_ABSENT_OP_VALUES: Final = (None, "")


class CallTool(StrEnum):
    """The tool that calls an op of a given effect."""

    effect: Effect
    meaning: str

    READ = ("dify_read", Effect.READ, "it changes nothing")
    WRITE = ("dify_write", Effect.WRITE, "it creates or updates data")
    DESTRUCTIVE = (
        "dify_destructive",
        Effect.DESTRUCTIVE,
        "it removes or overwrites data, or stops a run, and cannot be undone. Confirm with the human first",
    )

    def __new__(cls, value: str, effect: Effect, meaning: str) -> CallTool:
        """Postcondition: a str member whose value is the tool name, carrying its effect and what that effect
        means for the data."""
        obj = str.__new__(cls, value)
        obj._value_ = value
        obj.effect = effect
        obj.meaning = meaning
        return obj

    @property
    def description(self) -> str:
        """Postcondition: the tool description a host may show the model: the effect, what it means, and how to
        call."""
        return _CALL_DESCRIPTION.format(effect=self.effect.value, meaning=self.meaning)

    @classmethod
    def for_effect(cls, effect: Effect) -> CallTool:
        """Postcondition: the member for ``effect``; ``ValueError`` when none."""
        for tool in cls:
            if tool.effect == effect:
                return tool
        raise ValueError(f"no call tool for effect {effect!r}")


@dataclass(frozen=True, slots=True, kw_only=True)
class McpCaller:
    """Who sent the MCP request, read once from its headers."""

    authorization: str | None  # the raw Authorization header, forwarded to the op as is
    token: str | None  # the bearer token in ``authorization`` (``extract_bearer``), which decides the visible ops
    trace_id: str | None
    protocol_version: str  # the negotiated MCP version, which decides whether results carry structuredContent


# Each rule sees one registered op and the caller's token kind (None if unknown).
type _HiddenWhen = Callable[[RegisteredOp, TokenType | None], bool]


def _hides_files(registered: RegisteredOp, token_type: TokenType | None) -> bool:
    """Hides ops whose response is a file: a tool call returns one JSON-text result. A stream op answers its job's
    state instead, as the in-process call asks for one."""
    return registered.entry["kind"] == Kind.FILE.value


def _hides_flagged_ops(registered: RegisteredOp, token_type: TokenType | None) -> bool:
    """Hides internal and deprecated ops: they are not part of the surface agents should use."""
    if registered.entry["internal"]:
        return True
    return registered.entry["deprecated"]


def _hides_required_file_input(registered: RegisteredOp, token_type: TokenType | None) -> bool:
    """Hides ops that cannot run without a file upload: a tool call carries JSON only."""
    required = set(registered.entry["input"]["required"])
    return bool(required & _file_names(registered.entry))


def _hides_refused_kinds(registered: RegisteredOp, token_type: TokenType | None) -> bool:
    """Hides ops the route would refuse for the token kind: its subject, scope or PAT policy answers 403."""
    if token_type is None:
        return False
    return not registered.spec.admits(token_type)


_RULES: Final[tuple[_HiddenWhen, ...]] = (
    _hides_files,
    _hides_flagged_ops,
    _hides_required_file_input,
    _hides_refused_kinds,
)


def _file_names(entry: CatalogOp) -> set[str]:
    """Postcondition: the input names the entry binds as file uploads."""
    return {name for name, bind in entry["bind"].items() if bind == Bind.FILE}


def callable_ops(token: str | None) -> dict[str, CatalogOp]:
    """The catalog entries the bearer's token kind can call.

    Precondition: inside a Flask request. Postcondition: the shared entries of the op registry, which the caller
    must not change. A token with an unknown prefix, or no token, gets every entry that passes the other rules.
    """
    token_type = None if token is None else TokenType.for_token(token)
    return {
        op: registered.entry
        for op, registered in op_registry().items()
        if not any(rule(registered, token_type) for rule in _RULES)
    }


def _tool_for(entry: CatalogOp) -> str:
    """Postcondition: the name of the call tool for the entry's effect."""
    return CallTool.for_effect(Effect(entry["effect"])).value


def _singular(word: str) -> str:
    """Postcondition: ``word`` without a plural ending: a final "ies" becomes "y", else a final "s" is dropped
    unless the word ends in "ss"."""
    if word.endswith(_PLURAL_IES):
        return word.removesuffix(_PLURAL_IES) + _SINGULAR_Y
    if word.endswith(_DOUBLE_S):
        return word
    return word.removesuffix(_PLURAL_S)


def _words(text: str) -> frozenset[str]:
    """Postcondition: the distinct lowercase words of ``text``, split on anything that is not a letter or digit,
    each without its plural ending; never an empty word."""
    singulars = (_singular(word) for word in _WORD.findall(text.lower()))
    return frozenset(word for word in singulars if word)


def _words_match(one: str, other: str) -> bool:
    """Postcondition: True when the words are equal, or the shorter has at least ``MIN_PREFIX_LETTERS``
    letters and the longer begins with it."""
    if one == other:
        return True
    shorter, longer = sorted((one, other), key=len)
    if len(shorter) < MIN_PREFIX_LETTERS:
        return False
    return longer.startswith(shorter)


def _score(query_words: frozenset[str], op: str, entry: CatalogOp) -> int:
    """Postcondition: how many of ``query_words`` match a word of the op id or summary."""
    op_words = _words(f"{op} {entry['summary']}")
    return sum(any(_words_match(word, op_word) for op_word in op_words) for word in query_words)


def _ranked(query_words: frozenset[str], entries: Mapping[str, CatalogOp]) -> list[str]:
    """Postcondition: the op ids with a score above 0, highest score first, then by op id; with no query
    words, every op id by id."""
    if not query_words:
        return sorted(entries)
    scores = {op: _score(query_words, op, entry) for op, entry in entries.items()}
    return sorted((op for op, score in scores.items() if score), key=lambda op: (-scores[op], op))


def find_ops(query: str, *, token: str | None, offset: int = 0) -> dict[str, Any]:
    """The ops the token can call that best match the words of ``query``, one page at a time.

    Precondition: inside a Flask request; offset is 0 or more. Postcondition: ``{"total", "ops"}``, each op
    ``{"op", "summary", "effect", "tool"}`` where "tool" is the call tool for that effect. An op's score is how
    many distinct query words match a word of its id or summary (see ``_words`` and ``_words_match``); ops scoring
    0 are left out. Ops come highest score first, then by op id; a query with no words lists every op by id. The
    page holds at most ``OPENAPI_MCP_FIND_PAGE_SIZE`` matches from ``offset`` on; ``total`` counts every match, and
    ``next_offset`` is present only when more matches follow the page.
    """
    entries = callable_ops(token)
    matched = _ranked(_words(query), entries)
    end = offset + dify_config.OPENAPI_MCP_FIND_PAGE_SIZE
    ops = [
        {
            _OP_KEY: op,
            "summary": entries[op]["summary"],
            "effect": entries[op]["effect"],
            _TOOL_KEY: _tool_for(entries[op]),
        }
        for op in matched[offset:end]
    ]
    page: dict[str, Any] = {_TOTAL_KEY: len(matched), _OPS_KEY: ops}
    if end < len(matched):
        page[_NEXT_OFFSET_KEY] = end
    return page


def describe_op(op: str, *, token: str | None) -> dict[str, Any]:
    """One op's input schema and examples, without its file-bound fields.

    Precondition: inside a Flask request. Postcondition: returns
    ``{"op", "summary", "effect", "tool", "input", "examples"}``; raises ``UnknownOp``
    when the op is missing or hidden from this token. The input also holds the fields the op's kind adds
    (``_KIND_INPUTS``), and every example names every required input (``_with_placeholders``). The shared
    registry entry is not changed.
    """
    entry = callable_ops(token).get(op)
    if entry is None:
        raise UnknownOp(op)
    schema = copy.deepcopy(entry["input"])
    for name in _file_names(entry):
        schema[_PROPERTIES_KEY].pop(name, None)
    schema[_REQUIRED_KEY] = [name for name in schema[_REQUIRED_KEY] if name in schema[_PROPERTIES_KEY]]
    schema[_PROPERTIES_KEY].update(_KIND_INPUTS.get(entry["kind"], {}))
    return {
        _OP_KEY: op,
        "summary": entry["summary"],
        "effect": entry["effect"],
        _TOOL_KEY: _tool_for(entry),
        _INPUT_KEY: schema,
        _EXAMPLES_KEY: _with_placeholders(entry[_EXAMPLES_KEY], schema[_REQUIRED_KEY]),
    }


# The input fields an op of each kind takes besides its own: a stream op's job, which the call layer sends as headers.
_KIND_INPUTS: Final[Mapping[str, Mapping[str, Any]]] = {
    Kind.SSE.value: JobStartFields.model_json_schema()[_PROPERTIES_KEY],
}


def _with_placeholders(examples: list[dict[str, Any]], required: list[str]) -> list[dict[str, Any]]:
    """Postcondition: each example with every required input it leaves out (as ``workspace_id``, which difyctl fills
    in itself) set to a ``<name>`` placeholder, ahead of the inputs it names."""
    return [
        {
            **example,
            _INPUT_KEY: {
                **{name: _PLACEHOLDER.format(name=name) for name in required if name not in example[_INPUT_KEY]},
                **example[_INPUT_KEY],
            },
        }
        for example in examples
    ]


MCP_INSTRUCTIONS: Final = """This server runs operations of a Dify server. Four tools: dify_find, dify_read, dify_write, dify_destructive.

1. First call dify_read with op "get.workspace" and input {}. It confirms the login and lists the workspaces of this login, with their ids. The list may be empty: app operations still work. To find apps, call get.console_app: it needs no workspace and lists every app this login may use.
2. Operations on a workspace, such as plugins, model providers and tool credentials, take workspace_id. Nothing fills it in for you: pass an id from the workspace list in step 1, and do not guess one.
3. Before calling an operation, look it up: dify_find with a few words lists operations; dify_find with op "<id>" returns its input schema and examples. Operation ids can change between server versions, so do not guess them.
4. Call an operation with the tool that dify_find names for it. dify_destructive operations cannot be undone: confirm with the human first.
5. To run or test an app, call the operation dify_find shows for it, then call wait.job with the returned job id until the status is final. To stop a job, call stop.job. A status of "paused" means the run needs human input: follow the hints, or tell the human what the note says. Repeating an idempotency_key returns the same job, also when it failed (for example as interrupted or not confirmed): to run again, use a new key.
6. Every result may carry "hints": ready-made next calls. Prefer them over building a call yourself.
7. A file variable of an app takes a file mapping with a URL in "inputs": {"transfer_method": "remote_url", "url": "https://...", "type": "document"}.
8. An operation that dify_find does not list is not available to this login."""  # noqa: E501

FIND_DESCRIPTION: Final = (
    "Search Dify operations by a few words, or pass op to get one operation's input schema and examples. "
    "A search returns the best matches first, each with its op id, summary, effect (read, write or destructive) "
    "and the tool that runs it. Call this before running an operation; operation ids can change between server "
    "versions."
)
_CALL_DESCRIPTION: Final = (
    "Run a Dify operation whose effect is {effect}: {meaning}. op is an id from dify_find; input is that "
    "operation's input object, as dify_find shows it. Operations on a workspace take workspace_id in input: get "
    "the ids from op get.workspace. If the operation has another effect, the error names the tool to use."
)
_CALL_SCHEMA: Final = {
    "type": "object",
    "properties": {
        _OP_KEY: {"type": "string", "description": "An operation id from dify_find, such as get.workspace."},
        _INPUT_KEY: {
            "type": "object",
            "description": "The operation's input object, as dify_find with op shows it; {} when it takes none.",
        },
    },
    "required": [_OP_KEY, _INPUT_KEY],
    "additionalProperties": False,
}
_FIND_SCHEMA: Final = {
    "type": "object",
    "properties": {
        _QUERY_KEY: {
            "type": "string",
            "description": "A few words about what you want to do, such as import DSL; empty lists operations by id.",
        },
        _OP_KEY: {
            "type": "string",
            "description": "An operation id; when given, returns its input schema and examples instead of searching.",
        },
        _OFFSET_KEY: {
            "type": "integer",
            "minimum": 0,
            "description": "Where a search page starts; pass the next_offset of the previous page to read on.",
        },
    },
    "additionalProperties": False,
}


class Unauthenticated(Exception):  # noqa: N818
    """An operation answered 401: the whole MCP request must answer 401 with these headers."""

    def __init__(self, headers: Mapping[str, str]) -> None:
        """Postcondition: keeps a copy of the challenge ``headers`` to send with the 401."""
        super().__init__("unauthenticated")
        self.headers = dict(headers)

    @classmethod
    def from_result(cls, result: OpResult) -> Unauthenticated:
        """Postcondition: carries only the challenge headers of ``result`` that are present."""
        return cls({name: result.headers[name] for name in _PASSED_HEADERS if name in result.headers})


def tool_list() -> list[mcp_types.Tool]:
    """Postcondition: the four tools, fixed; needs no request, database or catalog."""
    find = mcp_types.Tool(
        name=FIND_TOOL,
        description=FIND_DESCRIPTION,
        inputSchema=_FIND_SCHEMA,
        annotations=mcp_types.ToolAnnotations(readOnlyHint=True),
    )
    calls = [
        mcp_types.Tool(
            name=tool.value,
            description=tool.description,
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
    """Postcondition: a tool error result holding ``message`` as its one text block."""
    return mcp_types.CallToolResult(isError=True, content=[mcp_types.TextContent(type=_TEXT_TYPE, text=message)])


def _supports_structured_output(protocol_version: str) -> bool:
    """MCP versions are YYYY-MM-DD strings, so lexical order is chronological (as in the app-level server)."""
    return protocol_version >= STRUCTURED_OUTPUT_MIN_VERSION


def _json_result(body: Any, *, protocol_version: str, is_error: bool = False) -> mcp_types.CallToolResult:
    """Postcondition: the body as compact JSON text with non-ASCII kept, with ``isError`` as ``is_error``.

    The operation has run, so a long body never becomes an error of its own: text above ``OPENAPI_MCP_RESULT_MAX_CHARS``
    is cut to that many characters and followed by a second block saying where it was cut, that the operation ran
    and how to narrow the request; a cut result has no ``structuredContent``. Otherwise ``structuredContent`` is
    set only for a non-error object body on a protocol that has it.
    """
    text = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
    if len(text) > dify_config.OPENAPI_MCP_RESULT_MAX_CHARS:
        return _cut_result(text, is_error=is_error)
    result = mcp_types.CallToolResult(content=[mcp_types.TextContent(type=_TEXT_TYPE, text=text)], isError=is_error)
    if is_error:
        return result
    if not isinstance(body, dict):
        return result
    if not _supports_structured_output(protocol_version):
        return result
    result.structuredContent = body
    return result


def _cut_result(text: str, *, is_error: bool) -> mcp_types.CallToolResult:
    """Postcondition: the first ``OPENAPI_MCP_RESULT_MAX_CHARS`` characters of ``text``, then a note naming the limit
    and the full length; ``isError`` as ``is_error``."""
    limit = dify_config.OPENAPI_MCP_RESULT_MAX_CHARS
    note = _CUT_NOTE.format(limit=limit, length=len(text))
    return mcp_types.CallToolResult(
        content=[
            mcp_types.TextContent(type=_TEXT_TYPE, text=text[:limit]),
            mcp_types.TextContent(type=_TEXT_TYPE, text=note),
        ],
        isError=is_error,
    )


def _unknown_op(op: str) -> mcp_types.CallToolResult:
    """Postcondition: a tool error saying ``op`` is not an operation this login can call, pointing at ``dify_find``."""
    return _error(f"No operation `{op}`. Use {FIND_TOOL} to search.")


def _string_argument(arguments: Mapping[str, Any], name: str) -> str | None:
    """Postcondition: the argument when it is a non-empty string, else None."""
    value = arguments.get(name)
    if not isinstance(value, str):
        return None
    return value or None


def _run_find(arguments: Mapping[str, Any], caller: McpCaller) -> mcp_types.CallToolResult:
    """Precondition: inside a Flask request.

    Postcondition: ``describe_op`` when ``op`` is a non-empty string, else a search page from ``offset``.

    An ``op`` that is null or empty counts as absent (models fill every schema field), as does a null ``offset``;
    any other non-string ``op``, a non-string ``query``, or an ``offset`` that is not a whole number of 0 or more
    is a tool error.
    """
    if arguments.get(_OP_KEY) not in _ABSENT_OP_VALUES:
        op = _string_argument(arguments, _OP_KEY)
        if op is None:
            return _error("`op` must be a string.")
        try:
            return _json_result(describe_op(op, token=caller.token), protocol_version=caller.protocol_version)
        except UnknownOp:
            return _unknown_op(op)
    query = arguments.get(_QUERY_KEY, "")
    if not isinstance(query, str):
        return _error("`query` must be a string.")
    offset = _offset_argument(arguments)
    if offset is None:
        return _error("`offset` must be a whole number, 0 or more.")
    return _json_result(find_ops(query, token=caller.token, offset=offset), protocol_version=caller.protocol_version)


def _offset_argument(arguments: Mapping[str, Any]) -> int | None:
    """Postcondition: the ``offset`` argument when it is a whole number of 0 or more, 0 when it is absent or null,
    else None."""
    value = arguments.get(_OFFSET_KEY)
    if value is None:
        return 0
    if isinstance(value, bool):
        return None
    if not isinstance(value, int):
        return None
    if value < 0:
        return None
    return value


_REFUSAL_MESSAGES: Final[Mapping[type[Exception], Callable[[Exception], str]]] = {
    UnsafePathValue: lambda exc: f"Nothing ran: the input is not usable ({exc}).",
    UnsafeHeaderValue: lambda exc: f"Nothing ran: the input is not usable ({exc}).",
    RouteMismatch: lambda exc: "Nothing ran: the input does not address this operation.",
    FileInputUnsupported: lambda exc: (
        "Nothing ran: this operation takes a file upload, which a tool call cannot carry."
    ),
}


def _is_callable_hint(hint: Any, allowed: Mapping[str, CatalogOp]) -> bool:
    """Postcondition: True when ``hint`` is an object whose ``op`` is one of the ``allowed`` ops."""
    if not isinstance(hint, dict):
        return False
    return hint.get(_OP_KEY) in allowed


def _without_uncallable_hints(body: Any, allowed: Mapping[str, CatalogOp]) -> Any:
    """Postcondition: for an object body with a ``hints`` list, the same body with only the hints whose op is
    in ``allowed``, in order; any other body is returned as it is."""
    if not isinstance(body, dict):
        return body
    hints = body.get(_HINTS_KEY)
    if not isinstance(hints, list):
        return body
    return {**body, _HINTS_KEY: [hint for hint in hints if _is_callable_hint(hint, allowed)]}


def _retry_after_note(result: OpResult) -> mcp_types.TextContent | None:
    """Postcondition: for a 429 whose ``Retry-After`` is a non-negative whole number of seconds, the text
    block naming the wait; None otherwise (an HTTP-date or any other value adds nothing)."""
    if result.status != HTTPStatus.TOO_MANY_REQUESTS:
        return None
    value = result.headers.get(_RETRY_AFTER_HEADER)
    if value is None:
        return None
    if not value.isascii():
        return None
    if not value.isdigit():
        return None
    return mcp_types.TextContent(type=_TEXT_TYPE, text=_RETRY_AFTER_MESSAGE.format(seconds=int(value)))


def _map_result(
    result: OpResult, *, allowed: Mapping[str, CatalogOp], protocol_version: str
) -> mcp_types.CallToolResult:
    """Postcondition: the op's response as a tool result; raises ``Unauthenticated`` on 401."""
    if result.status == HTTPStatus.UNAUTHORIZED:
        raise Unauthenticated.from_result(result)
    if result.status >= HTTPStatus.BAD_REQUEST:
        if result.is_json:
            body = _without_uncallable_hints(result.body, allowed)
            error = _json_result(body, protocol_version=protocol_version, is_error=True)
            note = _retry_after_note(result)
            if note is not None:
                error.content.append(note)
            return error
        return _error(f"The operation answered {result.status} without a JSON body.")
    if not result.is_json:
        return _error("The operation returned a non-JSON response, which a tool call cannot carry.")
    body = _without_uncallable_hints(result.body, allowed)
    return _json_result(body, protocol_version=protocol_version)


def _run_call(tool: CallTool, arguments: Mapping[str, Any], caller: McpCaller) -> mcp_types.CallToolResult:
    """Precondition: inside a Flask request.

    Postcondition: the op ran, or a tool error says why it did not.
    """
    op = _string_argument(arguments, _OP_KEY)
    if op is None:
        return _error("`op` must be a non-empty string.")
    op_input = arguments.get(_INPUT_KEY)
    if not isinstance(op_input, dict):
        return _error("`input` must be a JSON object.")
    allowed = callable_ops(caller.token)
    entry = allowed.get(op)
    if entry is None:
        return _unknown_op(op)
    effect = Effect(entry["effect"])
    if effect != tool.effect:
        return _error(f"`{op}` is a {effect.value} operation. Call it with {CallTool.for_effect(effect).value}.")
    try:
        result = call_op(OpCall(op=op, input=op_input, authorization=caller.authorization, trace_id=caller.trace_id))
    except tuple(_REFUSAL_MESSAGES) as refusal:
        return _error(_REFUSAL_MESSAGES[type(refusal)](refusal))
    return _map_result(result, allowed=allowed, protocol_version=caller.protocol_version)


def run_tool(name: str, arguments: Mapping[str, Any], caller: McpCaller) -> mcp_types.CallToolResult:
    """Run one tool call.

    Precondition: inside a Flask request; ``name`` is one of the four tool names (the route
    answers any other name with INVALID_PARAMS).
    Postcondition: a result for the call, with ``isError`` set for every failure except a 401
    from the op, which raises ``Unauthenticated``.
    """
    if name == FIND_TOOL:
        return _run_find(arguments, caller)
    return _run_call(CallTool(name), arguments, caller)
