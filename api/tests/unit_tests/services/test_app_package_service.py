"""App packages preserve DSLs, bundle called workflows and enforce container integrity."""

import hashlib
import io
import zipfile
from collections.abc import Callable

import pytest
import yaml

from constants.dsl_version import CURRENT_APP_DSL_VERSION
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
    with service.export(dsl=dsl, name="Example App", workflow_tools=[]) as package:
        assert package.filename == "example-app.ifpkg"
        prepared = service.read_package(package.archive)
        assert prepared is not None
        with prepared:
            assert prepared.dsl == dsl
        assert package.archive.tell() == 0
    assert package.archive.closed


@pytest.mark.parametrize("overrides", [{"format": "unknown"}, {"format_version": 2}, {"apps": []}])
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
        "kind: app\napp: {mode: workflow}\nsite: not-a-map",
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
    with service.export(dsl=dsl, name="Large Workflow", workflow_tools=[]) as package:
        prepared = service.read_package(package.archive)
        assert prepared is not None
        with prepared:
            assert prepared.dsl == dsl


def test_export_rejects_dsl_exceeding_legacy_byte_limit() -> None:
    dsl = _dsl_with_size(DSL_MAX_SIZE + 1)
    with pytest.raises(RosterAgentPackageTooLargeError):
        AppPackageService().export(dsl=dsl, name="Large Workflow", workflow_tools=[])


def test_import_rejects_compressed_dsl_exceeding_legacy_byte_limit() -> None:
    dsl = _dsl_with_size(DSL_MAX_SIZE + 1)
    source = _archive(dsl)
    with pytest.raises(RosterAgentPackageTooLargeError):
        AppPackageService().read_package(source)


_WORKFLOW_DSL = f"kind: app\nversion: {CURRENT_APP_DSL_VERSION}\napp:\n  mode: workflow\n"


def _nested_package(dsl: str) -> bytes:
    with AppPackageService().export(dsl=dsl, name="Summarize", workflow_tools=[]) as exported:
        return exported.archive.read()


def _workflow_tool(index: int, member: bytes, **overrides: object) -> dict[str, object]:
    return {
        "id": f"w_{index:06d}",
        "path": f"w_{index:06d}.ifpkg",
        "size": len(member),
        "sha256": hashlib.sha256(member).hexdigest(),
        "provider_id": f"33333333-3333-4333-8333-{index:012d}",
        "name": f"summarize_{index}",
        "label": "Summarize",
        "icon": {"background": "#FFEAD5", "content": "🤖"},
        "description": "Summarize a document",
        "parameters": [{"name": "document", "description": "Document", "form": "llm"}],
        "labels": ["productivity"],
        "privacy_policy": "",
        **overrides,
    }


def _bundle(
    members: list[bytes], *, root_dsl: str = _WORKFLOW_DSL, format_version: int = 2, **tool_overrides: object
) -> io.BytesIO:
    tools = [_workflow_tool(index, member, **tool_overrides) for index, member in enumerate(members, start=1)]
    source = _archive(root_dsl, format_version=format_version, workflow_tools=tools)
    with zipfile.ZipFile(source, "a") as archive:
        for tool, member in zip(tools, members, strict=True):
            archive.writestr(str(tool["path"]), member)
    source.seek(0)
    return source


def test_reads_bundled_workflow_tools_and_opens_each_as_an_app_package() -> None:
    member = _nested_package(_WORKFLOW_DSL)

    prepared = AppPackageService().read_package(_bundle([member]))

    assert prepared is not None
    with prepared:
        assert prepared.dsl == _WORKFLOW_DSL
        [tool] = prepared.workflow_tools
        assert (tool.provider_id, tool.name, tool.labels) == (
            "33333333-3333-4333-8333-000000000001",
            "summarize_1",
            ["productivity"],
        )
        with prepared.open_workflow_tool(tool) as nested:
            assert nested.dsl == _WORKFLOW_DSL
            assert nested.workflow_tools == []


@pytest.mark.parametrize(
    ("format_version", "tool_overrides"),
    [(1, {}), (2, {"name": "not a tool name"}), (2, {"provider_id": "not-a-uuid"})],
    ids=["v1-with-tools", "invalid-name", "invalid-provider-id"],
)
def test_rejects_invalid_workflow_tool_manifests(format_version: int, tool_overrides: dict[str, str]) -> None:
    member = _nested_package(_WORKFLOW_DSL)
    with pytest.raises(InvalidRosterAgentPackageError, match="manifest"):
        AppPackageService().read_package(_bundle([member], format_version=format_version, **tool_overrides))


def test_rejects_workflow_tool_checksum_mismatch() -> None:
    member = _nested_package(_WORKFLOW_DSL)
    with pytest.raises(InvalidRosterAgentPackageError, match="integrity"):
        AppPackageService().read_package(_bundle([member], sha256="0" * 64))


@pytest.mark.parametrize(
    "nested_dsl",
    [
        f"kind: app\nversion: {CURRENT_APP_DSL_VERSION}\napp:\n  mode: advanced-chat\n",
        "kind: app\nversion: 99.0.0\napp:\n  mode: workflow\n",
    ],
    ids=["not-a-workflow", "needs-version-confirmation"],
)
def test_rejects_workflow_tools_that_cannot_import_with_the_package(nested_dsl: str) -> None:
    with pytest.raises(InvalidRosterAgentPackageError):
        AppPackageService().read_package(_bundle([_nested_package(nested_dsl)]))


def test_rejects_a_root_app_that_needs_version_confirmation_with_workflow_tools() -> None:
    member = _nested_package(_WORKFLOW_DSL)
    root_dsl = "kind: app\nversion: 99.0.0\napp:\n  mode: workflow\n"
    with pytest.raises(InvalidRosterAgentPackageError, match="confirmation"):
        AppPackageService().read_package(_bundle([member], root_dsl=root_dsl))


def test_rejects_workflow_tools_that_bundle_workflow_tools() -> None:
    nested = _bundle([_nested_package(_WORKFLOW_DSL)]).getvalue()
    with pytest.raises(InvalidRosterAgentPackageError, match="must not bundle"):
        AppPackageService().read_package(_bundle([nested]))


def test_rejects_more_workflow_tools_than_the_limit(config_overrides: Callable[..., None]) -> None:
    member = _nested_package(_WORKFLOW_DSL)
    config_overrides(APP_PACKAGE_MAX_WORKFLOW_TOOLS=1)
    with pytest.raises(RosterAgentPackageTooLargeError, match="too many workflow tools"):
        AppPackageService().read_package(_bundle([member, member]))
