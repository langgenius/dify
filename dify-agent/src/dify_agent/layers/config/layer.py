"""Runtime Dify config layer with shell-backed eager pulls."""

from __future__ import annotations

import asyncio
import shlex
from dataclasses import dataclass
from typing import ClassVar

from typing_extensions import Self, override

from agenton.layers import LayerDeps, PlainLayer
from dify_agent.agent_stub.cli.main import render_agent_stub_cli_help
from dify_agent.layers._agent_file_cli_help import AGENT_FILE_UPLOAD_REPLY_HINT as _AGENT_FILE_UPLOAD_REPLY_HINT
from dify_agent.layers.config.configs import (
    DIFY_CONFIG_LAYER_TYPE_ID,
    DifyConfigLayerConfig,
    DifyConfigRuntimeState,
)
from dify_agent.layers.shell.layer import DifyShellLayer

_CONFIG_CONTEXT_HEADING = "Current Agent config manifest for this run:"
_CONFIG_CONTEXT_COMMAND = "dify-agent config manifest"
_CONFIG_CLI_USAGE_PROMPT = """`dify-agent` is an installed CLI tool in the shell environment. Use it directly in shell_run scripts.

The command outputs below are generated from the `dify-agent` CLI available in this run. Use them as the source of truth
for command names, arguments, and options.

Config persistence rules:

- Local shell edits to config files, skills, env, or notes are not saved by themselves.
- To persist an Agent config change, run the matching `dify-agent config ...` mutation command.
- Mutation commands are available only when the manifest shows `config_version.kind` as `build_draft` and
  `config_version.writable` as true."""
_CONFIG_CLI_HELP_COMMANDS: dict[str, tuple[str, ...]] = {
    "dify-agent config --help": ("config",),
    "dify-agent config manifest --help": ("config", "manifest"),
    "dify-agent config skills pull --help": ("config", "skills", "pull"),
    "dify-agent config files pull --help": ("config", "files", "pull"),
    "dify-agent config note pull --help": ("config", "note", "pull"),
}
_CONFIG_CLI_MUTATION_HELP_COMMANDS: dict[str, tuple[str, ...]] = {
    "dify-agent config note push --help": ("config", "note", "push"),
    "dify-agent config env push --help": ("config", "env", "push"),
    "dify-agent config files push --help": ("config", "files", "push"),
    "dify-agent config files delete --help": ("config", "files", "delete"),
    "dify-agent config skills push --help": ("config", "skills", "push"),
    "dify-agent config skills delete --help": ("config", "skills", "delete"),
}
_AGENT_FILE_CLI_HELP_COMMANDS: dict[str, tuple[str, ...]] = {
    "dify-agent file upload --help": ("file", "upload"),
    "dify-agent file download --help": ("file", "download"),
}
_CONFIG_CONTEXT_EXCLUDE = {"mentioned_skill_names": True, "mentioned_file_names": True}


class DifyConfigLayerError(RuntimeError):
    """Raised when one eager-pull config operation fails."""


class DifyConfigDeps(LayerDeps):
    shell: DifyShellLayer  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DifyConfigLayer(PlainLayer[DifyConfigDeps, DifyConfigLayerConfig, DifyConfigRuntimeState]):
    """Config runtime layer that materializes prompt-mentioned targets via shell."""

    type_id: ClassVar[str | None] = DIFY_CONFIG_LAYER_TYPE_ID

    config: DifyConfigLayerConfig

    @classmethod
    @override
    def from_config(cls, config: DifyConfigLayerConfig) -> Self:
        return cls(config=DifyConfigLayerConfig.model_validate(config))

    @property
    @override
    def prefix_prompts(self) -> list[str]:
        return [self.build_prompt_context()]

    @property
    @override
    def suffix_prompts(self) -> list[str]:
        return [self.build_suffix_prompt()]

    @override
    async def on_context_create(self) -> None:
        await self._initialize_context()

    @override
    async def on_context_resume(self) -> None:
        return None

    async def _initialize_context(self) -> None:
        self._initialize_runtime_prompt_state()
        await self._pull_mentioned_targets()

    def _initialize_runtime_prompt_state(self) -> None:
        command_paths = dict(_CONFIG_CLI_HELP_COMMANDS)
        if self._config_writable:
            command_paths.update(_CONFIG_CLI_MUTATION_HELP_COMMANDS)
        command_paths.update(_AGENT_FILE_CLI_HELP_COMMANDS)
        self.runtime_state.config_context_json = self._format_config_context_json()
        self.runtime_state.config_cli_help = {
            command: render_agent_stub_cli_help(args) for command, args in command_paths.items()
        }
        self.runtime_state.push_spec_semantics = ""
        self.runtime_state.push_spec_json_schema = ""
        self.runtime_state.push_spec_example = ""

    def build_prompt_context(self) -> str:
        sections: list[str] = []

        loaded_skill_sections = []
        for name in self.config.mentioned_skill_names:
            output = self.runtime_state.pulled_skill_outputs.get(name)
            if output is None:
                continue
            command = f"dify-agent config skills pull {shlex.quote(name)}"
            loaded_skill_sections.append(
                f"Name: {name}\nPull command output for this run:\n{_format_command_output(command, output)}"
            )
        if loaded_skill_sections:
            sections.append("Loaded mentioned skills:\n\n" + "\n\n".join(loaded_skill_sections))

        mentioned_file_sections = []
        for name in self.config.mentioned_file_names:
            output = self.runtime_state.pulled_file_outputs.get(name)
            if output is None:
                continue
            command = f"dify-agent config files pull {shlex.quote(name)}"
            mentioned_file_sections.append(
                f"Name: {name}\nPull command output for this run:\n{_format_command_output(command, output)}"
            )
        if mentioned_file_sections:
            sections.append("Mentioned files pulled locally:\n\n" + "\n\n".join(mentioned_file_sections))

        return "\n\n".join(section for section in sections if section)

    def build_suffix_prompt(self) -> str:
        sections: list[str] = []
        if self.runtime_state.config_context_json:
            sections.append(
                f"{_CONFIG_CONTEXT_HEADING}\n"
                f"{_format_command_output(_CONFIG_CONTEXT_COMMAND, self.runtime_state.config_context_json)}"
            )
        usage_lines = [_CONFIG_CLI_USAGE_PROMPT]
        if cli_help := self._format_config_cli_help():
            usage_lines.append(cli_help)
        if file_cli_help := self._format_agent_file_cli_help():
            usage_lines.append(file_cli_help)
        sections.append("\n".join(usage_lines))
        return "\n\n".join(section for section in sections if section)

    @property
    def _config_writable(self) -> bool:
        return self.config.config_version is not None and self.config.config_version.writable

    def _format_config_cli_help(self) -> str:
        commands = list(_CONFIG_CLI_HELP_COMMANDS)
        if self._config_writable:
            commands.extend(_CONFIG_CLI_MUTATION_HELP_COMMANDS)
        command_sections = [
            _format_command_output(command, self.runtime_state.config_cli_help[command])
            for command in commands
            if command in self.runtime_state.config_cli_help
        ]
        if not command_sections:
            return ""
        return "Agent config CLI reference for installed `dify-agent`:\n" + "\n\n".join(command_sections)

    def _format_agent_file_cli_help(self) -> str:
        command_sections = [
            _format_command_output(command, self.runtime_state.config_cli_help[command])
            for command in _AGENT_FILE_CLI_HELP_COMMANDS
            if command in self.runtime_state.config_cli_help
        ]
        if not command_sections:
            return ""
        return (
            "Agent file CLI reference for installed `dify-agent`:\n"
            + "\n\n".join(command_sections)
            + f"\n\n{_AGENT_FILE_UPLOAD_REPLY_HINT}"
        )

    def _format_config_context_json(self) -> str:
        return self.config.model_dump_json(exclude=_CONFIG_CONTEXT_EXCLUDE, exclude_none=True)

    async def _pull_mentioned_targets(self) -> None:
        self.runtime_state.pulled_skill_outputs = {}
        self.runtime_state.pulled_file_outputs = {}
        if not self.config.mentioned_skill_names and not self.config.mentioned_file_names:
            return

        tasks = [
            *(self._pull_mentioned_skill(name) for name in self.config.mentioned_skill_names),
            *(self._pull_mentioned_file(name) for name in self.config.mentioned_file_names),
        ]
        await asyncio.gather(*tasks)

    async def _pull_mentioned_skill(self, name: str) -> None:
        result = await self.deps.shell.run_remote_script(
            self._build_shell_skill_pull_script(name),
            inject_agent_stub_env=True,
        )
        if result.exit_code != 0:
            raise DifyConfigLayerError(
                "config mentioned skill pull failed in shell: "
                f"{result.status} exit_code={result.exit_code}\n{result.output}"
            )
        if not result.output_complete:
            reason = result.incomplete_reason or "unknown"
            raise DifyConfigLayerError(
                f"config mentioned skill pull output was incomplete before the payload finished: {reason}"
            )
        output = result.output.strip()
        if not output:
            raise DifyConfigLayerError(f"missing pull output for mentioned config skill {name}")
        self.runtime_state.pulled_skill_outputs = {
            **self.runtime_state.pulled_skill_outputs,
            name: output,
        }

    async def _pull_mentioned_file(self, name: str) -> None:
        result = await self.deps.shell.run_remote_script(
            self._build_shell_file_pull_script(name),
            inject_agent_stub_env=True,
        )
        if result.exit_code != 0:
            raise DifyConfigLayerError(
                "config mentioned file pull failed in shell: "
                f"{result.status} exit_code={result.exit_code}\n{result.output}"
            )
        if not result.output_complete:
            reason = result.incomplete_reason or "unknown"
            raise DifyConfigLayerError(
                f"config mentioned file pull output was incomplete before the payload finished: {reason}"
            )
        output = result.output.strip()
        if not output:
            raise DifyConfigLayerError(f"missing pull output for mentioned config file {name}")
        self.runtime_state.pulled_file_outputs = {
            **self.runtime_state.pulled_file_outputs,
            name: output,
        }

    def _build_shell_skill_pull_script(self, name: str) -> str:
        lines = [
            "set -eu",
            f"dify-agent config skills pull {shlex.quote(name)}",
        ]
        return "\n".join(lines)

    def _build_shell_file_pull_script(self, name: str) -> str:
        lines = [
            "set -eu",
            f"dify-agent config files pull {shlex.quote(name)}",
        ]
        return "\n".join(lines)


def _format_command_output(command: str, output: str) -> str:
    return f"Command:\n$ {command}\nOutput:\n{output}"


__all__ = ["DifyConfigLayer", "DifyConfigLayerError"]
