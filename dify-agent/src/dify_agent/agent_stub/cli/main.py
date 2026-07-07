"""Typer entry point for the client-safe ``dify-agent`` console script.

The CLI supports explicit ``connect``, ``file``, and ``drive`` commands and
treats unknown bare commands as Agent Stub forwards. When the injected Agent
Stub environment variables are missing, that path intentionally surfaces a
clear missing-env error instead of Typer's generic unknown-command message. The
module depends only on client-safe code so importing the console entry point
does not pull in FastAPI, Redis, shellctl, or JWE runtime dependencies.
"""

from __future__ import annotations

from functools import cache
from importlib import import_module
import sys

import click
import typer
from typer.main import get_command

from dify_agent.agent_stub._constants import AGENT_STUB_DRIVE_BASE_ENV_VAR, DEFAULT_AGENT_STUB_DRIVE_BASE

_CONFIG_MANIFEST_STDOUT_EXCLUDE = {
    "skills": {"items": {"__all__": {"hash"}}},
    "files": {"items": {"__all__": {"hash"}}},
}


app = typer.Typer(
    add_completion=False,
    help="Forward shell-visible dify-agent commands to the Dify Agent Stub server.",
    no_args_is_help=True,
    rich_markup_mode=None,
)
file_app = typer.Typer(help="Upload or download workflow files through the Agent Stub.", rich_markup_mode=None)
config_app = typer.Typer(
    help="Inspect or update Agent Soul-backed config assets through the Agent Stub.",
    rich_markup_mode=None,
)
config_skills_app = typer.Typer(help="Pull or update config skills through the Agent Stub.", rich_markup_mode=None)
config_files_app = typer.Typer(help="Pull or update config files through the Agent Stub.", rich_markup_mode=None)
config_skill_pull_alias_app = typer.Typer(help="Pull config skills through the Agent Stub.", rich_markup_mode=None)
config_file_pull_alias_app = typer.Typer(help="Pull config files through the Agent Stub.", rich_markup_mode=None)
config_env_app = typer.Typer(help="Update config env variables visible to the current run.", rich_markup_mode=None)
config_note_app = typer.Typer(help="Pull or update the current config note.", rich_markup_mode=None)
drive_app = typer.Typer(help="List, pull, or push agent drive files through the Agent Stub.", rich_markup_mode=None)
app.add_typer(file_app, name="file")
app.add_typer(config_app, name="config")
config_app.add_typer(config_skills_app, name="skills")
# Keep hidden singular aliases on separate pull-only apps. Reusing the plural
# apps here would also expose push/delete through `config skill|file ...`,
# which is intentionally not part of the compatibility surface.
config_app.add_typer(config_skill_pull_alias_app, name="skill", hidden=True)
config_app.add_typer(config_files_app, name="files")
config_app.add_typer(config_file_pull_alias_app, name="file", hidden=True)
config_app.add_typer(config_env_app, name="env")
config_app.add_typer(config_note_app, name="note")
app.add_typer(drive_app, name="drive")
_KNOWN_ROOT_COMMANDS = frozenset({"config", "connect", "drive", "file"})


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


@config_app.command("manifest")
def config_manifest() -> None:
    """Show the current visible Agent config manifest as JSON."""
    _run_config_manifest()


@config_skills_app.command("pull")
def config_skills_pull(
    names: list[str] = typer.Argument(None, metavar="NAME"),
    local_dir: str | None = typer.Option(None, "--to", help="Local directory for pulled config skills."),
    json_output: bool = typer.Option(False, "--json", help="Emit the pull result as JSON."),
) -> None:
    """Pull one or all visible config skills into ./.dify_conf/skills by default."""
    _run_config_skill_pull(names=names or None, local_dir=local_dir, json_output=json_output)


@config_skill_pull_alias_app.command("pull")
def config_skill_pull_alias(
    names: list[str] = typer.Argument(None, metavar="NAME"),
    local_dir: str | None = typer.Option(None, "--to", help="Local directory for pulled config skills."),
    json_output: bool = typer.Option(False, "--json", help="Emit the pull result as JSON."),
) -> None:
    """Pull one or all visible config skills into ./.dify_conf/skills by default."""
    _run_config_skill_pull(names=names or None, local_dir=local_dir, json_output=json_output)


@config_skills_app.command("push")
def config_skills_push(
    paths: list[str] = typer.Argument(..., metavar="PATH..."),
) -> None:
    """Upload one or more local skill directories into the current config manifest.

    Pass a directory such as ./skills/researcher that contains SKILL.md. Other files in that directory are
    archived with the skill. Pushing a skill with an existing name replaces that config skill.
    """
    _run_config_skills_push(paths=paths)


@config_skills_app.command("delete")
def config_skills_delete(
    names: list[str] = typer.Argument(..., metavar="NAME"),
) -> None:
    """Delete one or more config skills by name without touching local directories."""
    _run_config_skills_delete(names=names)


@config_files_app.command("pull")
def config_files_pull(
    names: list[str] = typer.Argument(None, metavar="NAME"),
    local_dir: str | None = typer.Option(None, "--to", help="Local directory for pulled config files."),
    json_output: bool = typer.Option(False, "--json", help="Emit the pull result as JSON."),
) -> None:
    """Pull one or all visible config files into ./.dify_conf/files by default."""
    _run_config_file_pull(names=names or None, local_dir=local_dir, json_output=json_output)


@config_file_pull_alias_app.command("pull")
def config_file_pull_alias(
    names: list[str] = typer.Argument(None, metavar="NAME"),
    local_dir: str | None = typer.Option(None, "--to", help="Local directory for pulled config files."),
    json_output: bool = typer.Option(False, "--json", help="Emit the pull result as JSON."),
) -> None:
    """Pull one or all visible config files into ./.dify_conf/files by default."""
    _run_config_file_pull(names=names or None, local_dir=local_dir, json_output=json_output)


@config_files_app.command("push")
def config_files_push(
    paths: list[str] = typer.Argument(..., metavar="PATH..."),
) -> None:
    """Upload one or more local files into the current config manifest.

    Pass one or more regular local files such as ./guide.md and ./policy.txt. To upload a folder, compress it
    first and pass the archive file. The config file name is the local basename. Pushing a file with an existing config
    name replaces that config file.
    """
    _run_config_files_push(paths=paths)


@config_files_app.command("delete")
def config_files_delete(
    names: list[str] = typer.Argument(..., metavar="NAME"),
) -> None:
    """Delete one or more config files by name without touching local files."""
    _run_config_files_delete(names=names)


@config_env_app.command("push")
def config_env_push(
    local_path: str = typer.Argument(..., metavar="PATH|-"),
) -> None:
    """Set or delete config env entries from one local dotenv file or stdin.

    Pass dotenv text with lines like API_KEY=value and OLD_KEY=. KEY=value sets or updates an entry, KEY= deletes
    it, and omitted keys are unchanged.
    """
    _run_config_env_push(local_path=local_path)


@config_note_app.command("pull")
def config_note_pull(
    local_path: str | None = typer.Option(None, "--to", help="Local markdown file path."),
) -> None:
    """Export the current config note into ./.dify_conf/note.md by default."""
    _run_config_note_pull(local_path=local_path)


@config_note_app.command("push")
def config_note_push(
    local_path: str | None = typer.Argument(None, metavar="[PATH|-]"),
) -> None:
    """Replace the current config note from one local text file or stdin.

    Pass a plain text or Markdown note file, or use - to read the note from stdin. When PATH is omitted, the
    command reads ./.dify_conf/note.md.
    """
    _run_config_note_push(local_path=local_path)


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
        if not _env_module().has_agent_stub_environment():
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


def render_agent_stub_cli_help(args: tuple[str, ...]) -> str:
    """Render Click help for one known ``dify-agent`` subcommand without executing a shell."""
    command: click.Command = get_command(app)
    parent_context: click.Context | None = None
    command_path = ["dify-agent"]
    for name in args:
        if not isinstance(command, click.Group):
            raise ValueError(f"dify-agent {' '.join(args)} is not a command group")
        next_command = command.commands.get(name)
        if next_command is None:
            raise ValueError(f"unknown dify-agent command path: {' '.join(args)}")
        current_context = click.Context(command, info_name=command_path[-1], parent=parent_context)
        parent_context = current_context
        command = next_command
        command_path.append(name)
    context = click.Context(command, info_name=command_path[-1], parent=parent_context)
    return command.get_help(context).strip()


def _run_connect(*, argv: list[str], json_output: bool) -> None:
    env_module = _env_module()
    client_module = _client_module()
    agent_stub_module = _agent_stub_module()
    try:
        response = agent_stub_module.connect_from_environment(argv=argv)
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc

    if json_output:
        typer.echo(response.model_dump_json())
        return
    typer.echo(f"connected {response.connection_id}")


def _run_file_upload(*, path: str) -> None:
    env_module = _env_module()
    client_module = _client_module()
    files_module = _files_module()
    try:
        response = files_module.upload_file_from_environment(path=path)
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
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
    env_module = _env_module()
    client_module = _client_module()
    files_module = _files_module()
    try:
        response = files_module.download_file_from_environment(
            transfer_method=transfer_method,
            reference_or_url=reference_or_url,
            mapping=mapping,
            local_dir=local_dir,
        )
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    typer.echo(str(response.path))


def _run_config_manifest() -> None:
    env_module = _env_module()
    client_module = _client_module()
    config_module = _config_module()
    try:
        response = config_module.manifest_from_environment()
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    typer.echo(response.model_dump_json(exclude=_CONFIG_MANIFEST_STDOUT_EXCLUDE))


def _run_config_skill_pull(*, names: list[str] | None, local_dir: str | None, json_output: bool) -> None:
    env_module = _env_module()
    client_module = _client_module()
    config_module = _config_module()
    try:
        response = config_module.pull_config_skills_from_environment(names=names, local_dir=local_dir)
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    if json_output:
        typer.echo(response.model_dump_json())
        return
    for index, item in enumerate(response.items):
        if index:
            typer.echo("")
        typer.echo(item.directory_path)
        typer.echo(item.skill_md, nl=False)


def _run_config_file_pull(*, names: list[str] | None, local_dir: str | None, json_output: bool) -> None:
    env_module = _env_module()
    client_module = _client_module()
    config_module = _config_module()
    try:
        response = config_module.pull_config_files_from_environment(names=names, local_dir=local_dir)
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    if json_output:
        typer.echo(response.model_dump_json())
        return
    for item in response.items:
        typer.echo(item.path)


def _run_config_note_pull(*, local_path: str | None) -> None:
    env_module = _env_module()
    client_module = _client_module()
    config_module = _config_module()
    try:
        path = config_module.pull_config_note_from_environment(local_path=local_path)
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    typer.echo(str(path))


def _run_config_note_push(*, local_path: str | None) -> None:
    env_module = _env_module()
    client_module = _client_module()
    config_module = _config_module()
    try:
        response = config_module.push_config_note_from_environment(local_path=local_path)
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    typer.echo(response.model_dump_json())


def _run_config_env_push(*, local_path: str) -> None:
    env_module = _env_module()
    client_module = _client_module()
    config_module = _config_module()
    try:
        response = config_module.push_config_env_from_environment(local_path=local_path)
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    typer.echo(response.model_dump_json())


def _run_config_files_push(*, paths: list[str]) -> None:
    env_module = _env_module()
    client_module = _client_module()
    config_module = _config_module()
    try:
        response = config_module.push_config_files_from_environment(paths=paths)
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    typer.echo(response.model_dump_json())


def _run_config_files_delete(*, names: list[str]) -> None:
    env_module = _env_module()
    client_module = _client_module()
    config_module = _config_module()
    try:
        response = config_module.delete_config_files_from_environment(names=names)
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    typer.echo(response.model_dump_json())


def _run_config_skills_push(*, paths: list[str]) -> None:
    env_module = _env_module()
    client_module = _client_module()
    config_module = _config_module()
    try:
        response = config_module.push_config_skills_from_environment(paths=paths)
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    typer.echo(response.model_dump_json())


def _run_config_skills_delete(*, names: list[str]) -> None:
    env_module = _env_module()
    client_module = _client_module()
    config_module = _config_module()
    try:
        response = config_module.delete_config_skills_from_environment(names=names)
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    typer.echo(response.model_dump_json())


def _run_drive_list(*, path_prefix: str, json_output: bool) -> None:
    env_module = _env_module()
    client_module = _client_module()
    drive_module = _drive_module()
    try:
        response = drive_module.list_drive_manifest_from_environment(prefix=path_prefix)
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    if json_output:
        typer.echo(response.model_dump_json())
        return
    typer.echo(drive_module.format_drive_manifest(response))


def _run_drive_pull(*, targets: list[str] | None, local_base: str | None, json_output: bool) -> None:
    env_module = _env_module()
    client_module = _client_module()
    drive_module = _drive_module()
    try:
        response = drive_module.pull_drive_from_environment(
            targets=targets,
            local_base=local_base or env_module.read_agent_stub_drive_base(),
        )
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    if json_output:
        typer.echo(response.model_dump_json())
        return
    for item in response.items:
        typer.echo(item.local_path)


def _run_drive_push(*, local_path: str, drive_path: str, kind: str | None) -> None:
    env_module = _env_module()
    client_module = _client_module()
    drive_module = _drive_module()
    try:
        response = drive_module.push_drive_from_environment(
            local_path=local_path,
            drive_path=drive_path,
            kind=kind,
        )
    except env_module.MissingAgentStubEnvironmentError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(2) from exc
    except client_module.AgentStubClientError as exc:
        typer.echo(str(exc), err=True)
        raise SystemExit(1) from exc
    typer.echo(response.model_dump_json())


# Keep helper imports on demand so importing CLI/help stays free of server-side
# and unrelated heavy runtime dependencies.
@cache
def _agent_stub_module():
    return import_module("dify_agent.agent_stub.cli._agent_stub")


@cache
def _config_module():
    return import_module("dify_agent.agent_stub.cli._config")


@cache
def _drive_module():
    return import_module("dify_agent.agent_stub.cli._drive")


@cache
def _files_module():
    return import_module("dify_agent.agent_stub.cli._files")


@cache
def _env_module():
    return import_module("dify_agent.agent_stub.cli._env")


@cache
def _client_module():
    return import_module("dify_agent.agent_stub.client")


__all__ = ["app", "main"]
