"""Validate and normalize uploaded Skill packages for drive standardization.

A Skill is a ``.zip`` / ``.skill`` archive that must contain a ``SKILL.md`` entry
file (Anthropic Skills convention: YAML frontmatter with ``name`` + ``description``,
followed by markdown instructions). This service validates the archive (extension,
size, zip integrity, zip-slip safety, SKILL.md presence/encoding/fields),
normalizes retained member paths relative to the selected skill root, rebuilds
canonical archive bytes, and returns normalized metadata together with the
archive-root ``SKILL.md`` bytes.

It does NOT execute or load the skill — the agent backend owns execution. It also
does not persist anything into Agent Soul or bind anything to config versions;
``SkillStandardizeService`` consumes the normalized package and commits the
canonical drive rows instead.
"""

from __future__ import annotations

import hashlib
import io
import posixpath
import re
import zipfile
import zlib

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


class NormalizedSkillPackage(BaseModel):
    """Canonical skill package bytes and metadata ready to store in agent drive."""

    manifest: SkillManifest
    archive_bytes: bytes
    skill_md_bytes: bytes
    strip_prefix: str | None


class SkillPackageService:
    """Validate Skill archives and produce the normalized package stored in drive."""

    def validate_and_normalize(self, *, content: bytes, filename: str) -> NormalizedSkillPackage:
        """Return the canonical drive package for an uploaded skill archive.

        The shallowest ``SKILL.md`` defines the skill root. The returned manifest
        is normalized to archive-root ``SKILL.md`` and its hash describes the
        rebuilt archive bytes. Member read/decompression failures while consuming
        the archive are mapped to ``invalid_archive``.
        """
        archive = self._open_archive(content=content, filename=filename)
        with archive:
            members, total_uncompressed = self._collect_file_members(archive)
            entry_path = self._find_skill_md([safe_path for _, safe_path in members])
            strip_prefix = self._skill_root_prefix(entry_path)
            normalized_members = self._normalize_members(members=members, skill_root_prefix=strip_prefix)
            skill_md_member = normalized_members[_SKILL_MD_NAME]
            self._validate_skill_md_size(skill_md_member)
            skill_md_bytes = self._read_member_bytes_from_archive(archive, member_info=skill_md_member)
            skill_md = self._decode_skill_md(skill_md_bytes)
            normalized_archive_bytes = self._build_normalized_archive(
                archive=archive, normalized_members=normalized_members
            )

        name, description = self._parse_skill_md(skill_md)
        manifest = SkillManifest(
            name=name,
            description=description,
            entry_path=_SKILL_MD_NAME,
            files=sorted(normalized_members),
            size=total_uncompressed,
            hash=hashlib.sha256(normalized_archive_bytes).hexdigest(),
        )
        return NormalizedSkillPackage(
            manifest=manifest,
            archive_bytes=normalized_archive_bytes,
            skill_md_bytes=skill_md_bytes,
            strip_prefix=strip_prefix,
        )

    def _open_archive(self, *, content: bytes, filename: str) -> zipfile.ZipFile:
        self._check_extension(filename)
        if not content:
            raise SkillPackageError("empty_archive", "skill archive is empty", status_code=400)
        if len(content) > _MAX_ARCHIVE_BYTES:
            raise SkillPackageError("archive_too_large", "skill archive exceeds size limit", status_code=400)

        try:
            return zipfile.ZipFile(io.BytesIO(content))
        except zipfile.BadZipFile as exc:
            raise SkillPackageError("invalid_archive", "skill archive is not a valid zip", status_code=400) from exc

    def _collect_file_members(self, archive: zipfile.ZipFile) -> tuple[list[tuple[zipfile.ZipInfo, str]], int]:
        infos = [info for info in archive.infolist() if not info.is_dir()]
        if len(infos) > _MAX_ENTRIES:
            raise SkillPackageError("too_many_entries", "skill archive has too many files", status_code=400)

        members: list[tuple[zipfile.ZipInfo, str]] = []
        total_uncompressed = 0
        for info in infos:
            members.append((info, self._safe_member_path(info.filename)))
            total_uncompressed += max(info.file_size, 0)
        if total_uncompressed > _MAX_UNCOMPRESSED_BYTES:
            raise SkillPackageError(
                "archive_too_large",
                "skill archive uncompressed size exceeds limit",
                status_code=400,
            )
        return members, total_uncompressed

    @staticmethod
    def _skill_root_prefix(entry_path: str) -> str | None:
        skill_root = posixpath.dirname(entry_path)
        if not skill_root:
            return None
        return f"{skill_root}/"

    def _normalize_members(
        self,
        *,
        members: list[tuple[zipfile.ZipInfo, str]],
        skill_root_prefix: str | None,
    ) -> dict[str, zipfile.ZipInfo]:
        normalized_members: dict[str, zipfile.ZipInfo] = {}
        for info, safe_path in members:
            if skill_root_prefix is not None:
                if not safe_path.startswith(skill_root_prefix):
                    raise SkillPackageError(
                        "files_outside_skill_root",
                        "skill archive contains files outside the selected skill root",
                        status_code=400,
                    )
                normalized_path = safe_path.removeprefix(skill_root_prefix)
            else:
                normalized_path = safe_path

            if (
                not normalized_path
                or normalized_path in {".", ".."}
                or normalized_path.startswith("/")
                or "\\" in normalized_path
            ):
                raise SkillPackageError("unsafe_path", "skill archive contains an unsafe path", status_code=400)
            if normalized_path in normalized_members:
                raise SkillPackageError(
                    "duplicate_member_path",
                    "skill archive contains duplicate normalized paths",
                    status_code=400,
                )
            normalized_members[normalized_path] = info

        if _SKILL_MD_NAME not in normalized_members:
            raise SkillPackageError("missing_skill_md", "skill archive must contain a SKILL.md", status_code=400)
        return normalized_members

    def _build_normalized_archive(
        self,
        *,
        archive: zipfile.ZipFile,
        normalized_members: dict[str, zipfile.ZipInfo],
    ) -> bytes:
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as normalized_archive:
            for normalized_path in sorted(normalized_members):
                normalized_archive.writestr(
                    normalized_path,
                    self._read_member_bytes_from_archive(archive, member_info=normalized_members[normalized_path]),
                )
        return output.getvalue()

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
    def _read_member_bytes_from_archive(archive: zipfile.ZipFile, *, member_info: zipfile.ZipInfo) -> bytes:
        try:
            return archive.read(member_info)
        except (zipfile.BadZipFile, EOFError, OSError, RuntimeError, ValueError, zlib.error) as exc:
            raise SkillPackageError("invalid_archive", "skill archive is not a valid zip", status_code=400) from exc

    @staticmethod
    def _validate_skill_md_size(member_info: zipfile.ZipInfo) -> None:
        if member_info.file_size > _MAX_SKILL_MD_BYTES:
            raise SkillPackageError("skill_md_too_large", "SKILL.md exceeds size limit", status_code=400)

    @staticmethod
    def _decode_skill_md(raw: bytes) -> str:
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


__all__ = ["NormalizedSkillPackage", "SkillManifest", "SkillPackageError", "SkillPackageService"]
