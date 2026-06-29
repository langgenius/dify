"""Runtime Dify config layer with shell-backed eager pulls."""

from __future__ import annotations

import asyncio
import shlex
from dataclasses import dataclass
from typing import ClassVar

from typing_extensions import Self, override

from agenton.layers import LayerDeps, PlainLayer
from dify_agent.agent_stub.cli._config import (
    CONFIG_PUSH_SPEC_EXAMPLE_TEXT,
    CONFIG_PUSH_SPEC_JSON_SCHEMA_TEXT,
    CONFIG_PUSH_SPEC_SEMANTICS,
)
from dify_agent.agent_stub.cli.main import render_agent_stub_cli_help
from dify_agent.layers.config.configs import (
    DIFY_CONFIG_LAYER_TYPE_ID,
    DifyConfigLayerConfig,
    DifyConfigRuntimeState,
)
from dify_agent.layers.shell.layer import DifyShellLayer

_CONFIG_CONTEXT_HEADING = "Agent config context from the current Agent Soul:"
_CONFIG_CLI_USAGE_PROMPT = """Agent config CLI usage is available inside shell jobs. The command help below is generated
from the same `dify-agent` CLI definitions available in shell jobs.

Local edits to config files, skills, env, or notes are not saved by themselves. Config changes are saved only by a
config push. Config push is available only when the Agent config context reports `config_version.kind` as
`build_draft` and `config_version.writable` as true."""
_CONFIG_CLI_PUSH_PROMPT = (
    "- Save updated build-draft config files/skills/env/note by piping a JSON spec to "
    "`dify-agent config push`."
)
_CONFIG_CLI_HELP_COMMANDS: dict[str, tuple[str, ...]] = {
    "dify-agent config --help": ("config",),
    "dify-agent config manifest --help": ("config", "manifest"),
    "dify-agent config skill pull --help": ("config", "skill", "pull"),
    "dify-agent config file pull --help": ("config", "file", "pull"),
    "dify-agent config env pull --help": ("config", "env", "pull"),
    "dify-agent config note pull --help": ("config", "note", "pull"),
}
_CONFIG_CLI_PUSH_HELP_COMMANDS: dict[str, tuple[str, ...]] = {
    "dify-agent config push --help": ("config", "push"),
}
_CONFIG_CONTEXT_EXCLUDE = {"mentioned_skill_names": True, "mentioned_file_names": True}
_CONFIG_PUSH_SPEC_PROMPT = (
    "Config push JSON spec:\n"
    "Semantics:\n{semantics}\n\n"
    "JSON Schema:\n{schema}\n\n"
    "Example:\n{example}"
)


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
            command_paths.update(_CONFIG_CLI_PUSH_HELP_COMMANDS)
        self.runtime_state.config_context_json = self._format_config_context_json()
        self.runtime_state.config_cli_help = {
            command: render_agent_stub_cli_help(args) for command, args in command_paths.items()
        }
        self.runtime_state.push_spec_semantics = CONFIG_PUSH_SPEC_SEMANTICS
        self.runtime_state.push_spec_json_schema = CONFIG_PUSH_SPEC_JSON_SCHEMA_TEXT
        self.runtime_state.push_spec_example = CONFIG_PUSH_SPEC_EXAMPLE_TEXT

    def build_prompt_context(self) -> str:
        sections: list[str] = []

        loaded_skill_sections = []
        for name in self.config.mentioned_skill_names:
            output = self.runtime_state.pulled_skill_outputs.get(name)
            if output is None:
                continue
            loaded_skill_sections.append(f"Name: {name}\nPull output:\n{output}")
        if loaded_skill_sections:
            sections.append("Loaded mentioned skills:\n\n" + "\n\n".join(loaded_skill_sections))

        mentioned_file_sections = [
            f"Name: {name}\nPull output:\n{self.runtime_state.pulled_file_outputs[name]}"
            for name in self.config.mentioned_file_names
            if name in self.runtime_state.pulled_file_outputs
        ]
        if mentioned_file_sections:
            sections.append("Mentioned files pulled locally:\n\n" + "\n\n".join(mentioned_file_sections))

        return "\n\n".join(section for section in sections if section)

    def build_suffix_prompt(self) -> str:
        sections: list[str] = []
        if self.runtime_state.config_context_json:
            sections.append(f"{_CONFIG_CONTEXT_HEADING}\n{self.runtime_state.config_context_json}")
        usage_lines = [_CONFIG_CLI_USAGE_PROMPT]
        if self._config_writable:
            usage_lines.append(_CONFIG_CLI_PUSH_PROMPT)
            usage_lines.append(self._format_config_push_spec())
        if cli_help := self._format_config_cli_help():
            usage_lines.append(cli_help)
        sections.append("\n".join(usage_lines))
        return "\n\n".join(section for section in sections if section)

    @property
    def _config_writable(self) -> bool:
        return self.config.config_version is not None and self.config.config_version.writable

    def _format_config_cli_help(self) -> str:
        commands = list(_CONFIG_CLI_HELP_COMMANDS)
        if self._config_writable:
            commands.extend(_CONFIG_CLI_PUSH_HELP_COMMANDS)
        command_sections = [
            f"$ {command}\n{self.runtime_state.config_cli_help[command]}"
            for command in commands
            if command in self.runtime_state.config_cli_help
        ]
        if not command_sections:
            return ""
        return "Agent config CLI help:\n" + "\n\n".join(command_sections)

    def _format_config_push_spec(self) -> str:
        return _CONFIG_PUSH_SPEC_PROMPT.format(
            semantics=self.runtime_state.push_spec_semantics,
            schema=self.runtime_state.push_spec_json_schema,
            example=self.runtime_state.push_spec_example,
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
            f"dify-agent config skill pull {shlex.quote(name)}",
        ]
        return "\n".join(lines)

    def _build_shell_file_pull_script(self, name: str) -> str:
        lines = [
            "set -eu",
            f"dify-agent config file pull {shlex.quote(name)}",
        ]
        return "\n".join(lines)


__all__ = ["DifyConfigLayer", "DifyConfigLayerError"]
