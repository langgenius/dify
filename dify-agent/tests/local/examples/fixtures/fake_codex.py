#!/usr/bin/env python3
"""Small subprocess fixture that emits the Codex CLI's real JSONL envelope."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


THREAD_ID = "019fd670-b2b8-78d3-bfde-c871345d9981"


def emit(payload: dict[str, object]) -> None:
    print(json.dumps(payload), flush=True)


def main() -> None:
    prompt = sys.stdin.read()
    log_path = os.getenv("FAKE_CODEX_LOG")
    if log_path:
        with Path(log_path).open("a", encoding="utf-8") as log_file:
            log_file.write(
                json.dumps(
                    {
                        "argv": sys.argv[1:],
                        "cwd": os.getcwd(),
                        "prompt": prompt,
                        "bridge_token_present": "DIFY_BYOA_CODEX_API_TOKEN" in os.environ,
                    }
                )
                + "\n"
            )

    is_resume = "resume" in sys.argv[1:]
    emit({"type": "thread.started", "thread_id": THREAD_ID})
    emit({"type": "turn.started"})
    if prompt == "WAIT":
        time.sleep(60)
        return
    if prompt == "SUBSCRIBE":
        time.sleep(0.2)
    if prompt == "FAIL":
        emit({"type": "error", "message": "SHOULD_NOT_LEAK"})
        emit({"type": "turn.failed", "error": {"message": "SHOULD_NOT_LEAK"}})
        raise SystemExit(1)
    if prompt == "COMMAND":
        emit(
            {
                "type": "item.completed",
                "item": {
                    "id": "command-item",
                    "type": "command_execution",
                    "command": "printenv SECRET",
                    "aggregated_output": "SHOULD_NOT_LEAK",
                },
            }
        )
    if prompt == "LONG":
        # Below the bridge's 4 MiB JSONL reader limit, but above Dify's 1 MiB
        # per-SSE-event limit after JSON escaping.
        response = '"\n😀\\' * 140_000
    else:
        response = f"RESUMED:{prompt}" if is_resume else f"CODEX:{prompt}"
    emit({"type": "item.completed", "item": {"id": "agent-item", "type": "agent_message", "text": response}})
    emit(
        {
            "type": "turn.completed",
            "usage": {
                "input_tokens": 12,
                "cached_input_tokens": 3,
                "output_tokens": 4,
                "reasoning_output_tokens": 2,
            },
        }
    )


if __name__ == "__main__":
    main()
