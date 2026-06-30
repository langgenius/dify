"""Unit tests for the Skill package validator/normalizer (ENG-370)."""

from __future__ import annotations

import hashlib
import io
import zipfile
import zlib

import pytest

from services.agent import skill_package_service as skill_package_service_module
from services.agent.skill_package_service import NormalizedSkillPackage, SkillPackageError, SkillPackageService

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


def _normalize(members: dict[str, bytes], *, filename: str = "skill.zip") -> NormalizedSkillPackage:
    return SkillPackageService().validate_and_normalize(content=_zip(members), filename=filename)


def _archive_members(content: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        return sorted(info.filename for info in archive.infolist() if not info.is_dir())


def test_valid_skill_normalizes_manifest():
    manifest = _normalize({"SKILL.md": _SKILL_MD.encode(), "scripts/run.py": b"print('hi')\n"}).manifest

    assert manifest.name == "PDF Toolkit"
    assert manifest.description == "Tools for working with PDF files."
    assert manifest.entry_path == "SKILL.md"
    assert set(manifest.files) == {"SKILL.md", "scripts/run.py"}
    assert manifest.size > 0
    assert len(manifest.hash) == 64


def test_name_falls_back_to_heading_without_frontmatter():
    manifest = _normalize({"SKILL.md": b"# Heading Name\n\nbody"}).manifest
    assert manifest.name == "Heading Name"
    assert manifest.description == ""


def test_shallowest_skill_md_preferred_during_normalization():
    manifest = _normalize({"SKILL.md": _SKILL_MD.encode(), "nested/SKILL.md": _SKILL_MD.encode()}).manifest
    assert manifest.entry_path == "SKILL.md"
    assert manifest.files == ["SKILL.md", "nested/SKILL.md"]


def test_validate_and_normalize_keeps_root_skill_unchanged():
    package = _normalize({"SKILL.md": _SKILL_MD.encode(), "scripts/run.py": b"print('hi')\n"})

    assert package.manifest.entry_path == "SKILL.md"
    assert package.manifest.files == ["SKILL.md", "scripts/run.py"]
    assert package.skill_md_bytes == _SKILL_MD.encode()
    assert package.strip_prefix is None
    assert _archive_members(package.archive_bytes) == ["SKILL.md", "scripts/run.py"]
    assert len(package.manifest.hash) == 64


def test_validate_and_normalize_strips_single_top_level_folder():
    package = _normalize(
        {
            "pdf-toolkit/SKILL.md": _SKILL_MD.encode(),
            "pdf-toolkit/scripts/run.py": b"print('hi')\n",
        }
    )

    assert package.manifest.entry_path == "SKILL.md"
    assert package.manifest.files == ["SKILL.md", "scripts/run.py"]
    assert package.skill_md_bytes == _SKILL_MD.encode()
    assert package.strip_prefix == "pdf-toolkit/"
    assert _archive_members(package.archive_bytes) == ["SKILL.md", "scripts/run.py"]


def test_validate_and_normalize_strips_single_top_level_folder_ignoring_other_root_entries():
    package = _normalize(
        {
            "pdf-toolkit/SKILL.md": _SKILL_MD.encode(),
            "pdf-toolkit/scripts/run.py": b"print('hi')\n",
            "README.md": b"bundle notes\n",
        }
    )

    assert package.manifest.entry_path == "SKILL.md"
    assert package.manifest.files == ["SKILL.md", "scripts/run.py"]
    assert package.skill_md_bytes == _SKILL_MD.encode()
    assert package.strip_prefix == "pdf-toolkit/"
    assert _archive_members(package.archive_bytes) == ["SKILL.md", "scripts/run.py"]


def test_validate_and_normalize_strips_single_top_level_folder_dropping_nested_foreign_paths():
    package = _normalize(
        {
            "pdf-toolkit/SKILL.md": _SKILL_MD.encode(),
            "pdf-toolkit/scripts/run.py": b"print('hi')\n",
            "bundle/other.txt": b"x",
        }
    )

    assert package.manifest.entry_path == "SKILL.md"
    assert package.manifest.files == ["SKILL.md", "scripts/run.py"]
    assert package.skill_md_bytes == _SKILL_MD.encode()
    assert package.strip_prefix == "pdf-toolkit/"
    assert _archive_members(package.archive_bytes) == ["SKILL.md", "scripts/run.py"]


def test_validate_and_normalize_rejects_multiple_depth_2_skill_roots_with_sibling_skill_tree():
    with pytest.raises(SkillPackageError) as exc_info:
        _normalize(
            {
                "pdf-toolkit/SKILL.md": _SKILL_MD.encode(),
                "pdf-toolkit/scripts/run.py": b"print('hi')\n",
                "other-tool/SKILL.md": _SKILL_MD.encode(),
            }
        )
    assert exc_info.value.code == "files_outside_skill_root"


def test_validate_and_normalize_strips_deeper_selected_skill_root():
    members = {
        "bundle/pdf-toolkit/SKILL.md": _SKILL_MD.encode(),
        "bundle/pdf-toolkit/scripts/run.py": b"print('hi')\n",
    }
    original_upload_bytes = _zip(members)
    package = SkillPackageService().validate_and_normalize(content=original_upload_bytes, filename="skill.zip")

    assert package.manifest.entry_path == "SKILL.md"
    assert package.manifest.files == ["SKILL.md", "scripts/run.py"]
    assert package.strip_prefix == "bundle/pdf-toolkit/"
    assert _archive_members(package.archive_bytes) == ["SKILL.md", "scripts/run.py"]
    assert package.manifest.hash == hashlib.sha256(package.archive_bytes).hexdigest()
    assert package.manifest.hash != hashlib.sha256(original_upload_bytes).hexdigest()


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
        _normalize(members, filename=filename)
    assert exc_info.value.code == code
    assert exc_info.value.status_code == 400


def test_non_zip_content_rejected():
    with pytest.raises(SkillPackageError) as exc_info:
        SkillPackageService().validate_and_normalize(content=b"not a zip", filename="skill.zip")
    assert exc_info.value.code == "invalid_archive"


def test_zip_slip_member_rejected():
    payload = _zip({"../evil.txt": b"x", "SKILL.md": _SKILL_MD.encode()})
    with pytest.raises(SkillPackageError) as exc_info:
        SkillPackageService().validate_and_normalize(content=payload, filename="skill.zip")
    assert exc_info.value.code == "unsafe_path"


def test_empty_archive_rejected():
    with pytest.raises(SkillPackageError) as exc_info:
        SkillPackageService().validate_and_normalize(content=b"", filename="skill.zip")
    assert exc_info.value.code == "empty_archive"


def test_validate_and_normalize_rejects_skill_md_too_large(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(skill_package_service_module, "_MAX_SKILL_MD_BYTES", 8)

    with pytest.raises(SkillPackageError) as exc_info:
        _normalize({"SKILL.md": _SKILL_MD.encode()})
    assert exc_info.value.code == "skill_md_too_large"


def test_validate_and_normalize_rejects_too_many_entries(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(skill_package_service_module, "_MAX_ENTRIES", 1)

    with pytest.raises(SkillPackageError) as exc_info:
        _normalize({"SKILL.md": _SKILL_MD.encode(), "scripts/run.py": b"print('x')\n"})
    assert exc_info.value.code == "too_many_entries"


def test_validate_and_normalize_rejects_archive_too_large_uncompressed(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(skill_package_service_module, "_MAX_UNCOMPRESSED_BYTES", 32)

    with pytest.raises(SkillPackageError) as exc_info:
        _normalize({"SKILL.md": _SKILL_MD.encode(), "scripts/run.py": b"x" * 33})
    assert exc_info.value.code == "archive_too_large"


def test_validate_and_normalize_rejects_archive_too_large_uploaded_bytes(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(skill_package_service_module, "_MAX_ARCHIVE_BYTES", 8)

    with pytest.raises(SkillPackageError) as exc_info:
        SkillPackageService().validate_and_normalize(content=b"x" * 9, filename="skill.zip")
    assert exc_info.value.code == "archive_too_large"


def test_bad_frontmatter_yaml_rejected():
    bad = b"---\n: : : not yaml\n---\n# x\n"
    with pytest.raises(SkillPackageError) as exc_info:
        _normalize({"SKILL.md": bad})
    assert exc_info.value.code == "invalid_frontmatter"


def test_unterminated_frontmatter_falls_back_to_heading():
    # leading '---' with no closing fence -> no frontmatter, use the heading
    manifest = _normalize({"SKILL.md": b"---\n# Heading Wins\nbody"}).manifest
    assert manifest.name == "Heading Wins"


def test_validate_and_normalize_rejects_files_outside_selected_skill_root():
    with pytest.raises(SkillPackageError) as exc_info:
        _normalize({"bundle/pdf-toolkit/SKILL.md": _SKILL_MD.encode(), "README.md": b"x"})
    assert exc_info.value.code == "files_outside_skill_root"


def test_validate_and_normalize_rejects_duplicate_normalized_paths():
    with pytest.raises(SkillPackageError) as exc_info:
        _normalize(
            {
                "pdf-toolkit/SKILL.md": _SKILL_MD.encode(),
                "pdf-toolkit/scripts/run.py": b"print('x')\n",
                "pdf-toolkit/scripts/./run.py": b"print('y')\n",
            }
        )
    assert exc_info.value.code == "duplicate_member_path"


def test_validate_and_normalize_maps_member_decompression_failures_to_invalid_archive(monkeypatch: pytest.MonkeyPatch):
    original_read = zipfile.ZipFile.read

    def corrupted_read(self: zipfile.ZipFile, member: str | zipfile.ZipInfo, *args: object, **kwargs: object) -> bytes:
        filename = member.filename if isinstance(member, zipfile.ZipInfo) else member
        if filename == "scripts/run.py":
            raise zlib.error("invalid distance too far back")
        return original_read(self, member, *args, **kwargs)

    monkeypatch.setattr(zipfile.ZipFile, "read", corrupted_read)

    with pytest.raises(SkillPackageError) as exc_info:
        _normalize({"SKILL.md": _SKILL_MD.encode(), "scripts/run.py": b"print('x')\n"})
    assert exc_info.value.code == "invalid_archive"
    assert exc_info.value.message == "skill archive is not a valid zip"
