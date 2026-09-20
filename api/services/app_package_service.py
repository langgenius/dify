"""Package ordinary App DSLs while retaining the existing Roster Agent format."""

from __future__ import annotations

import hashlib
import io
import re
import tempfile
import zipfile
import zlib
from typing import BinaryIO, Literal, cast

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from services.agent.errors import InvalidRosterAgentPackageError, RosterAgentPackageTooLargeError
from services.agent.roster_package_entities import RosterAgentPackageApp, RosterAgentPackageExport
from services.agent.roster_package_reader import RosterAgentPackageReader
from services.dsl_content import DSL_MAX_SIZE


class AppPackageManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: Literal["dify.app"]
    format_version: Literal[1]
    apps: list[RosterAgentPackageApp] = Field(min_length=1, max_length=1)


class AppPackageService(RosterAgentPackageReader):
    """Reuse the bounded ZIP reader; ordinary Apps retain DSL import semantics."""

    def read_dsl(self, source: BinaryIO) -> str | None:
        """Return an ordinary DSL, or rewind a Roster package for its importer."""
        try:
            with tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b") as spool:
                self._copy_bounded(source, cast(BinaryIO, spool))
                spool.seek(0)
                with zipfile.ZipFile(spool) as archive:
                    infos = self._index_archive(archive)
                    data, _ = self._read_yaml_document(archive, infos, "manifest.yaml")
                    if isinstance(data, dict) and data.get("format") == "dify.roster-agent":
                        return None
                    try:
                        manifest = AppPackageManifest.model_validate(data)
                    except ValidationError as exc:
                        raise InvalidRosterAgentPackageError("App package manifest is invalid") from exc
                    resource = manifest.apps[0]
                    if set(infos) != {"manifest.yaml", resource.path}:
                        raise InvalidRosterAgentPackageError("App package members do not match the manifest")
                    app_data, _ = self._read_yaml_document(
                        archive, infos, resource.path, resource=resource, max_bytes=DSL_MAX_SIZE
                    )
                    if (
                        not isinstance(app_data, dict)
                        or app_data.get("kind") != "app"
                        or not isinstance(app_data.get("app"), dict)
                        or app_data["app"].get("mode")
                        not in {
                            "workflow",
                            "advanced-chat",
                            "chat",
                            "completion",
                            "agent-chat",
                            "channel",
                            "rag-pipeline",
                        }
                    ):
                        raise InvalidRosterAgentPackageError("App package DSL is invalid")
                    # Preserve the original text for version confirmation and legacy DSL handling.
                    return archive.read(resource.path).decode("utf-8")
        except (InvalidRosterAgentPackageError, RosterAgentPackageTooLargeError):
            raise
        except (OSError, zipfile.BadZipFile, EOFError, RuntimeError, ValueError, zlib.error) as exc:
            raise InvalidRosterAgentPackageError("App package is not a valid ZIP") from exc
        finally:
            source.seek(0)

    def export(self, *, dsl: str, name: str) -> RosterAgentPackageExport:
        payload = dsl.encode("utf-8")
        if len(payload) > DSL_MAX_SIZE:
            raise RosterAgentPackageTooLargeError("App package DSL exceeds the size limit")
        manifest = AppPackageManifest(
            format="dify.app",
            format_version=1,
            apps=[
                RosterAgentPackageApp(path="app.yaml", size=len(payload), sha256=hashlib.sha256(payload).hexdigest())
            ],
        )
        archive = io.BytesIO()
        try:
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as package:
                package.writestr("manifest.yaml", yaml.safe_dump(manifest.model_dump(mode="json")))
                package.writestr("app.yaml", payload)
            size = archive.tell()
            archive.seek(0)
            # Validate exported containers against the same limits as imports.
            self.read_dsl(archive)
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:80] or "app"
            return RosterAgentPackageExport(archive=archive, filename=f"{slug}.ifpkg", size=size)
        except Exception:
            archive.close()
            raise
