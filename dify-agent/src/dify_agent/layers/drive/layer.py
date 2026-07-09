"""Runtime Dify drive layer with shell-backed eager pulls.

The API backend sends the full drive skill catalog plus the ordered drive keys
mentioned in the prompt. When the layer enters a run context it eagerly pulls
those mentioned skills/files through the already-active shell layer by running
the sandbox-visible ``dify-agent drive pull`` command, then contributes a
concise prompt block describing what was loaded. It also contributes a suffix
prompt with the remaining skill catalog plus agent-visible ``dify-agent file``
usage captured from the real CLI. Drive commands remain internal for now and
are not exposed to the model.
"""

from __future__ import annotations

import shlex
from dataclasses import dataclass, field
from pathlib import Path
from typing import ClassVar

from typing_extensions import Self, override

from agenton.layers import EmptyRuntimeState, LayerDeps, PlainLayer
from dify_agent.agent_stub.protocol import agent_stub_drive_base_for_ref
from dify_agent.layers._agent_file_cli_help import AGENT_FILE_UPLOAD_REPLY_HINT as _AGENT_FILE_UPLOAD_REPLY_HINT
from dify_agent.layers.drive.configs import DIFY_DRIVE_LAYER_TYPE_ID, DifyDriveLayerConfig
from dify_agent.layers.shell.layer import DifyShellLayer

_AGENT_STUB_FILE_HELP_COMMANDS = (
    "dify-agent file --help",
    "dify-agent file upload --help",
    "dify-agent file download --help",
)


class DifyDriveLayerError(RuntimeError):
    """Raised when one eager-pull drive operation fails."""


class DifyDriveDeps(LayerDeps):
    shell: DifyShellLayer  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DifyDriveLayer(PlainLayer[DifyDriveDeps, DifyDriveLayerConfig, EmptyRuntimeState]):
    """Drive runtime layer that materializes prompt-mentioned targets via shell."""

    type_id: ClassVar[str | None] = DIFY_DRIVE_LAYER_TYPE_ID

    config: DifyDriveLayerConfig
    _loaded_skill_bodies: dict[str, str] = field(default_factory=dict)
    _pulled_file_paths: dict[str, str] = field(default_factory=dict)
    _agent_stub_cli_help: dict[str, str] = field(default_factory=dict)

    @classmethod
    @override
    def from_config(cls, config: DifyDriveLayerConfig) -> Self:
        return cls(config=DifyDriveLayerConfig.model_validate(config))

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
        await self._load_agent_stub_cli_help()
        await self._pull_mentioned_targets()

    @override
    async def on_context_resume(self) -> None:
        await self._load_agent_stub_cli_help()
        await self._pull_mentioned_targets()

    def build_prompt_context(self) -> str:
        sections: list[str] = []

        loaded_skill_sections: list[str] = []
        for skill_key in self.config.mentioned_skill_keys:
            body = self._loaded_skill_bodies.get(skill_key)
            if body is None:
                continue
            skill = next((item for item in self.config.skills if item.skill_md_key == skill_key), None)
            if skill is None:
                continue
            pulled_skill_path = self._pulled_file_paths.get(skill_key)
            if pulled_skill_path is None:
                continue
            local_path = Path(pulled_skill_path).parent
            loaded_skill_sections.append(f"Path: {skill.path}\nLocal path: {local_path}\nSKILL.md:\n{body}")
        if loaded_skill_sections:
            sections.append("Loaded mentioned skills:\n\n" + "\n\n".join(loaded_skill_sections))

        mentioned_files = [
            f"- {key} -> {self._pulled_file_paths[key]}"
            for key in self.config.mentioned_file_keys
            if key in self._pulled_file_paths
        ]
        if mentioned_files:
            sections.append("Mentioned files pulled to local drive:\n" + "\n".join(mentioned_files))

        if not sections:
            return ""
        return "\n\n".join(sections)

    def build_suffix_prompt(self) -> str:
        sections: list[str] = []
        mentioned_skill_keys = set(self.config.mentioned_skill_keys)
        other_skills = [
            f"- {skill.path}: {skill.name} — {skill.description}"
            for skill in self.config.skills
            if skill.skill_md_key not in mentioned_skill_keys
        ]
        if other_skills:
            sections.append("Other available skills:\n" + "\n".join(other_skills))
        if cli_help := self._format_agent_stub_cli_help():
            sections.append(cli_help)
        return "\n\n".join(sections)

    def _format_agent_stub_cli_help(self) -> str:
        command_sections = [
            _format_command_output(command, self._agent_stub_cli_help[command])
            for command in _AGENT_STUB_FILE_HELP_COMMANDS
            if command in self._agent_stub_cli_help
        ]
        if not command_sections:
            return ""
        return (
            "Agent Stub file CLI reference for installed `dify-agent`:\n"
            + "\n\n".join(command_sections)
            + f"\n\n{_AGENT_FILE_UPLOAD_REPLY_HINT}"
        )

    async def _load_agent_stub_cli_help(self) -> None:
        self._agent_stub_cli_help = {}
        for command in _AGENT_STUB_FILE_HELP_COMMANDS:
            result = await self.deps.shell.run_remote_script(command, timeout=10.0)
            if result.exit_code != 0 or not result.output_complete:
                continue
            output = result.output.strip()
            if output:
                self._agent_stub_cli_help[command] = output

    async def _pull_mentioned_targets(self) -> None:
        self._loaded_skill_bodies = {}
        self._pulled_file_paths = {}
        targets = self._mentioned_pull_targets()
        if not targets:
            return

        script = self._build_shell_pull_script(targets=targets)
        result = await self.deps.shell.run_remote_script_complete(script, inject_agent_stub_env=True)
        if result.exit_code != 0:
            raise DifyDriveLayerError(
                "drive mentioned pull failed in shell: "
                + f"{result.status} exit_code={result.exit_code} "
                + f"output_complete={result.output_complete} "
                + f"incomplete_reason={result.incomplete_reason} "
                + f"output_path={result.output_path}\n{result.output}"
            )
        try:
            written_paths, skill_bodies = self._parse_shell_pull_output(result.output)
            self._record_pulled_paths(written_paths)
            for skill_key in self.config.mentioned_skill_keys:
                body = skill_bodies.get(skill_key)
                if body is None:
                    raise DifyDriveLayerError(f"missing pulled SKILL.md content for mentioned skill {skill_key}")
                self._loaded_skill_bodies[skill_key] = body
        except DifyDriveLayerError:
            if result.output_complete:
                raise
            raise DifyDriveLayerError(
                "drive mentioned pull output incomplete before required SKILL.md content was captured: "
                + f"reason={result.incomplete_reason} output_path={result.output_path}\n{result.output}"
            ) from None

    def _build_shell_pull_script(self, *, targets: list[tuple[str, bool]]) -> str:
        pull_targets = list(dict.fromkeys(prefix for prefix, _exact in targets))
        base_path = agent_stub_drive_base_for_ref(self.config.drive_ref)
        lines = [
            "set -eu",
            f"base={shlex.quote(base_path)}",
            "dify-agent drive pull " + " ".join(shlex.quote(target) for target in pull_targets) + ' --to "$base"',
        ]
        for skill_key in self.config.mentioned_skill_keys:
            skill_path = self._shell_local_path(skill_key)
            lines.extend(
                [
                    f"test -f {shlex.quote(skill_path)}",
                    f"printf '\\n__DIFY_DRIVE_MENTIONED_PATH__\\t%s\\t%s\\n' {shlex.quote(skill_key)} {shlex.quote(skill_path)}",
                    f"printf '__DIFY_DRIVE_SKILL_BEGIN__\\t%s\\n' {shlex.quote(skill_key)}",
                    f"cat {shlex.quote(skill_path)}",
                    f"printf '\\n__DIFY_DRIVE_SKILL_END__\\t%s\\n' {shlex.quote(skill_key)}",
                ]
            )
        for file_key in self.config.mentioned_file_keys:
            file_path = self._shell_local_path(file_key)
            lines.extend(
                [
                    f"test -e {shlex.quote(file_path)}",
                    f"printf '\\n__DIFY_DRIVE_MENTIONED_PATH__\\t%s\\t%s\\n' {shlex.quote(file_key)} {shlex.quote(file_path)}",
                ]
            )
        return "\n".join(lines)

    def _parse_shell_pull_output(self, output: str) -> tuple[dict[str, str], dict[str, str]]:
        written_paths: dict[str, str] = {}
        skill_bodies: dict[str, str] = {}
        current_skill_key: str | None = None
        current_skill_body: list[str] = []

        for line in output.splitlines(keepends=True):
            stripped_line = line.rstrip("\n")
            if current_skill_key is not None:
                if stripped_line == f"__DIFY_DRIVE_SKILL_END__\t{current_skill_key}":
                    skill_bodies[current_skill_key] = "".join(current_skill_body)
                    current_skill_key = None
                    current_skill_body = []
                    continue
                current_skill_body.append(line)
                continue

            if stripped_line.startswith("__DIFY_DRIVE_MENTIONED_PATH__\t"):
                parts = stripped_line.split("\t", 2)
                if len(parts) != 3:
                    raise DifyDriveLayerError("drive mentioned pull emitted an invalid path marker")
                _marker, key, path = parts
                written_paths[key] = path
                continue
            if stripped_line.startswith("__DIFY_DRIVE_SKILL_BEGIN__\t"):
                current_skill_key = stripped_line.split("\t", 1)[1]
                current_skill_body = []

        if current_skill_key is not None:
            raise DifyDriveLayerError(f"drive mentioned pull omitted SKILL.md end marker for {current_skill_key}")
        return written_paths, skill_bodies

    def _record_pulled_paths(self, written_paths: dict[str, str]) -> None:
        self._pulled_file_paths = written_paths
        for file_key in self.config.mentioned_file_keys:
            if file_key not in written_paths:
                raise DifyDriveLayerError(f"missing pulled file for mentioned drive key {file_key}")
        for skill_key in self.config.mentioned_skill_keys:
            if skill_key not in written_paths:
                raise DifyDriveLayerError(f"missing pulled SKILL.md for mentioned skill {skill_key}")

    def _mentioned_pull_targets(self) -> list[tuple[str, bool]]:
        return [(self._skill_prefix(skill_key), False) for skill_key in self.config.mentioned_skill_keys] + [
            (file_key, True) for file_key in self.config.mentioned_file_keys
        ]

    def _shell_local_path(self, drive_key: str) -> str:
        return f"{agent_stub_drive_base_for_ref(self.config.drive_ref).rstrip('/')}/{drive_key.lstrip('/')}"

    @staticmethod
    def _skill_prefix(skill_key: str) -> str:
        return f"{skill_key.rsplit('/', 1)[0]}/"


def _format_command_output(command: str, output: str) -> str:
    return f"Command:\n$ {command}\nOutput:\n{output}"


__all__ = ["DifyDriveLayer", "DifyDriveLayerError"]
