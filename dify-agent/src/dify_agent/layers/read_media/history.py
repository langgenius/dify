"""Collapse read_media attachments without altering tool-call/result pairing.

History loading copies messages before folding every attachment. In-run window
eviction and provider fallback mutate shared UserPromptPart instances so later
requests, compaction and saved history all observe the same text replacement.
"""

from collections.abc import Sequence
from dataclasses import replace
import json
from typing import TypeGuard

from pydantic_ai.messages import (
    AudioUrl,
    DocumentUrl,
    ImageUrl,
    ModelMessage,
    ModelRequest,
    UserContent,
    UserPromptPart,
    VideoUrl,
)

type MediaUrl = ImageUrl | AudioUrl | VideoUrl | DocumentUrl

_ATTACHMENT_PREFIX = "Attached "
_ATTACHMENT_SOURCE = " media from read_media ("


def attachment_marker(modality: str, description: str) -> str:
    """Label one attached file so folding can remove its paired text marker."""
    return f"{_ATTACHMENT_PREFIX}{modality}{_ATTACHMENT_SOURCE}{description}):"


def is_attachment_marker(item: object) -> bool:
    """Recognize markers emitted by read_media, including saved run history."""
    return isinstance(item, str) and item.startswith(_ATTACHMENT_PREFIX) and _ATTACHMENT_SOURCE in item


def is_read_media_content(item: object) -> TypeGuard[MediaUrl]:
    return (
        isinstance(item, ImageUrl | AudioUrl | VideoUrl | DocumentUrl)
        and (item.vendor_metadata or {}).get("dify_read_media") is True
    )


def collapse_read_media_content(
    messages: Sequence[ModelMessage], *, keep: int = 0, rejection_reason: str | None = None
) -> int:
    """Replace all but the latest keep marked attachments in shared prompt parts.

    Requires keep >= 0. Unmarked content and tool topology remain intact;
    returns the number replaced. No file access or permission lookup occurs.
    """
    if keep < 0:
        raise ValueError("keep must be nonnegative")
    prompts = [
        part
        for message in messages
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, UserPromptPart) and not isinstance(part.content, str)
    ]
    remaining = sum(sum(is_read_media_content(item) for item in part.content) for part in prompts) - keep
    replaced = 0
    for part in prompts:
        content: list[UserContent] = []
        for item in part.content:
            if remaining > 0 and is_read_media_content(item):
                # Remove only the marker paired with this file; other user text
                # (including Pydantic AI's file delimiters) retains its order.
                if content and is_attachment_marker(content[-1]):
                    content.pop()
                content.append(_placeholder(item, rejection_reason))
                remaining -= 1
                replaced += 1
            else:
                content.append(item)
        part.content = content
    return replaced


def _placeholder(item: MediaUrl, rejection_reason: str | None) -> str:
    meta = item.vendor_metadata or {}
    filename = meta.get("filename", "media")
    mime_type = meta.get("mime_type", "unknown MIME")
    locator = json.dumps(meta.get("locator", {}), ensure_ascii=False, separators=(",", ":"))
    if rejection_reason is not None:
        return (
            f"[read_media fallback: the model provider rejected multimodal {meta.get('modality', 'media')} "
            f"content ({filename}, {mime_type}, locator={locator}): {rejection_reason}. "
            "Proceed without direct media inspection or use workspace tools if available.]"
        )
    return (
        f"[Historical read_media content omitted ({filename}, {mime_type}, locator={locator}). "
        "Call read_media again if you need to re-inspect this file.]"
    )


def without_historical_read_media_content(messages: Sequence[ModelMessage]) -> list[ModelMessage]:
    """Return a folded copy, even if the new run no longer enables read_media.

    Leaves the source history untouched and retains locator text for a fresh,
    explicitly authorized read under the current model and file permissions.
    """
    result = [
        replace(message, parts=[replace(part) if isinstance(part, UserPromptPart) else part for part in message.parts])
        if isinstance(message, ModelRequest)
        else message
        for message in messages
    ]
    collapse_read_media_content(result)
    return result
