"""Command-line entry point for the local Codex A2A bridge."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import uvicorn
from pydantic import SecretStr

from .app import create_app
from .settings import ALLOWED_REASONING_EFFORTS, ALLOWED_SANDBOX_MODES, CodexBridgeSettings


def main() -> None:
    parser = _parser()
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    try:
        api_token = _api_token_from_env()
        # Keep bridge-only credential metadata out of every child process
        # spawned after startup, including Codex and any command it runs.
        os.environ.pop("DIFY_BYOA_CODEX_API_TOKEN", None)
        os.environ.pop("DIFY_BYOA_CODEX_API_TOKEN_FD", None)
        settings = CodexBridgeSettings(
            workspace_root=Path(args.workspace_root),
            bind_host=args.host,
            public_url=args.public_url,
            allow_insecure_public_url=args.allow_insecure_public_url,
            streaming_enabled=args.streaming,
            codex_executable=args.codex_bin,
            model=args.model or None,
            reasoning_effort=args.reasoning_effort or None,
            sandbox_mode=args.sandbox,
            ignore_user_config=args.ignore_user_config,
            max_concurrent_tasks=args.max_concurrent_tasks,
            cancel_grace_seconds=args.cancel_grace_seconds,
            api_token=api_token,
        )
    except ValueError as exc:
        parser.error(str(exc))
    uvicorn.run(create_app(settings), host=settings.bind_host, port=args.port)


def _parser() -> argparse.ArgumentParser:
    workspace_root = os.getenv("DIFY_BYOA_CODEX_WORKSPACE_ROOT")
    parser = argparse.ArgumentParser(
        prog="codex-a2a-bridge",
        description="Expose one local Codex CLI workspace through A2A 1.0 HTTP+JSON.",
    )
    parser.add_argument(
        "--workspace-root",
        default=workspace_root,
        required=workspace_root is None,
        help="Fixed workspace available to every Codex turn (env: DIFY_BYOA_CODEX_WORKSPACE_ROOT)",
    )
    parser.add_argument("--host", default=os.getenv("DIFY_BYOA_CODEX_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("DIFY_BYOA_CODEX_PORT", "8765")))
    parser.add_argument(
        "--public-url",
        default=os.getenv("DIFY_BYOA_CODEX_PUBLIC_URL", "http://127.0.0.1:8765"),
    )
    parser.add_argument(
        "--allow-insecure-public-url",
        action="store_true",
        default=_env_bool("DIFY_BYOA_CODEX_ALLOW_INSECURE_PUBLIC_URL", False),
        help="Allow a non-loopback HTTP public URL on an explicitly trusted development network",
    )
    parser.add_argument(
        "--streaming",
        action=argparse.BooleanOptionalAction,
        default=_env_bool("DIFY_BYOA_CODEX_STREAMING", True),
        help="Advertise A2A streaming support (env: DIFY_BYOA_CODEX_STREAMING)",
    )
    parser.add_argument("--codex-bin", default=os.getenv("DIFY_BYOA_CODEX_BIN", "codex"))
    parser.add_argument("--model", default=os.getenv("DIFY_BYOA_CODEX_MODEL", "gpt-5.5"))
    parser.add_argument(
        "--reasoning-effort",
        choices=sorted(ALLOWED_REASONING_EFFORTS),
        default=os.getenv("DIFY_BYOA_CODEX_REASONING_EFFORT", "xhigh"),
    )
    parser.add_argument(
        "--sandbox",
        choices=sorted(ALLOWED_SANDBOX_MODES),
        default=os.getenv("DIFY_BYOA_CODEX_SANDBOX", "workspace-write"),
    )
    parser.add_argument(
        "--ignore-user-config",
        action="store_true",
        default=_env_bool("DIFY_BYOA_CODEX_IGNORE_USER_CONFIG", False),
    )
    parser.add_argument(
        "--max-concurrent-tasks",
        type=int,
        default=int(os.getenv("DIFY_BYOA_CODEX_MAX_CONCURRENT_TASKS", "1")),
    )
    parser.add_argument(
        "--cancel-grace-seconds",
        type=float,
        default=float(os.getenv("DIFY_BYOA_CODEX_CANCEL_GRACE_SECONDS", "2")),
    )
    return parser


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean value")


def _api_token_from_env() -> SecretStr | None:
    value = os.getenv("DIFY_BYOA_CODEX_API_TOKEN")
    if value:
        return SecretStr(value)

    token_fd_value = os.getenv("DIFY_BYOA_CODEX_API_TOKEN_FD")
    if token_fd_value is None:
        return None
    try:
        token_fd = int(token_fd_value)
    except ValueError as exc:
        raise ValueError("DIFY_BYOA_CODEX_API_TOKEN_FD must be an integer file descriptor") from exc
    if token_fd < 3:
        raise ValueError("DIFY_BYOA_CODEX_API_TOKEN_FD must not reuse stdin, stdout, or stderr")
    try:
        with os.fdopen(token_fd, encoding="utf-8", closefd=True) as token_stream:
            value = token_stream.read().strip()
    except OSError as exc:
        raise ValueError("Could not read DIFY_BYOA_CODEX_API_TOKEN_FD") from exc
    if not value:
        raise ValueError("DIFY_BYOA_CODEX_API_TOKEN_FD must contain a non-empty token")
    return SecretStr(value)


if __name__ == "__main__":
    main()
