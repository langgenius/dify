"""Runtime Dify config layer with shell-backed eager pulls."""

from __future__ import annotations

import json
import shlex
from dataclasses import dataclass, field
from typing import ClassVar

from typing_extensions import Self, override

from agenton.layers import EmptyRuntimeState, LayerDeps, PlainLayer
from dify_agent.layers.config.configs import DIFY_CONFIG_LAYER_TYPE_ID, DifyConfigLayerConfig
from dify_agent.layers.shell.layer import DifyShellLayer

_CONFIG_BASE_PATH = "/tmp/dify-config"
_CONFIG_CLI_USAGE_PROMPT = """Agent config CLI usage is available inside shell jobs:

- Show the current config manifest: `dify-agent config manifest`
- Pull config skills: `dify-agent config skill pull [NAME ...]`
- Pull config files: `dify-agent config file pull [NAME ...]`
- Export config env variables: `dify-agent config env pull`
- Export the config note: `dify-agent config note pull`"""
_CONFIG_CLI_PUSH_PROMPT = "- Update the current build-draft config: `dify-agent config push [--from PATH]`"


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
        await self._pull_mentioned_targets()

    @override
    async def on_context_resume(self) -> None:
        await self._pull_mentioned_targets()

    def build_prompt_context(self) -> str:
        sections: list[str] = []
        if self.config.note.strip():
            sections.append(f"Config note:\n{self.config.note}")

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
        remaining_skills = [
            f"- {skill.name}: {skill.description}"
            for skill in self.config.skills
            if skill.name not in set(self.config.mentioned_skill_names)
        ]
        if remaining_skills:
            sections.append("Other available skills:\n" + "\n".join(remaining_skills))
        remaining_files = [
            f"- {file.name}" for file in self.config.files if file.name not in set(self.config.mentioned_file_names)
        ]
        if remaining_files:
            sections.append("Available files:\n" + "\n".join(remaining_files))
        if self.config.env_keys:
            sections.append("Available env keys:\n" + "\n".join(f"- {key}" for key in self.config.env_keys))
        usage_lines = [_CONFIG_CLI_USAGE_PROMPT]
        if self.config.writable:
            usage_lines.append(_CONFIG_CLI_PUSH_PROMPT)
        sections.append("\n".join(usage_lines))
        return "\n\n".join(section for section in sections if section)

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
            raise DifyConfigLayerError(
                f"config mentioned pull output was incomplete before the payload finished: {reason}"
            )

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
