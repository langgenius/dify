"""Typer entry point for the client-safe ``dify-agent`` console script.

The CLI supports an explicit ``connect`` command and treats unknown bare
commands as shell back proxy forwards. When the injected back proxy environment
variables are missing, that path intentionally surfaces a clear missing-env
error instead of Typer's generic unknown-command message. The module depends
only on client-safe code so importing the console entry point does not pull in
FastAPI, Redis, shellctl, or JWE runtime dependencies.
"""

from __future__ import annotations

import sys

import typer
from typer.main import get_command

from dify_agent.cli._back_proxy import connect_from_environment
from dify_agent.cli._env import MissingBackProxyEnvironmentError, has_back_proxy_environment
from dify_agent.client._back_proxy import BackProxyClientError


app = typer.Typer(
    add_completion=False,
    help="Forward shell-visible dify-agent commands back to the Dify Agent server.",
    no_args_is_help=True,
)
_KNOWN_ROOT_COMMANDS = frozenset({"connect"})


@app.command(context_settings={"allow_extra_args": True, "ignore_unknown_options": True})
def connect(
    json_output: bool = typer.Option(False, "--json", help="Emit the connection response as JSON."),
    argv: list[str] = typer.Argument(default_factory=list, metavar="ARGV"),
) -> None:
    """Establish one shell back proxy connection using the current environment."""
    _run_connect(argv=list(argv), json_output=json_output)


def main(argv: list[str] | None = None) -> None:
    """Run the ``dify-agent`` CLI with optional argv injection for tests."""
    args = list(sys.argv[1:] if argv is None else argv)
    if args[:1] == ["connect"] and not _is_help_request(args[1:]):
        json_output, forwarded_args = _parse_connect_args(args[1:])
        _run_connect(argv=forwarded_args, json_output=json_output)
        return
    json_output, forwarded_args = _extract_root_json_flag(args)
    if _is_unknown_bare_command(forwarded_args):
        if not has_back_proxy_environment():
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
    except MissingBackProxyEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except BackProxyClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc

    if json_output:
        typer.echo(response.model_dump_json())
        return
    typer.echo(f"connected {response.connection_id}")


__all__ = ["app", "main"]
