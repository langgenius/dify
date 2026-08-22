from __future__ import annotations

import json
from pathlib import Path
import zipfile

import pytest

from benchmarks.staging_fixtures import build_staging_config_fixtures


def test_fixture_bundle_has_exact_staging_config_shape_and_sizes(tmp_path: Path) -> None:
    output_dir = tmp_path / "fixtures"

    manifest = build_staging_config_fixtures(output_dir)

    assert manifest["skill_count"] == 3
    assert manifest["file_count"] == 10
    assert manifest["materialized_total_bytes"] == 13 * 4096
    assert len(str(manifest["config_expected_sha256"])) == 64
    persisted = json.loads((output_dir / "manifest.json").read_text())
    assert persisted == manifest
    skills = manifest["skills"]
    files = manifest["files"]
    assert isinstance(skills, list)
    assert isinstance(files, list)
    assert len(skills) == 3
    assert len(files) == 10
    for skill in skills:
        assert isinstance(skill, dict)
        name = str(skill["name"])
        with zipfile.ZipFile(output_dir / str(skill["upload_path"])) as archive:
            assert archive.namelist() == [f"{name}/SKILL.md"]
            markdown = archive.read(f"{name}/SKILL.md")
        assert len(markdown) == 4096
        content = markdown.decode("utf-8")
        assert content.startswith(f"---\nname: {name}\n")
        assert "\ndescription: Deterministic Skill fixture" in content
        assert f"\n---\n\n# {name}\n" in content
    assert all((output_dir / str(item["upload_path"])).stat().st_size == 4096 for item in files)


def test_fixture_skill_packages_are_byte_deterministic(tmp_path: Path) -> None:
    first_output = tmp_path / "first"
    second_output = tmp_path / "second"

    first = build_staging_config_fixtures(first_output)
    second = build_staging_config_fixtures(second_output)

    assert first == second
    for index in range(3):
        relative_path = Path("skills") / f"benchmark-skill-{index}.zip"
        assert (first_output / relative_path).read_bytes() == (second_output / relative_path).read_bytes()


def test_fixture_builder_refuses_to_overwrite_existing_directory(tmp_path: Path) -> None:
    output_dir = tmp_path / "fixtures"
    output_dir.mkdir()
    (output_dir / "user-data").write_text("preserve")

    with pytest.raises(FileExistsError):
        build_staging_config_fixtures(output_dir)

    assert (output_dir / "user-data").read_text() == "preserve"
