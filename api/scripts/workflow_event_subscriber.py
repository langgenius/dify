#!/usr/bin/env python3
"""Subscribe to workflow run events from the Redis broadcast channel."""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from collections.abc import Mapping

from app_factory import create_flask_app_with_configs
from core.app.apps.message_generator import MessageGenerator
from extensions import ext_redis
from models.model import AppMode


def _parse_app_mode(value: str) -> AppMode:
    try:
        return AppMode.value_of(value)
    except ValueError as exc:  # pragma: no cover - argparse rewrites the message
        raise argparse.ArgumentTypeError(str(exc)) from exc


def _parse_workflow_run_id(value: str) -> str:
    try:
        workflow_uuid = uuid.UUID(value)
    except ValueError as exc:  # pragma: no cover - argparse rewrites the message
        raise argparse.ArgumentTypeError("workflow run id must be a valid UUID") from exc
    return str(workflow_uuid)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Subscribe to Redis broadcast channel events for a workflow run and print them."
    )
    parser.add_argument(
        "--workflow-run-id",
        required=True,
        type=_parse_workflow_run_id,
        help="Workflow run identifier whose stream output should be tailed.",
    )
    parser.add_argument(
        "--app-mode",
        required=True,
        type=_parse_app_mode,
        choices=list(AppMode),
        help="App mode the workflow ran under (determines the broadcast channel name).",
    )
    parser.add_argument(
        "--idle-timeout",
        type=float,
        default=300.0,
        help="Stop listening after this many seconds without events (default: 300).",
    )
    return parser


def _initialize_redis() -> None:
    # A lightweight Flask app is enough to reuse the existing Redis initialization code path.
    app = create_flask_app_with_configs()
    ext_redis.init_app(app)


def _print_event(event: Mapping | str) -> None:
    if isinstance(event, Mapping):
        payload = json.dumps(event, ensure_ascii=False)
    else:
        payload = event
    print(payload)
    sys.stdout.flush()


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    _initialize_redis()

    events = MessageGenerator.retrieve_events(args.app_mode, args.workflow_run_id, idle_timeout=args.idle_timeout)
    try:
        for event in events:
            _print_event(event)
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
