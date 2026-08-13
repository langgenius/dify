"""Build deterministic Config fixtures for the dedicated Staging benchmark Agent."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile

from benchmarks.e2b_config_stub import fixed_payload
from benchmarks.staging_plugin.models.llm.contract import (
    CONFIG_FILE_COUNT,
    CONFIG_ITEM_BYTES,
    CONFIG_SKILL_COUNT,
)


_SKILL_DESCRIPTION = "Deterministic Skill fixture for the Dify Agent Staging Config benchmark."
_SKILL_PADDING_PREFIX = "<!-- deterministic-padding:"
_SKILL_PADDING_SUFFIX = "-->\n"


def build_staging_config_fixtures(output_dir: Path) -> dict[str, object]:
    """Create uploadable fixtures and return their materialization oracle."""
    if output_dir.exists() and any(output_dir.iterdir()):
        raise FileExistsError(f"fixture output directory is not empty: {output_dir}")
    skills_dir = output_dir / "skills"
    files_dir = output_dir / "files"
    skills_dir.mkdir(parents=True, exist_ok=True)
    files_dir.mkdir(parents=True, exist_ok=True)
    materialized: list[tuple[str, bytes]] = []
    skills: list[dict[str, object]] = []
    files: list[dict[str, object]] = []
    for index in range(CONFIG_SKILL_COUNT):
        name = f"benchmark-skill-{index}"
        markdown = _skill_markdown(name)
        archive = _skill_archive(name, markdown)
        archive_path = skills_dir / f"{name}.zip"
        archive_path.write_bytes(archive)
        relative_path = f".dify_conf/skills/{name}/SKILL.md"
        materialized.append((relative_path, markdown))
        skills.append(
            {
                "name": name,
                "upload_path": str(archive_path.relative_to(output_dir)),
                "archive_bytes": len(archive),
                "materialized_bytes": len(markdown),
                "materialized_sha256": hashlib.sha256(markdown).hexdigest(),
            }
        )
    for index in range(CONFIG_FILE_COUNT):
        name = f"benchmark-file-{index}.bin"
        content = fixed_payload(f"staging-config-file:{name}", CONFIG_ITEM_BYTES)
        file_path = files_dir / name
        file_path.write_bytes(content)
        relative_path = f".dify_conf/files/{name}"
        materialized.append((relative_path, content))
        files.append(
            {
                "name": name,
                "upload_path": str(file_path.relative_to(output_dir)),
                "materialized_bytes": len(content),
                "materialized_sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    manifest: dict[str, object] = {
        "schema_version": 1,
        "skill_count": CONFIG_SKILL_COUNT,
        "file_count": CONFIG_FILE_COUNT,
        "materialized_total_bytes": sum(len(content) for _, content in materialized),
        "config_expected_sha256": materialization_sha256(materialized),
        "skills": skills,
        "files": files,
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def materialization_sha256(entries: list[tuple[str, bytes]]) -> str:
    """Hash paths, lengths, and bytes exactly like the Config scenario shell oracle."""
    digest = hashlib.sha256()
    for relative_path, content in entries:
        digest.update(relative_path.encode())
        digest.update(b"\0")
        digest.update(len(content).to_bytes(8, "big"))
        digest.update(content)
    return digest.hexdigest()


def _skill_markdown(name: str) -> bytes:
    prefix = (
        "---\n"
        f"name: {name}\n"
        f"description: {_SKILL_DESCRIPTION}\n"
        "---\n\n"
        f"# {name}\n\n"
        "This package is generated only for deterministic Config materialization benchmarks.\n\n"
        f"{_SKILL_PADDING_PREFIX}"
    )
    padding_bytes = CONFIG_ITEM_BYTES - len(prefix.encode()) - len(_SKILL_PADDING_SUFFIX.encode())
    if padding_bytes < 1:
        raise ValueError("Config item size is too small for the deterministic Skill document")
    markdown = f"{prefix}{'x' * padding_bytes}{_SKILL_PADDING_SUFFIX}".encode()
    if len(markdown) != CONFIG_ITEM_BYTES:
        raise AssertionError("generated Skill document does not match the configured item size")
    return markdown


def _skill_archive(name: str, markdown: bytes) -> bytes:
    buffer = io.BytesIO()
    # Keep the canonical Skill directory in the archive so the frontmatter name
    # also matches the directory containing SKILL.md, as required by the Agent
    # Skills specification. Dify normalizes this single top-level directory on
    # upload.
    info = zipfile.ZipInfo(f"{name}/SKILL.md", date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = 0o644 << 16
    with zipfile.ZipFile(buffer, mode="w") as archive:
        archive.writestr(info, markdown)
    return buffer.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = build_staging_config_fixtures(args.output)
    print(args.output / "manifest.json")
    print(f"config_expected_sha256={manifest['config_expected_sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = ["build_staging_config_fixtures", "materialization_sha256"]
