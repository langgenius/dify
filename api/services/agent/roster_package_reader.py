"""Read and validate portable Roster Agent ``.ifpkg`` archives."""

from __future__ import annotations

import hashlib
import io
import json
import posixpath
import stat
import tempfile
import zipfile
import zlib
from typing import Any, BinaryIO, cast

from pydantic import ValidationError

from configs import dify_config
from services.agent.errors import InvalidRosterAgentPackageError, RosterAgentPackageTooLargeError
from services.agent.roster_package_entities import (
    ROSTER_AGENT_PACKAGE_MAX_ARCHIVE_BYTES,
    ROSTER_AGENT_PACKAGE_MAX_COMPRESSION_RATIO,
    ROSTER_AGENT_PACKAGE_MAX_ENTRIES,
    ROSTER_AGENT_PACKAGE_MAX_SIGNATURE_BYTES,
    ROSTER_AGENT_PACKAGE_MAX_UNCOMPRESSED_BYTES,
    PreparedRosterAgentPackage,
    RosterAgentPackageManifest,
    RosterAgentPackageMember,
    RosterAgentPackageSkill,
)
from services.agent.skill_package_service import SkillPackageError, SkillPackageService

_COPY_CHUNK_SIZE = 1024 * 1024
_ALLOWED_COMPRESSIONS = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}


class RosterAgentPackageReader:
    """Produce a validated, bounded package without external side effects."""

    def __init__(self, *, skill_package_service: SkillPackageService | None = None) -> None:
        self._skill_packages = skill_package_service or SkillPackageService()

    def read(self, source: BinaryIO) -> PreparedRosterAgentPackage:
        # Ownership is transferred to PreparedRosterAgentPackage.
        spool = cast(
            BinaryIO,
            tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b"),  # noqa: SIM115
        )
        try:
            self._copy_bounded(source, spool)
            spool.seek(0)
            manifest, members = self._validate_archive(spool)
            spool.seek(0)
            return PreparedRosterAgentPackage(archive=spool, manifest=manifest, members=members)
        except Exception:
            spool.close()
            raise

    def _validate_archive(
        self, archive_file: BinaryIO
    ) -> tuple[RosterAgentPackageManifest, dict[str, RosterAgentPackageMember]]:
        try:
            with zipfile.ZipFile(archive_file) as archive:
                infos = archive.infolist()
                if not infos:
                    raise InvalidRosterAgentPackageError("Roster Agent package is empty")
                if len(infos) > ROSTER_AGENT_PACKAGE_MAX_ENTRIES:
                    raise InvalidRosterAgentPackageError("Roster Agent package has too many members")

                info_by_path: dict[str, zipfile.ZipInfo] = {}
                casefold_paths: set[str] = set()
                total_uncompressed = 0
                for info in infos:
                    path = self._validate_member_info(info)
                    if path in info_by_path or path.casefold() in casefold_paths:
                        raise InvalidRosterAgentPackageError("Roster Agent package contains duplicate member paths")
                    info_by_path[path] = info
                    casefold_paths.add(path.casefold())
                    total_uncompressed += info.file_size
                if total_uncompressed > ROSTER_AGENT_PACKAGE_MAX_UNCOMPRESSED_BYTES:
                    raise RosterAgentPackageTooLargeError("Roster Agent package uncompressed size exceeds the limit")

                manifest_info = info_by_path.get("manifest.json")
                if manifest_info is None:
                    raise InvalidRosterAgentPackageError("Roster Agent package is missing manifest.json")
                manifest_bytes, _ = self._read_member(archive, manifest_info, collect=True)
                try:
                    manifest_data = json.loads(manifest_bytes, object_pairs_hook=self._reject_duplicate_json_keys)
                    manifest = RosterAgentPackageManifest.model_validate(manifest_data)
                except (UnicodeDecodeError, json.JSONDecodeError, ValidationError, ValueError) as exc:
                    raise InvalidRosterAgentPackageError("Roster Agent package manifest is invalid") from exc

                expected_paths = {
                    "manifest.json",
                    *(item.path for item in manifest.skills),
                    *(item.path for item in manifest.files),
                }
                actual_paths = set(info_by_path)
                if "signature.sig" in actual_paths:
                    if info_by_path["signature.sig"].file_size > ROSTER_AGENT_PACKAGE_MAX_SIGNATURE_BYTES:
                        raise RosterAgentPackageTooLargeError("Roster Agent package signature is too large")
                    actual_paths.remove("signature.sig")
                if actual_paths != expected_paths:
                    raise InvalidRosterAgentPackageError("Roster Agent package members do not match the manifest")

                members: dict[str, RosterAgentPackageMember] = {}
                for resource in [*manifest.skills, *manifest.files]:
                    info = info_by_path[resource.path]
                    payload = b""
                    if isinstance(resource, RosterAgentPackageSkill):
                        max_skill_bytes = dify_config.UPLOAD_SKILL_FILE_SIZE_LIMIT * 1024 * 1024
                        if info.file_size > max_skill_bytes:
                            raise RosterAgentPackageTooLargeError(
                                f"Roster Agent package Skill {resource.name!r} exceeds the size limit"
                            )
                        payload, digest = self._read_member(
                            archive,
                            info,
                            collect=True,
                            max_bytes=max_skill_bytes,
                        )
                    else:
                        _, digest = self._read_member(archive, info, collect=False)
                    if info.file_size != resource.size or digest != resource.sha256:
                        raise InvalidRosterAgentPackageError(
                            f"Roster Agent package resource {resource.path!r} failed integrity checks",
                        )
                    members[resource.path] = RosterAgentPackageMember(
                        path=resource.path,
                        size=resource.size,
                        sha256=digest,
                    )
                    if isinstance(resource, RosterAgentPackageSkill):
                        try:
                            normalized = self._skill_packages.validate_and_normalize(
                                content=payload, filename=resource.path
                            )
                        except SkillPackageError as exc:
                            raise InvalidRosterAgentPackageError(
                                f"Roster Agent package Skill {resource.name!r} is invalid"
                            ) from exc
                        if normalized.manifest.name != resource.name:
                            raise InvalidRosterAgentPackageError(
                                f"Roster Agent package Skill {resource.name!r} does not match SKILL.md",
                            )
                return manifest, members
        except (InvalidRosterAgentPackageError, RosterAgentPackageTooLargeError):
            raise
        except (OSError, zipfile.BadZipFile, EOFError, RuntimeError, ValueError, zlib.error) as exc:
            raise InvalidRosterAgentPackageError("Roster Agent package is not a valid ZIP") from exc

    @staticmethod
    def _copy_bounded(source: BinaryIO, target: BinaryIO) -> None:
        size = 0
        while True:
            chunk = source.read(_COPY_CHUNK_SIZE)
            if not chunk:
                break
            if not isinstance(chunk, bytes):
                raise InvalidRosterAgentPackageError("Roster Agent package must be binary")
            size += len(chunk)
            if size > ROSTER_AGENT_PACKAGE_MAX_ARCHIVE_BYTES:
                raise RosterAgentPackageTooLargeError("Roster Agent package exceeds the archive size limit")
            target.write(chunk)

    @staticmethod
    def _validate_member_info(info: zipfile.ZipInfo) -> str:
        name = info.filename
        if info.is_dir():
            raise InvalidRosterAgentPackageError("Roster Agent package must use root-level files")
        if "\x00" in name or "\\" in name or any(ord(char) < 0x20 for char in name):
            raise InvalidRosterAgentPackageError("Roster Agent package contains an unsafe path")
        normalized = posixpath.normpath(name)
        if normalized != name or normalized in {"", ".", ".."} or normalized.startswith("/") or "/" in normalized:
            raise InvalidRosterAgentPackageError("Roster Agent package contains an unsafe path")
        if stat.S_ISLNK(info.external_attr >> 16):
            raise InvalidRosterAgentPackageError("Roster Agent package must not contain symbolic links")
        if info.flag_bits & 0x1:
            raise InvalidRosterAgentPackageError("Roster Agent package must not contain encrypted members")
        if info.compress_type not in _ALLOWED_COMPRESSIONS:
            raise InvalidRosterAgentPackageError("Roster Agent package uses unsupported compression")
        if info.file_size < 0 or info.compress_size < 0:
            raise InvalidRosterAgentPackageError("Roster Agent package contains invalid ZIP metadata")
        if info.file_size and (
            info.compress_size == 0 or info.file_size / info.compress_size > ROSTER_AGENT_PACKAGE_MAX_COMPRESSION_RATIO
        ):
            raise InvalidRosterAgentPackageError("Roster Agent package compression ratio is too high")
        return normalized

    @staticmethod
    def _read_member(
        archive: zipfile.ZipFile,
        info: zipfile.ZipInfo,
        *,
        collect: bool,
        max_bytes: int | None = None,
    ) -> tuple[bytes, str]:
        digest = hashlib.sha256()
        output = io.BytesIO() if collect else None
        size = 0
        with archive.open(info) as member:
            while chunk := member.read(_COPY_CHUNK_SIZE):
                size += len(chunk)
                if max_bytes is not None and size > max_bytes:
                    raise RosterAgentPackageTooLargeError("Roster Agent package member exceeds the size limit")
                digest.update(chunk)
                if output is not None:
                    output.write(chunk)
        return output.getvalue() if output is not None else b"", digest.hexdigest()

    @staticmethod
    def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON key: {key}")
            result[key] = value
        return result


__all__ = ["RosterAgentPackageReader"]
