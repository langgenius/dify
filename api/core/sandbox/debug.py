"""Sandbox debug utilities. TODO: Remove this module when sandbox debugging is complete."""

from typing import Any

from core.callback_handler.agent_tool_callback_handler import print_text

SANDBOX_DEBUG_ENABLED = True


def sandbox_debug(tag: str, message: str, data: Any = None) -> None:
    if not SANDBOX_DEBUG_ENABLED:
        return

    print_text(f"\n[{tag}]\n", color="blue")
    if data is not None:
        print_text(f"{message}: {data}\n", color="blue")
    else:
        print_text(f"{message}\n", color="blue")
