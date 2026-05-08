import json
from collections.abc import Sequence
from typing import Any

from core.agent.errors import AgentRepeatedToolCallError

REPEATED_TOOL_CALL_LIMIT = 3

ToolCallSignature = tuple[str, str]


def get_tool_call_signature(tool_name: str, tool_args: dict[str, Any] | str) -> ToolCallSignature:
    return (tool_name, _normalize_tool_args(tool_args))


def ensure_not_repeated_tool_call(
    tool_call_signatures: Sequence[ToolCallSignature], repeat_limit: int = REPEATED_TOOL_CALL_LIMIT
) -> None:
    if len(tool_call_signatures) < repeat_limit:
        return

    recent_signatures = tool_call_signatures[-repeat_limit:]
    if all(signature == recent_signatures[0] for signature in recent_signatures):
        raise AgentRepeatedToolCallError(tool_name=recent_signatures[0][0], repeat_count=repeat_limit)


def _normalize_tool_args(tool_args: dict[str, Any] | str) -> str:
    if isinstance(tool_args, str):
        try:
            tool_args = json.loads(tool_args)
        except json.JSONDecodeError:
            return tool_args

    try:
        return json.dumps(tool_args, ensure_ascii=False, sort_keys=True)
    except TypeError:
        return str(tool_args)
