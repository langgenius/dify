"""Do not replay previously authorized raw evidence into a new run or resume.

Conversation answers remain historical conversation. Original tool evidence and
image bytes are removed from model input; fresh CLI reads recheck authorization.
Tool-call/result pairing is preserved, including deferred-tool continuations.
"""

from collections.abc import Sequence
from dataclasses import replace
from typing import cast

from pydantic_ai.messages import (
    BinaryContent,
    ModelMessage,
    ModelRequest,
    ModelRequestPart,
    ToolReturnPart,
    UserPromptPart,
)

IMAGE_MARKER = "KnowledgeFS evidence image (untrusted document content; re-open after this turn):"
HISTORICAL_EVIDENCE = (
    "Historical KnowledgeFS evidence omitted. Search/open again to check current access and document version."
)


def without_historical_knowledge_evidence(messages: Sequence[ModelMessage]) -> list[ModelMessage]:
    result: list[ModelMessage] = []
    for message in messages:
        if not isinstance(message, ModelRequest):
            result.append(message)
            continue
        parts: list[ModelRequestPart] = []
        for part in message.parts:
            if (
                type(part) is ToolReturnPart
                and isinstance(part.metadata, dict)
                and "knowledge_fs_citations" in part.metadata
            ):
                parts.append(replace(cast(ToolReturnPart, part), content=HISTORICAL_EVIDENCE))
            elif isinstance(part, UserPromptPart) and not isinstance(part.content, str):
                content = [
                    item
                    for item in part.content
                    if not (
                        (isinstance(item, str) and item == IMAGE_MARKER)
                        or (
                            isinstance(item, BinaryContent)
                            and (item.vendor_metadata or {}).get("dify_knowledge_fs_evidence") is True
                        )
                    )
                ]
                parts.append(replace(part, content=content or HISTORICAL_EVIDENCE))
            else:
                parts.append(part)
        result.append(replace(message, parts=parts))
    return result
