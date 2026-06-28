"""Runtime Dify drive layer with shell-backed eager pulls.

The API backend sends the full drive skill catalog plus the ordered drive keys
mentioned in the prompt. When the layer enters a run context it eagerly pulls
those mentioned skills/files through the already-active shell layer by running
the sandbox-visible ``dify-agent drive pull`` command, then contributes a
concise prompt block describing what was loaded. It also contributes a suffix
prompt with the remaining skill catalog plus ``dify-agent drive`` and
``dify-agent file`` usage so the model has concrete Agent Stub commands for
materializing drive content and workflow files.
"""

from __future__ import annotations

import shlex
from dataclasses import dataclass, field
from pathlib import Path
from typing import ClassVar

from typing_extensions import Self, override

from agenton.layers import EmptyRuntimeState, LayerDeps, PlainLayer
from dify_agent.agent_stub.protocol import agent_stub_drive_base_for_ref
from dify_agent.layers.drive.configs import DIFY_DRIVE_LAYER_TYPE_ID, DifyDriveLayerConfig
from dify_agent.layers.shell.layer import DifyShellLayer

_AGENT_STUB_CLI_USAGE_PROMPT = """Agent Stub CLI usage is available inside shell jobs:

Drive assets are Agent Soul versioned assets:

- List drive assets: `dify-agent drive list [REMOTE_PREFIX]`
- Pull drive assets: `dify-agent drive pull [REMOTE ...] [--to LOCAL_DIR]`
  With no remote, pulls the whole visible drive. Pull overwrites local files.
  Defaults to `$DIFY_AGENT_STUB_DRIVE_BASE`; use `--to .` for cwd.
  `--to` is a local root; remote keys keep their path under it.
  Skill archives are automatically extracted after pull.
- Push one file: `dify-agent drive push LOCAL_FILE REMOTE_PATH`
- Push a skill package: `dify-agent drive push LOCAL_DIR REMOTE_PATH --kind skill`
- Push a raw directory: `dify-agent drive push LOCAL_DIR REMOTE_PATH --kind dir`

Workflow file mappings:

- Download a mapping: `dify-agent file download TRANSFER_METHOD REFERENCE_OR_URL [--to LOCAL_DIR]`
- Or pass a mapping object: `dify-agent file download --mapping '{"transfer_method":"tool_file","reference":"..."}'`
- Upload an output file: `dify-agent file upload PATH`
  Prints JSON like `{"transfer_method":"tool_file","reference":"..."}`."""


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
        await self._pull_mentioned_targets()

    @override
    async def on_context_resume(self) -> None:
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
            pull_and_read_command = (
                '`skill_dir="$(dify-agent drive pull <SKILL_PATH> --to /tmp/drive)"; '
                + 'printf "%s\\n" "$skill_dir"; cat "$skill_dir/SKILL.md"`'
            )
            sections.append(
                "Other available skills:\n"
                + "\n".join(other_skills)
                + "\n\nTo use one, pull it and read its SKILL.md in one command: "
                + pull_and_read_command
                + "."
            )
        sections.append(_AGENT_STUB_CLI_USAGE_PROMPT)
        return "\n\n".join(sections)

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


__all__ = ["DifyDriveLayer", "DifyDriveLayerError"]
