"""Read and validate portable Roster Agent ``.ifpkg`` archives."""

from __future__ import annotations

import hashlib
import io
import posixpath
import stat
import tempfile
import zipfile
import zlib
from collections.abc import Hashable
from typing import Any, BinaryIO, cast, override

import yaml
from pydantic import ValidationError

from configs import dify_config
from constants.dsl_version import CURRENT_APP_DSL_VERSION
from services.agent.dsl_entities import AgentAppDsl
from services.agent.errors import InvalidRosterAgentPackageError, RosterAgentPackageTooLargeError
from services.agent.roster_package_entities import (
    ROSTER_AGENT_PACKAGE_MAX_SIGNATURE_BYTES,
    PreparedRosterAgentPackage,
    RosterAgentPackageManifest,
    RosterAgentPackageMember,
    RosterAgentPackageSkill,
)
from services.agent.skill_package_service import SkillPackageError, SkillPackageService
from services.dsl_version import check_version_compatibility
from services.entities.dsl_entities import ImportStatus

_COPY_CHUNK_SIZE = 1024 * 1024
_ALLOWED_COMPRESSIONS = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}


class RosterAgentPackageReader:
    """Produce a validated, bounded package without external side effects."""

    def __init__(self) -> None:
        self._skill_packages = SkillPackageService()

    def read(self, source: BinaryIO) -> PreparedRosterAgentPackage:
        """Validate the container and record unusable Skill payloads for import warnings."""
        # Ownership is transferred to PreparedRosterAgentPackage.
        spool = cast(
            BinaryIO,
            tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b"),  # noqa: SIM115
        )
        try:
            self._copy_bounded(source, spool)
            spool.seek(0)
            invalid_skills: dict[str, str] = {}
            manifest, app, members = self._validate_archive(spool, invalid_skills=invalid_skills)
            spool.seek(0)
            return PreparedRosterAgentPackage(
                archive=spool, manifest=manifest, app=app, members=members, invalid_skills=invalid_skills
            )
        except Exception:
            spool.close()
            raise

    def read_member_bytes(self, package: PreparedRosterAgentPackage, path: str, *, max_bytes: int) -> bytes:
        """Read one already-validated member while rechecking its size and digest."""

        member = package.members.get(path)
        if member is None:
            raise InvalidRosterAgentPackageError("Roster Agent package member is unavailable")
        try:
            package.archive.seek(0)
            with zipfile.ZipFile(package.archive) as archive:
                info = archive.getinfo(path)
                payload, digest, _ = self._read_member(
                    archive,
                    info,
                    collect=True,
                    max_bytes=max_bytes,
                    expected_size=member.size,
                )
        except (KeyError, OSError, zipfile.BadZipFile, EOFError, RuntimeError, ValueError, zlib.error) as exc:
            raise InvalidRosterAgentPackageError("Roster Agent package member is unavailable") from exc
        if digest != member.sha256:
            raise InvalidRosterAgentPackageError("Roster Agent package member failed integrity checks")
        return payload

    def _validate_archive(
        self, archive_file: BinaryIO, *, invalid_skills: dict[str, str]
    ) -> tuple[RosterAgentPackageManifest, AgentAppDsl, dict[str, RosterAgentPackageMember]]:
        try:
            with zipfile.ZipFile(archive_file) as archive:
                infos = archive.infolist()
                if not infos:
                    raise InvalidRosterAgentPackageError("Roster Agent package is empty")
                if len(infos) > dify_config.AGENT_PACKAGE_MAX_ENTRIES:
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
                if total_uncompressed > dify_config.AGENT_PACKAGE_MAX_BYTES:
                    raise RosterAgentPackageTooLargeError("Roster Agent package uncompressed size exceeds the limit")

                manifest_data, manifest_size = self._read_yaml_document(archive, info_by_path, "manifest.yaml")
                try:
                    manifest = RosterAgentPackageManifest.model_validate(manifest_data)
                except ValidationError as exc:
                    raise InvalidRosterAgentPackageError("Roster Agent package manifest is invalid") from exc
                app_data, app_size = self._read_yaml_document(archive, info_by_path, "app.yaml")
                try:
                    app = AgentAppDsl.model_validate(app_data)
                    if check_version_compatibility(app.version, CURRENT_APP_DSL_VERSION) in {
                        ImportStatus.FAILED,
                        ImportStatus.PENDING,
                    }:
                        raise ValueError("unsupported App DSL version")
                    manifest.validate_app(app)
                except ValueError as exc:
                    raise InvalidRosterAgentPackageError("Roster Agent package app is invalid") from exc

                expected_paths = {
                    "manifest.yaml",
                    "app.yaml",
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
                streamed_size = manifest_size + app_size
                nested_uncompressed_size = 0
                signature_info = info_by_path.get("signature.sig")
                if signature_info is not None:
                    _, _, signature_size = self._read_member(
                        archive,
                        signature_info,
                        collect=False,
                        max_bytes=min(
                            ROSTER_AGENT_PACKAGE_MAX_SIGNATURE_BYTES,
                            dify_config.AGENT_PACKAGE_MAX_BYTES - streamed_size,
                        ),
                        expected_size=signature_info.file_size,
                    )
                    streamed_size += signature_size
                for resource in [*manifest.skills, *manifest.files]:
                    info = info_by_path[resource.path]
                    payload = b""
                    remaining_package_bytes = dify_config.AGENT_PACKAGE_MAX_BYTES - streamed_size
                    if isinstance(resource, RosterAgentPackageSkill):
                        max_skill_bytes = dify_config.UPLOAD_SKILL_FILE_SIZE_LIMIT * 1024 * 1024
                        if info.file_size > max_skill_bytes:
                            raise RosterAgentPackageTooLargeError(
                                f"Roster Agent package Skill {resource.name!r} exceeds the size limit"
                            )
                        try:
                            payload, digest, actual_size = self._read_member(
                                archive,
                                info,
                                collect=True,
                                max_bytes=min(max_skill_bytes, remaining_package_bytes),
                                expected_size=resource.size,
                            )
                        except (InvalidRosterAgentPackageError, zipfile.BadZipFile, EOFError, zlib.error):
                            invalid_skills[resource.id] = "archive_integrity_failed"
                            streamed_size += info.file_size
                            continue
                    else:
                        _, digest, actual_size = self._read_member(
                            archive,
                            info,
                            collect=False,
                            max_bytes=remaining_package_bytes,
                            expected_size=resource.size,
                        )
                    streamed_size += actual_size
                    if digest != resource.sha256:
                        if isinstance(resource, RosterAgentPackageSkill):
                            invalid_skills[resource.id] = "checksum_mismatch"
                            continue
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
                            inspection = self._skill_packages.inspect(content=payload, filename=resource.path)
                        except SkillPackageError as exc:
                            invalid_skills[resource.id] = exc.code
                            continue
                        nested_uncompressed_size += inspection.uncompressed_size
                        if nested_uncompressed_size > dify_config.AGENT_PACKAGE_MAX_BYTES:
                            raise RosterAgentPackageTooLargeError(
                                "Roster Agent package nested Skill contents exceed the size limit"
                            )
                        if inspection.name != resource.name:
                            invalid_skills[resource.id] = "skill_name_mismatch"
                return manifest, app, members
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
            if size > dify_config.AGENT_PACKAGE_MAX_BYTES:
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
            info.compress_size == 0
            or info.file_size / info.compress_size > dify_config.AGENT_PACKAGE_MAX_COMPRESSION_RATIO
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
        expected_size: int | None = None,
    ) -> tuple[bytes, str, int]:
        digest = hashlib.sha256()
        output = io.BytesIO() if collect else None
        size = 0
        with archive.open(info) as member:
            while chunk := member.read(_COPY_CHUNK_SIZE):
                size += len(chunk)
                if max_bytes is not None and size > max_bytes:
                    raise RosterAgentPackageTooLargeError("Roster Agent package member exceeds the size limit")
                if expected_size is not None and size > expected_size:
                    raise InvalidRosterAgentPackageError("Roster Agent package member failed integrity checks")
                digest.update(chunk)
                if output is not None:
                    output.write(chunk)
        if expected_size is not None and size != expected_size:
            raise InvalidRosterAgentPackageError("Roster Agent package member failed integrity checks")
        return output.getvalue() if output is not None else b"", digest.hexdigest(), size

    def _read_yaml_document(
        self, archive: zipfile.ZipFile, infos: dict[str, zipfile.ZipInfo], path: str
    ) -> tuple[Any, int]:
        info = infos.get(path)
        if info is None:
            raise InvalidRosterAgentPackageError(f"Roster Agent package is missing {path}")
        if info.file_size > dify_config.AGENT_PACKAGE_MAX_MANIFEST_BYTES:
            raise RosterAgentPackageTooLargeError(f"Roster Agent package {path} exceeds the size limit")
        payload, _, size = self._read_member(
            archive,
            info,
            collect=True,
            max_bytes=dify_config.AGENT_PACKAGE_MAX_MANIFEST_BYTES,
            expected_size=info.file_size,
        )
        try:
            # The custom SafeLoader also rejects duplicate keys and aliases.
            return yaml.load(payload, Loader=_PackageYamlLoader), size  # noqa: S506
        except (UnicodeDecodeError, yaml.YAMLError, ValueError, RecursionError) as exc:
            raise InvalidRosterAgentPackageError(
                f"Roster Agent package {path.removesuffix('.yaml')} is invalid"
            ) from exc


class _PackageYamlLoader(yaml.SafeLoader):
    """Reject ambiguous mappings and aliases in untrusted package documents."""

    @override
    def compose_node(self, parent: yaml.Node | None, index: Any) -> yaml.Node | None:
        if self.check_event(yaml.AliasEvent):
            raise ValueError("YAML aliases are not supported")
        return super().compose_node(parent, index)

    @override
    def construct_mapping(self, node: yaml.MappingNode, deep: bool = False) -> dict[Hashable, Any]:
        result: dict[Hashable, Any] = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, str):
                raise ValueError("YAML mapping keys must be strings")
            if key in result:
                raise ValueError(f"duplicate YAML key: {key}")
            result[key] = self.construct_object(value_node, deep=deep)
        return result


__all__ = ["RosterAgentPackageReader"]
