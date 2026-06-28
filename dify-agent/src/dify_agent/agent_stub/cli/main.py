"""Typer entry point for the client-safe ``dify-agent`` console script.

The CLI supports explicit ``connect``, ``file``, and ``drive`` commands and
treats unknown bare commands as Agent Stub forwards. When the injected Agent
Stub environment variables are missing, that path intentionally surfaces a
clear missing-env error instead of Typer's generic unknown-command message. The
module depends only on client-safe code so importing the console entry point
does not pull in FastAPI, Redis, shellctl, or JWE runtime dependencies.
"""

from __future__ import annotations

import sys
from typing import cast

import typer
from typer.main import get_command

from dify_agent.agent_stub.cli._agent_stub import connect_from_environment
from dify_agent.agent_stub.cli._drive import (
    DrivePushKind,
    format_drive_manifest,
    list_drive_manifest_from_environment,
    pull_drive_from_environment,
    push_drive_from_environment,
)
from dify_agent.agent_stub.cli._env import (
    MissingAgentStubEnvironmentError,
    has_agent_stub_environment,
    read_agent_stub_drive_base,
)
from dify_agent.agent_stub.cli._files import download_file_from_environment, upload_file_from_environment
from dify_agent.agent_stub.client._errors import AgentStubClientError
from dify_agent.agent_stub.protocol.agent_stub import AGENT_STUB_DRIVE_BASE_ENV_VAR, DEFAULT_AGENT_STUB_DRIVE_BASE


app = typer.Typer(
    add_completion=False,
    help="Forward shell-visible dify-agent commands to the Dify Agent Stub server.",
    no_args_is_help=True,
)
file_app = typer.Typer(help="Upload or download workflow files through the Agent Stub.")
drive_app = typer.Typer(help="List, pull, or push agent drive files through the Agent Stub.")
app.add_typer(file_app, name="file")
app.add_typer(drive_app, name="drive")
_KNOWN_ROOT_COMMANDS = frozenset({"connect", "drive", "file"})


@app.command(context_settings={"allow_extra_args": True, "ignore_unknown_options": True})
def connect(
    json_output: bool = typer.Option(False, "--json", help="Emit the connection response as JSON."),
    argv: list[str] = typer.Argument(default_factory=list, metavar="ARGV"),
) -> None:
    """Establish one Agent Stub connection using the current environment."""
    _run_connect(argv=list(argv), json_output=json_output)


@file_app.command("upload")
def upload(path: str = typer.Argument(..., metavar="PATH")) -> None:
    """Upload one sandbox-local file as a ToolFile output reference."""
    _run_file_upload(path=path)


@file_app.command("download")
def download(
    transfer_method: str | None = typer.Argument(None, metavar="TRANSFER_METHOD"),
    reference_or_url: str | None = typer.Argument(None, metavar="REFERENCE_OR_URL"),
    mapping: str | None = typer.Option(None, "--mapping", help="Download one file from a mapping JSON object."),
    local_dir: str | None = typer.Option(None, "--to", help="Local directory for the downloaded file."),
) -> None:
    """Download one workflow file mapping into the local sandbox directory."""
    _run_file_download(
        transfer_method=transfer_method,
        reference_or_url=reference_or_url,
        mapping=mapping,
        local_dir=local_dir,
    )


@drive_app.command("list")
def drive_list(
    path_prefix: str = typer.Argument("", metavar="REMOTE_PREFIX"),
    json_output: bool = typer.Option(False, "--json", help="Emit the drive manifest as JSON."),
) -> None:
    """List drive files visible to the current sandbox execution."""
    _run_drive_list(path_prefix=path_prefix, json_output=json_output)


@drive_app.command("pull")
def drive_pull(
    targets: list[str] = typer.Argument(None, metavar="REMOTE"),
    local_base: str | None = typer.Option(
        None,
        "--to",
        help=(
            f"Local base directory for pulled drive files. Defaults to ${AGENT_STUB_DRIVE_BASE_ENV_VAR} "
            f"or {DEFAULT_AGENT_STUB_DRIVE_BASE}."
        ),
    ),
    json_output: bool = typer.Option(False, "--json", help="Emit the pull result as JSON."),
) -> None:
    """Pull one or more drive keys/prefixes into one local directory tree.

    Passing no ``TARGET`` preserves the historical whole-drive behavior by
    pulling from the empty prefix.
    """
    _run_drive_pull(targets=targets or None, local_base=local_base, json_output=json_output)


@drive_app.command("push")
def drive_push(
    local_path: str = typer.Argument(..., metavar="LOCAL_PATH"),
    drive_path: str = typer.Argument(..., metavar="REMOTE_PATH"),
    kind: str | None = typer.Option(None, "--kind", help="Directory upload kind: skill or dir."),
    json_output: bool = typer.Option(
        False,
        "--json",
        help="Accepted for consistency; drive push output is already emitted as JSON.",
    ),
) -> None:
    """Upload one local file or directory into the agent drive."""
    del json_output
    _run_drive_push(local_path=local_path, drive_path=drive_path, kind=kind)


def main(argv: list[str] | None = None) -> None:
    """Run the ``dify-agent`` CLI with optional argv injection for tests."""
    args = list(sys.argv[1:] if argv is None else argv)
    if args[:1] == ["connect"] and not _is_help_request(args[1:]):
        json_output, forwarded_args = _parse_connect_args(args[1:])
        _run_connect(argv=forwarded_args, json_output=json_output)
        return
    json_output, forwarded_args = _extract_root_json_flag(args)
    if _is_unknown_bare_command(forwarded_args):
        if not has_agent_stub_environment():
            _show_root_help()
        _run_connect(argv=forwarded_args, json_output=json_output)
        return
    app(prog_name="dify-agent", args=args)


def _extract_root_json_flag(argv: list[str]) -> tuple[bool, list[str]]:
    if len(argv) >= 2 and argv[0] == "--json" and argv[1] not in _KNOWN_ROOT_COMMANDS:
        return True, argv[1:]
    return False, argv


def _is_unknown_bare_command(argv: list[str]) -> bool:
    if not argv:
        return False
    first = argv[0]
    return first not in _KNOWN_ROOT_COMMANDS and not first.startswith("-")


def _parse_connect_args(argv: list[str]) -> tuple[bool, list[str]]:
    json_output = False
    remaining = list(argv)
    if remaining[:1] == ["--json"]:
        json_output = True
        remaining = remaining[1:]
    if remaining[:1] == ["--"]:
        remaining = remaining[1:]
    return json_output, remaining


def _is_help_request(argv: list[str]) -> bool:
    return any(value in {"--help", "-h"} for value in argv)


def _show_root_help() -> None:
    """Render root CLI guidance before reporting unknown-command env errors."""
    command = get_command(app)
    context = command.make_context("dify-agent", [], resilient_parsing=True)
    typer.echo(command.get_help(context))


def _run_connect(*, argv: list[str], json_output: bool) -> None:
    try:
        response = connect_from_environment(argv=argv)
    except MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc

    if json_output:
        typer.echo(response.model_dump_json())
        return
    typer.echo(f"connected {response.connection_id}")


def _run_file_upload(*, path: str) -> None:
    try:
        response = upload_file_from_environment(path=path)
    except MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    typer.echo(response.model_dump_json())


def _run_file_download(
    *,
    transfer_method: str | None,
    reference_or_url: str | None,
    mapping: str | None,
    local_dir: str | None,
) -> None:
    try:
        response = download_file_from_environment(
            transfer_method=transfer_method,
            reference_or_url=reference_or_url,
            mapping=mapping,
            local_dir=local_dir,
        )
    except MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    typer.echo(str(response.path))


def _run_drive_list(*, path_prefix: str, json_output: bool) -> None:
    try:
        response = list_drive_manifest_from_environment(prefix=path_prefix)
    except MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    if json_output:
        typer.echo(response.model_dump_json())
        return
    typer.echo(format_drive_manifest(response))


def _run_drive_pull(*, targets: list[str] | None, local_base: str | None, json_output: bool) -> None:
    try:
        response = pull_drive_from_environment(targets=targets, local_base=local_base or read_agent_stub_drive_base())
    except MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    if json_output:
        typer.echo(response.model_dump_json())
        return
    for item in response.items:
        typer.echo(item.local_path)


def _run_drive_push(*, local_path: str, drive_path: str, kind: str | None) -> None:
    try:
        response = push_drive_from_environment(
            local_path=local_path,
            drive_path=drive_path,
            kind=cast(DrivePushKind | None, kind),
        )
    except MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    typer.echo(response.model_dump_json())


__all__ = ["app", "main"]
