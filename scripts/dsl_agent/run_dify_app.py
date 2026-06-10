#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def parse_json_value(value: str | None, file_path: Path | None) -> dict[str, Any]:
    if file_path:
        raw = file_path.read_text()
    else:
        raw = value or "{}"
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("JSON value must be an object.")
    return parsed


def post_json(url: str, api_key: str, payload: dict[str, Any]) -> tuple[int, dict[str, Any] | str]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            text = response.read().decode("utf-8")
            return response.status, json.loads(text) if text else {}
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(text)
        except json.JSONDecodeError:
            return exc.code, text


def run(args: argparse.Namespace) -> int:
    api_base = args.api_base.rstrip("/")
    inputs = parse_json_value(args.inputs, args.inputs_file)
    user = args.user

    if args.mode == "workflow":
        url = f"{api_base}/workflows/run"
        payload: dict[str, Any] = {
            "inputs": inputs,
            "response_mode": args.response_mode,
            "user": user,
        }
    elif args.mode == "advanced-chat":
        url = f"{api_base}/chat-messages"
        payload = {
            "inputs": inputs,
            "query": args.query or "",
            "response_mode": args.response_mode,
            "user": user,
        }
    else:
        raise ValueError(f"Unsupported mode: {args.mode}")

    status, result = post_json(url, args.api_key, payload)
    output = {
        "status": status,
        "url": url,
        "payload": payload if not args.hide_payload else "<hidden>",
        "result": result,
    }
    rendered = json.dumps(output, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(rendered + "\n")
    print(rendered)
    return 0 if 200 <= status < 300 else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a manually imported Dify app through its public API.")
    parser.add_argument("--mode", choices=["workflow", "advanced-chat"], required=True)
    parser.add_argument("--api-base", required=True, help="Dify API base, e.g. https://example.com/v1")
    parser.add_argument("--api-key", required=True, help="Dify app API key.")
    parser.add_argument("--inputs", help="JSON object string for Dify inputs.")
    parser.add_argument("--inputs-file", type=Path, help="Path to JSON object for Dify inputs.")
    parser.add_argument("--query", help="Chat query for advanced-chat mode.")
    parser.add_argument("--response-mode", choices=["blocking", "streaming"], default="blocking")
    parser.add_argument("--user", default="dsl-agent-debugger")
    parser.add_argument("--output", type=Path, help="Optional file to write run result JSON.")
    parser.add_argument("--hide-payload", action="store_true")
    return parser.parse_args()


def main() -> int:
    try:
        return run(parse_args())
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
