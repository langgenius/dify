"""Runtime Dify config layer with shell-backed eager pulls."""

from __future__ import annotations

import asyncio
import json
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

_CONFIG_BASE_PATH = "/tmp/dify-config"
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
            body = self.runtime_state.loaded_skill_bodies.get(name)
            directory_path = self.runtime_state.pulled_skill_paths.get(name)
            if body is None or directory_path is None:
                continue
            loaded_skill_sections.append(f"Name: {name}\nLocal path: {directory_path}\nSKILL.md:\n{body}")
        if loaded_skill_sections:
            sections.append("Loaded mentioned skills:\n\n" + "\n\n".join(loaded_skill_sections))

        mentioned_files = [
            f"- {name} -> {self.runtime_state.pulled_file_paths[name]}"
            for name in self.config.mentioned_file_names
            if name in self.runtime_state.pulled_file_paths
        ]
        if mentioned_files:
            sections.append("Mentioned files pulled locally:\n" + "\n".join(mentioned_files))

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
        self.runtime_state.loaded_skill_bodies = {}
        self.runtime_state.pulled_skill_paths = {}
        self.runtime_state.pulled_file_paths = {}
        if not self.config.mentioned_skill_names and not self.config.mentioned_file_names:
            return

        tasks = []
        if self.config.mentioned_skill_names:
            tasks.append(self._pull_mentioned_skills())
        if self.config.mentioned_file_names:
            tasks.append(self._pull_mentioned_files())
        await asyncio.gather(*tasks)

    async def _pull_mentioned_skills(self) -> None:
        result = await self.deps.shell.run_remote_script(
            self._build_shell_skill_pull_script(),
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

        skill_items = self._parse_shell_pull_items(result.output)
        self.runtime_state.loaded_skill_bodies = {item["name"]: item["skill_md"] for item in skill_items}
        self.runtime_state.pulled_skill_paths = {item["name"]: item["directory_path"] for item in skill_items}
        for name in self.config.mentioned_skill_names:
            if name not in self.runtime_state.loaded_skill_bodies or name not in self.runtime_state.pulled_skill_paths:
                raise DifyConfigLayerError(f"missing pulled skill content for mentioned config skill {name}")

    async def _pull_mentioned_files(self) -> None:
        result = await self.deps.shell.run_remote_script(
            self._build_shell_file_pull_script(),
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

        file_items = self._parse_shell_pull_items(result.output)
        self.runtime_state.pulled_file_paths = {item["name"]: item["path"] for item in file_items}
        for name in self.config.mentioned_file_names:
            if name not in self.runtime_state.pulled_file_paths:
                raise DifyConfigLayerError(f"missing pulled file for mentioned config file {name}")

    def _build_shell_skill_pull_script(self) -> str:
        skill_names = " ".join(shlex.quote(name) for name in self.config.mentioned_skill_names)
        lines = [
            "set -eu",
            f"base={shlex.quote(_CONFIG_BASE_PATH)}",
            'mkdir -p "$base/skills"',
            f'dify-agent config skill pull {skill_names} --to "$base/skills" --json',
        ]
        return "\n".join(lines)

    def _build_shell_file_pull_script(self) -> str:
        file_names = " ".join(shlex.quote(name) for name in self.config.mentioned_file_names)
        lines = [
            "set -eu",
            f"base={shlex.quote(_CONFIG_BASE_PATH)}",
            'mkdir -p "$base/files"',
            f'dify-agent config file pull {file_names} --to "$base/files" --json',
        ]
        return "\n".join(lines)

    @staticmethod
    def _parse_shell_pull_items(output: str) -> list[dict[str, str]]:
        try:
            items = json.loads(output).get("items", []) if output.strip() else []
        except json.JSONDecodeError as exc:
            raise DifyConfigLayerError("config mentioned pull emitted invalid JSON") from exc
        if not isinstance(items, list):
            raise DifyConfigLayerError("config mentioned pull emitted an invalid JSON payload")
        if not all(isinstance(item, dict) for item in items):
            raise DifyConfigLayerError("config mentioned pull emitted an invalid JSON item")
        return items


__all__ = ["DifyConfigLayer", "DifyConfigLayerError"]
