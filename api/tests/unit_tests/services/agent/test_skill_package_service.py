"""Unit tests for the Skill package validator/extractor (ENG-370)."""

from __future__ import annotations

import io
import zipfile

import pytest

from services.agent.skill_package_service import SkillPackageError, SkillPackageService

_SKILL_MD = """---
name: PDF Toolkit
description: Tools for working with PDF files.
---

# PDF Toolkit

Do things with PDFs.
"""


def _zip(members: dict[str, bytes], *, compression: int = zipfile.ZIP_DEFLATED) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=compression) as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return buffer.getvalue()


def _extract(members: dict[str, bytes], *, filename: str = "skill.zip"):
    return SkillPackageService().validate_and_extract(content=_zip(members), filename=filename)


def test_valid_skill_extracts_manifest():
    manifest = _extract({"SKILL.md": _SKILL_MD.encode(), "scripts/run.py": b"print('hi')\n"})

    assert manifest.name == "PDF Toolkit"
    assert manifest.description == "Tools for working with PDF files."
    assert manifest.entry_path == "SKILL.md"
    assert set(manifest.files) == {"SKILL.md", "scripts/run.py"}
    assert manifest.size > 0
    assert len(manifest.hash) == 64


def test_name_falls_back_to_heading_without_frontmatter():
    manifest = _extract({"SKILL.md": b"# Heading Name\n\nbody"})
    assert manifest.name == "Heading Name"
    assert manifest.description == ""


def test_nested_skill_md_is_found():
    manifest = _extract({"pdf-toolkit/SKILL.md": _SKILL_MD.encode()})
    assert manifest.entry_path == "pdf-toolkit/SKILL.md"


def test_shallowest_skill_md_preferred():
    manifest = _extract({"SKILL.md": _SKILL_MD.encode(), "nested/SKILL.md": _SKILL_MD.encode()})
    assert manifest.entry_path == "SKILL.md"


@pytest.mark.parametrize(
    ("members", "filename", "code"),
    [
        ({"README.md": b"x"}, "skill.zip", "missing_skill_md"),
        ({"SKILL.md": _SKILL_MD.encode()}, "skill.tar", "unsupported_extension"),
        ({"SKILL.md": b""}, "skill.zip", "empty_skill_md"),
        ({"SKILL.md": b"no name here"}, "skill.zip", "missing_skill_name"),
        ({"SKILL.md": b"\xff\xfenot utf8"}, "skill.zip", "skill_md_not_utf8"),
    ],
)
def test_invalid_packages_rejected(members: dict[str, bytes], filename: str, code: str):
    with pytest.raises(SkillPackageError) as exc_info:
        _extract(members, filename=filename)
    assert exc_info.value.code == code
    assert exc_info.value.status_code == 400


def test_non_zip_content_rejected():
    with pytest.raises(SkillPackageError) as exc_info:
        SkillPackageService().validate_and_extract(content=b"not a zip", filename="skill.zip")
    assert exc_info.value.code == "invalid_archive"


def test_zip_slip_member_rejected():
    payload = _zip({"../evil.txt": b"x", "SKILL.md": _SKILL_MD.encode()})
    with pytest.raises(SkillPackageError) as exc_info:
        SkillPackageService().validate_and_extract(content=payload, filename="skill.zip")
    assert exc_info.value.code == "unsafe_path"


def test_empty_archive_rejected():
    with pytest.raises(SkillPackageError) as exc_info:
        SkillPackageService().validate_and_extract(content=b"", filename="skill.zip")
    assert exc_info.value.code == "empty_archive"


def test_bad_frontmatter_yaml_rejected():
    bad = b"---\n: : : not yaml\n---\n# x\n"
    with pytest.raises(SkillPackageError) as exc_info:
        _extract({"SKILL.md": bad})
    assert exc_info.value.code == "invalid_frontmatter"


def test_unterminated_frontmatter_falls_back_to_heading():
    # leading '---' with no closing fence -> no frontmatter, use the heading
    manifest = _extract({"SKILL.md": b"---\n# Heading Wins\nbody"})
    assert manifest.name == "Heading Wins"


def test_read_member_bytes_roundtrip_and_errors():
    service = SkillPackageService()
    payload = _zip({"SKILL.md": _SKILL_MD.encode(), "scripts/run.py": b"print('x')\n"})

    assert service.read_member_bytes(content=payload, member_path="scripts/run.py") == b"print('x')\n"

    with pytest.raises(SkillPackageError) as missing:
        service.read_member_bytes(content=payload, member_path="nope.txt")
    assert missing.value.code == "member_not_found"

    with pytest.raises(SkillPackageError) as bad_zip:
        service.read_member_bytes(content=b"not a zip", member_path="SKILL.md")
    assert bad_zip.value.code == "invalid_archive"


def test_to_skill_ref_carries_metadata():
    manifest = _extract({"SKILL.md": _SKILL_MD.encode()})
    ref = manifest.to_skill_ref(file_id="upload-1", path="pdf-toolkit/.DIFY-SKILL-FULL.zip")

    assert ref.name == "PDF Toolkit"
    assert ref.file_id == "upload-1"
    assert ref.path == "pdf-toolkit/.DIFY-SKILL-FULL.zip"
    assert ref.id == manifest.hash
    dumped = ref.model_dump()
    assert dumped["hash"] == manifest.hash
    assert dumped["entry_path"] == "SKILL.md"
