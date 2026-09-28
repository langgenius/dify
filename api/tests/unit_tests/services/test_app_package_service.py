"""Ordinary App packages preserve DSLs and enforce container integrity."""

import hashlib
import io
import zipfile
from collections.abc import Callable

import pytest
import yaml

from services.agent.errors import InvalidRosterAgentPackageError, RosterAgentPackageTooLargeError
from services.app_package_service import AppPackageService
from services.dsl_content import DSL_MAX_SIZE


def _archive(dsl: str, **manifest_overrides: object) -> io.BytesIO:
    payload = dsl.encode()
    manifest = {
        "format": "dify.app",
        "format_version": 1,
        "apps": [{"path": "app.yaml", "size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}],
        **manifest_overrides,
    }
    source = io.BytesIO()
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.yaml", yaml.safe_dump(manifest))
        archive.writestr("app.yaml", payload)
    source.seek(0)
    return source


@pytest.mark.parametrize("mode", ["workflow", "advanced-chat", "chat", "completion", "agent-chat"])
@pytest.mark.parametrize("version", ["0.1.0", "99.0.0"])
def test_round_trip_retains_exact_dsl_and_defers_version_handling(mode: str, version: str) -> None:
    dsl = f"kind: app\nversion: {version}\napp:\n  mode: {mode}\n# Preserve the DSL verbatim.\n"
    service = AppPackageService()
    with service.export(dsl=dsl, name="Example App") as package:
        assert package.filename == "example-app.ifpkg"
        prepared = service.read_package(package.archive)
        assert prepared is not None
        with prepared:
            assert prepared.dsl == dsl
        assert package.archive.tell() == 0
    assert package.archive.closed


@pytest.mark.parametrize("overrides", [{"format": "unknown"}, {"format_version": 2}, {"apps": []}, {"files": []}])
def test_rejects_unsupported_manifests(overrides: dict[str, object]) -> None:
    with pytest.raises(InvalidRosterAgentPackageError, match="manifest"):
        AppPackageService().read_package(_archive("kind: app\napp: {mode: workflow}\n", **overrides))


@pytest.mark.parametrize(
    "dsl",
    [
        "[]",
        "kind: app\napp: {mode: agent}",
        "kind: app\napp: {mode: unknown}",
        "kind: app\napp: {mode: workflow, mode: chat}",
    ],
)
def test_rejects_invalid_or_agent_dsl_in_ordinary_container(dsl: str) -> None:
    with pytest.raises(InvalidRosterAgentPackageError):
        AppPackageService().read_package(_archive(dsl))


def test_rejects_checksum_mismatch() -> None:
    dsl = "kind: app\napp: {mode: workflow}\n"
    source = _archive(dsl, apps=[{"path": "app.yaml", "size": len(dsl), "sha256": "0" * 64}])
    with pytest.raises(InvalidRosterAgentPackageError, match="integrity"):
        AppPackageService().read_package(source)


@pytest.mark.parametrize("path", ["extra.txt", "../escape", "APP.YAML"])
def test_rejects_unlisted_unsafe_and_duplicate_members(path: str) -> None:
    source = _archive("kind: app\napp: {mode: workflow}\n")
    with zipfile.ZipFile(source, "a") as archive:
        archive.writestr(path, "unexpected")
    source.seek(0)
    with pytest.raises(InvalidRosterAgentPackageError):
        AppPackageService().read_package(source)


def test_rejects_oversized_container(config_overrides: Callable[..., None]) -> None:
    source = _archive("kind: app\napp: {mode: workflow}\n")
    config_overrides(AGENT_PACKAGE_MAX_BYTES=10)
    with pytest.raises(RosterAgentPackageTooLargeError):
        AppPackageService().read_package(source)


def _dsl_with_size(size: int) -> str:
    header = "kind: app\napp:\n  mode: workflow\n  description: "
    padding = size - len(header.encode("utf-8"))
    return header + "\U0001f600" * (padding // 4) + "a" * (padding % 4)


@pytest.mark.parametrize("size", [6 * 1024 * 1024, DSL_MAX_SIZE])
def test_package_round_trip_accepts_large_dsl_within_legacy_limit(size: int) -> None:
    dsl = _dsl_with_size(size)
    service = AppPackageService()
    with service.export(dsl=dsl, name="Large Workflow") as package:
        prepared = service.read_package(package.archive)
        assert prepared is not None
        with prepared:
            assert prepared.dsl == dsl


def test_export_rejects_dsl_exceeding_legacy_byte_limit() -> None:
    dsl = _dsl_with_size(DSL_MAX_SIZE + 1)
    with pytest.raises(RosterAgentPackageTooLargeError):
        AppPackageService().export(dsl=dsl, name="Large Workflow")


def test_import_rejects_compressed_dsl_exceeding_legacy_byte_limit() -> None:
    dsl = _dsl_with_size(DSL_MAX_SIZE + 1)
    source = _archive(dsl)
    with pytest.raises(RosterAgentPackageTooLargeError):
        AppPackageService().read_package(source)
