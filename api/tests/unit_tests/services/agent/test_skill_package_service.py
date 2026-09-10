"""Unit tests for the Skill package validator/normalizer (ENG-370)."""

from __future__ import annotations

import hashlib
import io
import zipfile
import zlib

import pytest

from services.agent.skill_package_service import NormalizedSkillPackage, SkillPackageError, SkillPackageService
from tests.unit_tests.config_override import apply_config_overrides

_SKILL_MD = """---
name: pdf-toolkit
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


def test_normalize_replaces_invalid_utf8_member_names() -> None:
    original = _zip(
        {
            "SKILL.md": _SKILL_MD.encode(),
            "scripts/\u00e9.py": b"print('keep payload')\n",
            "assets/\u00f6.txt": b"valid unicode name",
            "assets/X.txt": b"legacy encoded name",
        }
    )
    damaged = original.replace(b"\xc3\xa9.py", b"\xffa.py").replace(b"assets/X.txt", b"assets/\x82.txt")
    service = SkillPackageService()
    assert service.inspect(content=damaged, filename="skill.zip").name == "pdf-toolkit"
    normalized = service.validate_and_normalize(content=damaged, filename="skill.zip")
    with zipfile.ZipFile(io.BytesIO(normalized.archive_bytes)) as archive:
        assert archive.read("scripts/\ufffda.py") == b"print('keep payload')\n"
        assert archive.read("assets/\u00f6.txt") == b"valid unicode name"
        assert archive.read("assets/\u00e9.txt") == b"legacy encoded name"
        assert archive.testzip() is None


def test_normalize_recovers_zip64_skill_names(monkeypatch: pytest.MonkeyPatch) -> None:
    with monkeypatch.context() as scoped:
        scoped.setattr(zipfile, "ZIP64_LIMIT", 0)
        original = _zip({"SKILL.md": _SKILL_MD.encode(), "scripts/\u00e9.py": b"print('ok')\n"})
    damaged = original.replace(b"\xc3\xa9.py", b"\xffa.py")
    service = SkillPackageService()
    assert service.inspect(content=damaged, filename="skill.zip").name == "pdf-toolkit"
    normalized = service.validate_and_normalize(content=damaged, filename="skill.zip")
    with zipfile.ZipFile(io.BytesIO(normalized.archive_bytes)) as archive:
        assert archive.read("scripts/\ufffda.py") == b"print('ok')\n"


def test_replacement_member_names_must_remain_unique() -> None:
    original = _zip(
        {
            "SKILL.md": _SKILL_MD.encode(),
            "scripts/\u00e9.py": b"one",
            "scripts/\u00f6.py": b"two",
        }
    )
    damaged = original.replace(b"\xc3\xa9.py", b"\xffa.py").replace(b"\xc3\xb6.py", b"\xfea.py")
    with pytest.raises(SkillPackageError) as error:
        SkillPackageService().validate_and_normalize(content=damaged, filename="skill.zip")
    assert error.value.code == "duplicate_member_path"


def test_replacement_names_do_not_hide_local_header_mismatch() -> None:
    original = _zip({"SKILL.md": _SKILL_MD.encode(), "\u00e9.py": b"payload"})
    # Damage only the central name, leaving the local header unchanged.
    central = original.index(b"PK\x01\x02")
    damaged = original[:central] + original[central:].replace(b"\xc3\xa9.py", b"\xffa.py")
    with pytest.raises(SkillPackageError) as error:
        SkillPackageService().validate_and_normalize(content=damaged, filename="skill.zip")
    assert error.value.code == "invalid_archive"


def test_normalized_highly_compressible_skill_passes_reinspection() -> None:
    payload = b"x" * (1024 * 1024)
    content = _zip({"SKILL.md": _SKILL_MD.encode(), "data.bin": payload}, compression=zipfile.ZIP_STORED)
    service = SkillPackageService()
    normalized = service.validate_and_normalize(content=content, filename="skill.zip")
    inspection = service.inspect(content=normalized.archive_bytes, filename="skill.zip")
    assert inspection.name == normalized.manifest.name
    with zipfile.ZipFile(io.BytesIO(normalized.archive_bytes)) as archive:
        assert archive.getinfo("data.bin").compress_type == zipfile.ZIP_DEFLATED
        assert archive.read("data.bin") == payload


def test_valid_skill_normalizes_manifest():
    manifest = _normalize({"SKILL.md": _SKILL_MD.encode(), "scripts/run.py": b"print('hi')\n"}).manifest

    assert manifest.name == "pdf-toolkit"
    assert manifest.description == "Tools for working with PDF files."
    assert manifest.entry_path == "SKILL.md"
    assert set(manifest.files) == {"SKILL.md", "scripts/run.py"}
    assert manifest.size > 0
    assert len(manifest.hash) == 64


def test_validate_and_normalize_accepts_crlf_skill_md():
    crlf_skill_md = _SKILL_MD.replace("\n", "\r\n")
    package = _normalize({"SKILL.md": crlf_skill_md.encode()})

    assert package.manifest.name == "pdf-toolkit"
    assert package.manifest.description == "Tools for working with PDF files."
    with zipfile.ZipFile(io.BytesIO(package.archive_bytes)) as archive:
        assert b"\r" not in archive.read("SKILL.md")
        assert archive.read("SKILL.md").decode() == _SKILL_MD


def test_inspect_reports_uncompressed_size_without_rebuilding(monkeypatch: pytest.MonkeyPatch):
    members = {"SKILL.md": _SKILL_MD.encode(), "scripts/run.py": b"print('hi')\n"}

    def fail_if_called(*_args: object, **_kwargs: object) -> bytes:
        raise AssertionError("inspection must not rebuild the archive")

    monkeypatch.setattr(SkillPackageService, "_build_normalized_archive", fail_if_called)

    inspection = SkillPackageService().inspect(content=_zip(members), filename="skill.zip")

    assert inspection.name == "pdf-toolkit"
    assert inspection.uncompressed_size == sum(len(content) for content in members.values())


@pytest.mark.parametrize("prefix", ["", "pdf-toolkit/"])
@pytest.mark.parametrize("crlf", [False, True])
def test_inspection_and_normalization_keep_distinct_size_meanings(prefix: str, crlf: bool) -> None:
    skill_md = _SKILL_MD.replace("\n", "\r\n") if crlf else _SKILL_MD
    script = b"print('hi')\n"
    members = {f"{prefix}SKILL.md": skill_md.encode(), f"{prefix}scripts/run.py": script}
    if prefix:
        members["README.md"] = b"ignored outside the selected root"
    content = _zip(members)
    service = SkillPackageService()
    inspection = service.inspect(content=content, filename="skill.zip")
    normalized = service.validate_and_normalize(content=content, filename="skill.zip")
    assert inspection.uncompressed_size == sum(len(value) for value in members.values())
    expected_size = len(_SKILL_MD.encode()) + len(script)
    assert normalized.manifest.size == expected_size
    with zipfile.ZipFile(io.BytesIO(normalized.archive_bytes)) as archive:
        assert sum(info.file_size for info in archive.infolist()) == expected_size
    if prefix or crlf:
        assert inspection.uncompressed_size > normalized.manifest.size


def test_name_and_description_are_required_in_frontmatter():
    with pytest.raises(SkillPackageError) as exc_info:
        _normalize({"SKILL.md": b"# heading-name\n\nbody"})
    assert exc_info.value.code == "missing_skill_name"


def test_shallowest_skill_md_preferred_during_normalization():
    manifest = _normalize({"SKILL.md": _SKILL_MD.encode(), "nested/SKILL.md": _SKILL_MD.encode()}).manifest
    assert manifest.entry_path == "SKILL.md"
    assert manifest.files == ["SKILL.md", "nested/SKILL.md"]


@pytest.mark.parametrize(
    ("prefix", "extra_members"),
    [
        pytest.param("", {}, id="root"),
        pytest.param("pdf-toolkit/", {}, id="single-folder"),
        pytest.param("pdf-toolkit/", {"README.md": b"bundle notes\n"}, id="root-outsider"),
        pytest.param("pdf-toolkit/", {"bundle/other.txt": b"x"}, id="nested-outsider"),
        pytest.param("bundle/pdf-toolkit/", {}, id="deep-root"),
    ],
)
def test_normalization_preserves_selected_skill_contents(prefix: str, extra_members: dict[str, bytes]) -> None:
    expected = {"SKILL.md": _SKILL_MD.encode(), "scripts/run.py": b"print('hi')\n"}
    original = _zip({**{prefix + path: content for path, content in expected.items()}, **extra_members})
    package = SkillPackageService().validate_and_normalize(content=original, filename="skill.zip")

    assert package.manifest.entry_path == "SKILL.md"
    assert package.manifest.files == sorted(expected)
    with zipfile.ZipFile(io.BytesIO(package.archive_bytes)) as archive:
        assert archive.namelist() == sorted(expected)
        assert {path: archive.read(path) for path in archive.namelist()} == expected
    assert package.manifest.hash == hashlib.sha256(package.archive_bytes).hexdigest()
    if prefix:
        assert package.manifest.hash != hashlib.sha256(original).hexdigest()


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


@pytest.mark.parametrize(
    ("members", "filename", "code"),
    [
        ({"README.md": b"x"}, "skill.zip", "missing_skill_md"),
        ({"SKILL.md": _SKILL_MD.encode()}, "skill.tar", "unsupported_extension"),
        ({"SKILL.md": b""}, "skill.zip", "empty_skill_md"),
        ({"SKILL.md": b"---\ndescription: valid\n---\n# no name here"}, "skill.zip", "missing_skill_name"),
        ({"SKILL.md": b"---\nname: pdf-toolkit\n---\n# no description"}, "skill.zip", "missing_skill_description"),
        (
            {"SKILL.md": b"---\nname: PDF Toolkit\ndescription: valid\n---\n# invalid name"},
            "skill.zip",
            "invalid_skill_name",
        ),
        (
            {"SKILL.md": f"---\nname: pdf-toolkit\ndescription: {'x' * 1025}\n---\n# long".encode()},
            "skill.zip",
            "invalid_skill_description",
        ),
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
    apply_config_overrides(monkeypatch, SKILL_PACKAGE_MAX_SKILL_MD_BYTES=8)

    with pytest.raises(SkillPackageError) as exc_info:
        _normalize({"SKILL.md": _SKILL_MD.encode()})
    assert exc_info.value.code == "skill_md_too_large"


def test_validate_and_normalize_rejects_too_many_entries(monkeypatch: pytest.MonkeyPatch):
    apply_config_overrides(monkeypatch, SKILL_PACKAGE_MAX_ENTRIES=1)

    with pytest.raises(SkillPackageError) as exc_info:
        _normalize({"SKILL.md": _SKILL_MD.encode(), "assets/": b""})
    assert exc_info.value.code == "too_many_entries"


def test_validate_and_normalize_rejects_archive_too_large_uncompressed(monkeypatch: pytest.MonkeyPatch):
    apply_config_overrides(monkeypatch, SKILL_PACKAGE_MAX_UNCOMPRESSED_BYTES=32)

    with pytest.raises(SkillPackageError) as exc_info:
        _normalize({"SKILL.md": _SKILL_MD.encode(), "scripts/run.py": b"x" * 33})
    assert exc_info.value.code == "archive_too_large"


def test_validate_and_normalize_rejects_archive_too_large_uploaded_bytes(monkeypatch: pytest.MonkeyPatch):
    apply_config_overrides(monkeypatch, UPLOAD_SKILL_FILE_SIZE_LIMIT=1)

    with pytest.raises(SkillPackageError) as exc_info:
        SkillPackageService().validate_and_normalize(content=b"x" * (1024 * 1024 + 1), filename="skill.zip")
    assert exc_info.value.code == "archive_too_large"


def test_high_compression_ratio_uses_absolute_expansion_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    content = _zip({"SKILL.md": _SKILL_MD.encode(), "data.bin": b"x" * (1024 * 1024)})
    service = SkillPackageService()
    assert service.inspect(content=content, filename="skill.zip").name == "pdf-toolkit"
    apply_config_overrides(monkeypatch, SKILL_PACKAGE_MAX_UNCOMPRESSED_BYTES=1024)
    with pytest.raises(SkillPackageError) as exc_info:
        service.inspect(content=content, filename="skill.zip")
    assert exc_info.value.code == "archive_too_large"


def test_bad_frontmatter_yaml_rejected():
    bad = b"---\n: : : not yaml\n---\n# x\n"
    with pytest.raises(SkillPackageError) as exc_info:
        _normalize({"SKILL.md": bad})
    assert exc_info.value.code == "invalid_frontmatter"


def test_unterminated_frontmatter_rejected():
    with pytest.raises(SkillPackageError) as exc_info:
        _normalize({"SKILL.md": b"---\n# heading-wins\nbody"})
    assert exc_info.value.code == "missing_skill_name"


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
