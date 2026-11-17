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
from controllers.openapi._mcp_call import UnknownOp
from controllers.openapi.auth.requirements import CheckScope, CheckSubject
from controllers.openapi.auth.spec import Effect, EndpointSpec, Kind, spec_of

FIND_LIMIT: Final = 20
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
