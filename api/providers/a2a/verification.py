"""Bounded verification diagnostics derived only from typed, safe protocol facts.

Peer values, arbitrary dictionary keys and validator messages never become
Console diagnostics. Unknown evidence keeps the established reason fallback.
"""

import re

from pydantic import ValidationError

from services.external_agents.contracts import AgentCardFieldError, AgentCardFieldErrorCode

from .types import AgentCardV1, AgentInterfaceV1, CapabilitiesV1, ExtensionV1, ProviderV1, SkillV1

_TOKEN = r"[!#$%&'*+.^_`|~0-9A-Za-z-]+"
_QUOTED = r'"(?:[\x20\x21\x23-\x5b\x5d-\x7e]|\\[\x20-\x7e])*"'
_AUTH_PARAM = re.compile(rf"\s*({_TOKEN})\s*=\s*({_TOKEN}|{_QUOTED})\s*(?:,|$)", re.ASCII)
_SAFE_PATHS = frozenset(
    {(field,) for field in AgentCardV1.model_fields}
    | {("supportedInterfaces", field) for field in AgentInterfaceV1.model_fields}
    | {("capabilities", field) for field in CapabilitiesV1.model_fields}
    | {("capabilities", "extensions", field) for field in ExtensionV1.model_fields}
    | {("skills", field) for field in SkillV1.model_fields}
    | {("provider", field) for field in ProviderV1.model_fields}
)


def invalid_bearer_challenge(value: str) -> bool:
    """Recognize one strict RFC Bearer invalid_token challenge, without message guessing.

    Pre: value is the combined WWW-Authenticate header. Post: only a single
    unambiguous Bearer challenge with one error=invalid_token returns true;
    malformed, duplicate or multiple challenges return false. No value escapes.
    """
    if len(value) > 8192:
        return False
    prefix = re.match(r"Bearer[ \t]+", value, re.IGNORECASE | re.ASCII)
    if prefix is None:
        return False
    position = prefix.end()
    params: dict[str, str] = {}
    valid = position < len(value)
    while valid and position < len(value):
        match = _AUTH_PARAM.match(value, position)
        if match is None:
            valid = False
        else:
            name, parameter = match.group(1).lower(), match.group(2)
            if name in params:
                valid = False
            else:
                params[name] = parameter
            position = match.end()
    return valid and not value.rstrip().endswith(",") and params.get("error") in {"invalid_token", '"invalid_token"'}


def card_field_errors(error: ValidationError) -> tuple[AgentCardFieldError, ...]:
    """Project at most ten schema-owned camelCase paths and safe validation codes.

    Pre: the error came from AgentCardV1. Post: no input, validator message,
    context, URL or peer-chosen dictionary key appears; unsupported paths vanish.
    The remaining diagnostics are advisory and never relax Card validation.
    """
    diagnostics: list[AgentCardFieldError] = []
    for item in error.errors(include_input=False, include_context=False, include_url=False):
        location = item["loc"]
        names = tuple(segment for segment in location if isinstance(segment, str))
        safe = (
            item["type"] != "extra_forbidden"
            and names in _SAFE_PATHS
            and all(isinstance(segment, str) or 0 <= segment <= 9999 for segment in location)
        )
        if safe and len(diagnostics) < 10:
            path = "".join(
                f"[{segment}]" if isinstance(segment, int) else f".{segment}" if index else segment
                for index, segment in enumerate(location)
            )
            if len(path) <= 128:
                diagnostic = AgentCardFieldError(
                    path=path,
                    code=AgentCardFieldErrorCode.MISSING
                    if item["type"] == "missing"
                    else AgentCardFieldErrorCode.INVALID,
                )
                if diagnostic not in diagnostics:
                    diagnostics.append(diagnostic)
    return tuple(diagnostics)
