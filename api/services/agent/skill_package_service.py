"""Validate + extract metadata from an uploaded Skill package (ENG-370).

A Skill is a ``.zip`` / ``.skill`` archive that must contain a ``SKILL.md`` entry
file (Anthropic Skills convention: YAML frontmatter with ``name`` + ``description``,
followed by markdown instructions). This service validates the archive (extension,
size, zip integrity, zip-slip safety, SKILL.md presence/encoding/fields) and
extracts a manifest consumed by drive standardization.

It does NOT execute or load the skill — the agent backend owns execution. It also
does not persist anything into Agent Soul or bind anything to config versions;
``SkillStandardizeService`` consumes the manifest and commits the canonical drive
rows instead.
"""

from __future__ import annotations

import hashlib
import io
import posixpath
import re
import zipfile

import yaml
from pydantic import BaseModel

# Bounds — generous but finite so a hostile upload can't exhaust memory/disk.
_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
_MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024
_MAX_SKILL_MD_BYTES = 1 * 1024 * 1024
_MAX_ENTRIES = 5000
_ALLOWED_EXTENSIONS = (".zip", ".skill")
_SKILL_MD_NAME = "SKILL.md"
_HEADING_RE = re.compile(r"^\s*#\s+(.+?)\s*$", re.MULTILINE)


class SkillPackageError(Exception):
    """A skill-package validation failure mapped to an HTTP status by the controller."""

    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class SkillManifest(BaseModel):
    """Validated metadata extracted from a Skill package."""

    name: str
    description: str
    entry_path: str  # path of SKILL.md inside the archive
    files: list[str]  # all (safe) file paths inside the archive
    size: int  # total uncompressed bytes
    hash: str  # sha256 of the archive bytes


class SkillPackageService:
    """Validate Skill archives and extract their manifest."""

    def validate_and_extract(self, *, content: bytes, filename: str) -> SkillManifest:
        self._check_extension(filename)
        if not content:
            raise SkillPackageError("empty_archive", "skill archive is empty", status_code=400)
        if len(content) > _MAX_ARCHIVE_BYTES:
            raise SkillPackageError("archive_too_large", "skill archive exceeds size limit", status_code=400)

        try:
            archive = zipfile.ZipFile(io.BytesIO(content))
        except zipfile.BadZipFile as exc:
            raise SkillPackageError("invalid_archive", "skill archive is not a valid zip", status_code=400) from exc

        with archive:
            infos = [info for info in archive.infolist() if not info.is_dir()]
            if len(infos) > _MAX_ENTRIES:
                raise SkillPackageError("too_many_entries", "skill archive has too many files", status_code=400)

            safe_paths: list[str] = []
            total_uncompressed = 0
            for info in infos:
                safe_paths.append(self._safe_member_path(info.filename))
                total_uncompressed += max(info.file_size, 0)
            if total_uncompressed > _MAX_UNCOMPRESSED_BYTES:
                raise SkillPackageError(
                    "archive_too_large", "skill archive uncompressed size exceeds limit", status_code=400
                )

            entry_path = self._find_skill_md(safe_paths)
            skill_md = self._read_skill_md(archive, entry_path)

        name, description = self._parse_skill_md(skill_md)
        return SkillManifest(
            name=name,
            description=description,
            entry_path=entry_path,
            files=sorted(safe_paths),
            size=total_uncompressed,
            hash=hashlib.sha256(content).hexdigest(),
        )

    def read_member_bytes(self, *, content: bytes, member_path: str) -> bytes:
        """Read a single archive member's bytes (used by standardization, ENG-594)."""
        try:
            archive = zipfile.ZipFile(io.BytesIO(content))
        except zipfile.BadZipFile as exc:
            raise SkillPackageError("invalid_archive", "skill archive is not a valid zip", status_code=400) from exc
        with archive:
            member = next(
                (info for info in archive.infolist() if posixpath.normpath(info.filename) == member_path),
                None,
            )
            if member is None:
                raise SkillPackageError("member_not_found", f"{member_path} not found in archive", status_code=400)
            return archive.read(member)

    @staticmethod
    def _check_extension(filename: str) -> None:
        lowered = (filename or "").lower()
        if not lowered.endswith(_ALLOWED_EXTENSIONS):
            raise SkillPackageError(
                "unsupported_extension",
                f"skill must be one of {', '.join(_ALLOWED_EXTENSIONS)}",
                status_code=400,
            )

    @staticmethod
    def _safe_member_path(name: str) -> str:
        """Reject zip-slip and normalize the archive member path."""
        if "\x00" in name or "\\" in name:
            raise SkillPackageError("unsafe_path", "skill archive contains an unsafe path", status_code=400)
        normalized = posixpath.normpath(name)
        if normalized.startswith("/") or normalized == ".." or normalized.startswith("../"):
            raise SkillPackageError("unsafe_path", "skill archive contains an unsafe path", status_code=400)
        return normalized

    @staticmethod
    def _find_skill_md(paths: list[str]) -> str:
        candidates = [p for p in paths if posixpath.basename(p) == _SKILL_MD_NAME]
        if not candidates:
            raise SkillPackageError("missing_skill_md", "skill archive must contain a SKILL.md", status_code=400)
        # Prefer the shallowest SKILL.md (skill root).
        return min(candidates, key=lambda p: (p.count("/"), len(p)))

    @staticmethod
    def _read_skill_md(archive: zipfile.ZipFile, entry_path: str) -> str:
        # Look the member up by its original name (normpath may differ from the stored name).
        member = next(
            (info for info in archive.infolist() if posixpath.normpath(info.filename) == entry_path),
            None,
        )
        if member is None:
            raise SkillPackageError("missing_skill_md", "skill archive must contain a SKILL.md", status_code=400)
        if member.file_size > _MAX_SKILL_MD_BYTES:
            raise SkillPackageError("skill_md_too_large", "SKILL.md exceeds size limit", status_code=400)
        raw = archive.read(member)
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise SkillPackageError("skill_md_not_utf8", "SKILL.md must be UTF-8 encoded", status_code=400) from exc

    @classmethod
    def _parse_skill_md(cls, content: str) -> tuple[str, str]:
        if not content.strip():
            raise SkillPackageError("empty_skill_md", "SKILL.md is empty", status_code=400)
        frontmatter = cls._parse_frontmatter(content)
        name = str(frontmatter.get("name") or "").strip()
        description = str(frontmatter.get("description") or "").strip()
        if not name:
            heading = _HEADING_RE.search(content)
            name = heading.group(1).strip() if heading else ""
        if not name:
            raise SkillPackageError(
                "missing_skill_name", "SKILL.md must declare a name (frontmatter or top heading)", status_code=400
            )
        return name, description

    @staticmethod
    def _parse_frontmatter(content: str) -> dict[str, object]:
        if not content.startswith("---"):
            return {}
        parts = content.split("---", 2)
        if len(parts) < 3:
            return {}
        try:
            loaded = yaml.safe_load(parts[1])
        except yaml.YAMLError as exc:
            raise SkillPackageError(
                "invalid_frontmatter", "SKILL.md frontmatter is not valid YAML", status_code=400
            ) from exc
        return loaded if isinstance(loaded, dict) else {}


__all__ = ["SkillManifest", "SkillPackageError", "SkillPackageService"]
