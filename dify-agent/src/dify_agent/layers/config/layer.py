"""Runtime Dify config layer with shell-backed eager pulls."""

from __future__ import annotations

import asyncio
import json
import shlex
from dataclasses import dataclass, field
from typing import ClassVar

from typing_extensions import Self, override

from agenton.layers import EmptyRuntimeState, LayerDeps, PlainLayer
from dify_agent.agent_stub.protocol.agent_stub import AgentStubConfigManifestResponse
from dify_agent.layers.config.configs import DIFY_CONFIG_LAYER_TYPE_ID, DifyConfigLayerConfig
from dify_agent.layers.shell.layer import DifyShellLayer

_CONFIG_BASE_PATH = "/tmp/dify-config"
_CONFIG_MANIFEST_COMMAND = "dify-agent config manifest"
_CONFIG_CLI_USAGE_PROMPT = """Agent config CLI usage is available inside shell jobs. The command help below is captured
from the current `dify-agent` CLI.

Local edits to config files, skills, env, or notes are not saved by themselves. Config changes are saved only by a
config push. Config push is available only when `dify-agent config manifest` reports `config_version.kind` as
`build_draft` and `config_version.writable` as true."""
_CONFIG_CLI_PUSH_PROMPT = "- Save updated build-draft config files/skills/env/note by piping a JSON spec to `dify-agent config push`."
_CONFIG_CLI_HELP_COMMANDS = (
    "dify-agent config --help",
    "dify-agent config manifest --help",
    "dify-agent config skill pull --help",
    "dify-agent config file pull --help",
    "dify-agent config env pull --help",
    "dify-agent config note pull --help",
)
_CONFIG_CLI_PUSH_HELP_COMMAND = "dify-agent config push --help"


class DifyConfigLayerError(RuntimeError):
    """Raised when one eager-pull config operation fails."""


class DifyConfigDeps(LayerDeps):
    shell: DifyShellLayer  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DifyConfigLayer(PlainLayer[DifyConfigDeps, DifyConfigLayerConfig, EmptyRuntimeState]):
    """Config runtime layer that materializes prompt-mentioned targets via shell."""

    type_id: ClassVar[str | None] = DIFY_CONFIG_LAYER_TYPE_ID

    config: DifyConfigLayerConfig
    _loaded_skill_bodies: dict[str, str] = field(default_factory=dict)
    _pulled_skill_paths: dict[str, str] = field(default_factory=dict)
    _pulled_file_paths: dict[str, str] = field(default_factory=dict)
    _config_manifest: AgentStubConfigManifestResponse | None = None
    _config_manifest_output: str = ""
    _config_cli_help: dict[str, str] = field(default_factory=dict)

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
        await self._initialize_context()

    async def _initialize_context(self) -> None:
        results = await asyncio.gather(
            self._load_config_manifest(),
            self._load_config_cli_help(),
            self._pull_mentioned_targets(),
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, BaseException):
                raise result
        if self._config_writable:
            await self._load_config_cli_help_commands((_CONFIG_CLI_PUSH_HELP_COMMAND,))

    def build_prompt_context(self) -> str:
        sections: list[str] = []

        loaded_skill_sections = []
        for name in self.config.mentioned_skill_names:
            body = self._loaded_skill_bodies.get(name)
            directory_path = self._pulled_skill_paths.get(name)
            if body is None or directory_path is None:
                continue
            loaded_skill_sections.append(f"Name: {name}\nLocal path: {directory_path}\nSKILL.md:\n{body}")
        if loaded_skill_sections:
            sections.append("Loaded mentioned skills:\n\n" + "\n\n".join(loaded_skill_sections))

        mentioned_files = [
            f"- {name} -> {self._pulled_file_paths[name]}"
            for name in self.config.mentioned_file_names
            if name in self._pulled_file_paths
        ]
        if mentioned_files:
            sections.append("Mentioned files pulled locally:\n" + "\n".join(mentioned_files))

        return "\n\n".join(section for section in sections if section)

    def build_suffix_prompt(self) -> str:
        sections: list[str] = []
        if self._config_manifest_output:
            sections.append(f"`{_CONFIG_MANIFEST_COMMAND}` output:\n{self._config_manifest_output}")
        usage_lines = [_CONFIG_CLI_USAGE_PROMPT]
        if self._config_writable:
            usage_lines.append(_CONFIG_CLI_PUSH_PROMPT)
        if cli_help := self._format_config_cli_help():
            usage_lines.append(cli_help)
        sections.append("\n".join(usage_lines))
        return "\n\n".join(section for section in sections if section)

    @property
    def _config_writable(self) -> bool:
        if self._config_manifest is not None:
            return self._config_manifest.config_version.writable
        return False

    def _format_config_cli_help(self) -> str:
        commands = list(_CONFIG_CLI_HELP_COMMANDS)
        if self._config_writable:
            commands.append(_CONFIG_CLI_PUSH_HELP_COMMAND)
        command_sections = [
            f"$ {command}\n{self._config_cli_help[command]}" for command in commands if command in self._config_cli_help
        ]
        if not command_sections:
            return ""
        return "Agent config CLI help:\n" + "\n\n".join(command_sections)

    async def _load_config_cli_help(self) -> None:
        self._config_cli_help = {}
        await self._load_config_cli_help_commands(_CONFIG_CLI_HELP_COMMANDS)

    async def _load_config_cli_help_commands(self, commands: tuple[str, ...]) -> None:
        async def load_command(command: str) -> tuple[str, str | None]:
            result = await self.deps.shell.run_remote_script(command, timeout=10.0)
            if result.exit_code != 0 or not result.output_complete:
                return command, None
            output = result.output.strip()
            if not output:
                return command, None
            return command, output

        results = await asyncio.gather(*(load_command(command) for command in commands))
        for command, output in results:
            if output:
                self._config_cli_help[command] = output

    async def _load_config_manifest(self) -> None:
        self._config_manifest = None
        self._config_manifest_output = ""
        result = await self.deps.shell.run_remote_script(
            _CONFIG_MANIFEST_COMMAND,
            inject_agent_stub_env=True,
            timeout=10.0,
        )
        if result.exit_code != 0 or not result.output_complete:
            return
        output = result.output.strip()
        if not output:
            return
        try:
            self._config_manifest = AgentStubConfigManifestResponse.model_validate_json(output)
        except ValueError:
            return
        self._config_manifest_output = output

    async def _pull_mentioned_targets(self) -> None:
        self._loaded_skill_bodies = {}
        self._pulled_skill_paths = {}
        self._pulled_file_paths = {}
        if not self.config.mentioned_skill_names and not self.config.mentioned_file_names:
            return

        script = self._build_shell_pull_script()
        result = await self.deps.shell.run_remote_script(script, inject_agent_stub_env=True)
        if result.exit_code != 0:
            raise DifyConfigLayerError(
                f"config mentioned pull failed in shell: {result.status} exit_code={result.exit_code}\n{result.output}"
            )
        if not result.output_complete:
            reason = result.incomplete_reason or "unknown"
            raise DifyConfigLayerError(f"config mentioned pull output was incomplete before the payload finished: {reason}")

        skill_items, file_items = self._parse_shell_pull_output(result.output)
        self._loaded_skill_bodies = {item["name"]: item["skill_md"] for item in skill_items}
        self._pulled_skill_paths = {item["name"]: item["directory_path"] for item in skill_items}
        self._pulled_file_paths = {item["name"]: item["path"] for item in file_items}
        for name in self.config.mentioned_skill_names:
            if name not in self._loaded_skill_bodies or name not in self._pulled_skill_paths:
                raise DifyConfigLayerError(f"missing pulled skill content for mentioned config skill {name}")
        for name in self.config.mentioned_file_names:
            if name not in self._pulled_file_paths:
                raise DifyConfigLayerError(f"missing pulled file for mentioned config file {name}")

    def _build_shell_pull_script(self) -> str:
        lines = [
            "set -eu",
            f"base={shlex.quote(_CONFIG_BASE_PATH)}",
            'mkdir -p "$base/skills" "$base/files"',
        ]
        if self.config.mentioned_skill_names:
            skill_names = " ".join(shlex.quote(name) for name in self.config.mentioned_skill_names)
            lines.extend(
                [
                    "printf '__DIFY_CONFIG_SKILLS_BEGIN__\\n'",
                    f'dify-agent config skill pull {skill_names} --to "$base/skills" --json',
                    "printf '\\n__DIFY_CONFIG_SKILLS_END__\\n'",
                ]
            )
        if self.config.mentioned_file_names:
            file_names = " ".join(shlex.quote(name) for name in self.config.mentioned_file_names)
            lines.extend(
                [
                    "printf '__DIFY_CONFIG_FILES_BEGIN__\\n'",
                    f'dify-agent config file pull {file_names} --to "$base/files" --json',
                    "printf '\\n__DIFY_CONFIG_FILES_END__\\n'",
                ]
            )
        return "\n".join(lines)

    def _parse_shell_pull_output(self, output: str) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        skill_json = self._extract_marked_json(output, "__DIFY_CONFIG_SKILLS_BEGIN__", "__DIFY_CONFIG_SKILLS_END__")
        file_json = self._extract_marked_json(output, "__DIFY_CONFIG_FILES_BEGIN__", "__DIFY_CONFIG_FILES_END__")
        try:
            skill_items = json.loads(skill_json).get("items", []) if skill_json else []
            file_items = json.loads(file_json).get("items", []) if file_json else []
        except json.JSONDecodeError as exc:
            raise DifyConfigLayerError("config mentioned pull emitted invalid JSON") from exc
        if not isinstance(skill_items, list) or not isinstance(file_items, list):
            raise DifyConfigLayerError("config mentioned pull emitted an invalid JSON payload")
        return skill_items, file_items

    @staticmethod
    def _extract_marked_json(output: str, begin: str, end: str) -> str:
        if begin not in output:
            return ""
        start_index = output.index(begin) + len(begin)
        if end not in output[start_index:]:
            raise DifyConfigLayerError(f"config mentioned pull omitted end marker {end}")
        end_index = output.index(end, start_index)
        return output[start_index:end_index].strip()


__all__ = ["DifyConfigLayer", "DifyConfigLayerError"]
