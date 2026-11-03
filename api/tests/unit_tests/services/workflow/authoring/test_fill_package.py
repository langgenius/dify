import copy
import hashlib
import io
import zipfile
from collections.abc import Callable
from pathlib import Path
from uuid import uuid4

import pytest
import yaml
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from configs import dify_config
from constants.dsl_version import CURRENT_APP_DSL_VERSION
from core.plugin.impl.tool import PluginToolManager
from extensions.application_services.app import AppServices
from graphon.enums import BuiltinNodeTypes
from libs.archive_writer import ArchiveEntry, ArchiveLimits, ArchiveTooLargeError, entries_from_folder
from machinery.context import RequestContext
from models.account import TenantAccountJoin, TenantAccountRole
from models.model import AppMode, IconType
from models.workflow import Workflow
from services.agent.errors import RosterAgentPackageTooLargeError
from services.app_package_service import AppPackageService
from services.entities.dsl_entities import AppImportParams, ImportStatus
from services.workflow.authoring import FillContext, fill_package
from services.workflow.authoring.fill import FilledPackage, FilledRoot, SubmittedRoot, fill_graph_document
from services.workflow.authoring.package_io import PackageUnreadableError, read_package_entries
from services.workflow.graph_check import IssueCode, check_graph
from tests.helpers.unit.model_factories import make_account, make_tenant, make_upload_file
from tests.unit_tests.services.test_app_package_service import (
    _bundle_any_app,
    _nested_package,
    _package_storage,
    _source,
    _workflow_tool,
)

CTX = FillContext(tenant_id="tenant-1", account_id="account-1")
LIMITS = ArchiveLimits(max_entries=64, max_bytes=16 * 1024 * 1024)
FIXTURES = Path(__file__).parents[4] / "fixtures" / "workflow"
APP = "app.yaml"
MANIFEST = "manifest.yaml"
# Console exports in the current format; older ones lack edge fields the editor now writes, which wiring adds.
CONSOLE_EXPORTS = [
    "array_iteration_formatting_workflow.yml",
    "basic_llm_chat_workflow.yml",
    "end_node_without_value_type_field_workflow.yml",
    "http_request_with_json_tool_workflow.yml",
    "increment_loop_with_break_condition_workflow.yml",
    "iteration_flatten_output_disabled_workflow.yml",
    "iteration_flatten_output_enabled_workflow.yml",
    "loop_contains_answer.yml",
    "search_dify_from_2023_to_2025.yml",
    "simple_passthrough_workflow.yml",
    "test-answer-order.yml",
    "update-conversation-variable-in-iteration.yml",
]


def _members(content: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def _zip(members: dict[str, bytes]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return output.getvalue()


def _fill(content: bytes) -> bytes:
    return fill_package(read_package_entries(io.BytesIO(content)), CTX, limits=LIMITS)


def _exported(dsl: str) -> bytes:
    with AppPackageService().export(dsl=dsl, name="Example", workflow_tools=[]) as package:
        return package.archive.read()


def _skeleton_dsl(mode: AppMode = AppMode.WORKFLOW) -> str:
    nodes = [
        {"id": "start", "data": {"type": BuiltinNodeTypes.START}},
        {
            "id": "now",
            "data": {
                "type": BuiltinNodeTypes.TOOL,
                "provider_type": "builtin",
                "provider_id": "time",
                "provider_name": "time",
                "tool_name": "current_time",
                "tool_label": "Current Time",
                "tool_node_version": "2",
            },
        },
        {"id": "end", "data": {"type": BuiltinNodeTypes.END}},
    ]
    edges = [{"source": "start", "target": "now"}, {"source": "now", "target": "end"}]
    return yaml.safe_dump(
        {
            "kind": "app",
            "version": CURRENT_APP_DSL_VERSION,
            "app": {"mode": mode.value, "name": "Skeleton"},
            "workflow": {"graph": {"nodes": nodes, "edges": edges}},
        }
    )


@pytest.mark.parametrize("fixture", CONSOLE_EXPORTS)
def test_a_console_export_goes_through_fill_unchanged(fixture: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(PluginToolManager, "fetch_tool_provider", lambda _self, _tenant_id, _provider: None)
    exported = _exported((FIXTURES / fixture).read_text())

    assert _members(_fill(exported)) == _members(exported)


def _null_paths(value: object, path: str = "") -> set[str]:
    if isinstance(value, dict):
        return {found for key, item in value.items() for found in _null_paths(item, f"{path}.{key}")}
    if isinstance(value, list):
        return {found for index, item in enumerate(value) for found in _null_paths(item, f"{path}[{index}]")}
    return {path} if value is None else set()


def test_start_variables_and_llm_nodes_of_a_real_export_gain_no_null_keys() -> None:
    document = yaml.safe_load((FIXTURES / "basic_llm_chat_workflow.yml").read_text())
    nodes = document["workflow"]["graph"]["nodes"]
    assert {node["data"]["type"] for node in nodes} >= {BuiltinNodeTypes.START, BuiltinNodeTypes.LLM}
    assert any(node["data"].get("variables") for node in nodes)
    assert any("memory" in node["data"] for node in nodes)
    before = _null_paths(document)

    fill_graph_document(document, CTX)

    assert _null_paths(document) == before


def test_a_skeleton_folder_becomes_a_package_the_reader_accepts() -> None:
    entries = entries_from_folder({APP: io.BytesIO(_skeleton_dsl().encode())})

    filled = fill_package(entries, CTX, limits=LIMITS)

    assert set(_members(filled)) == {APP, MANIFEST}
    prepared = AppPackageService().read_package(io.BytesIO(filled))
    assert prepared is not None
    prepared.close()
    manifest = yaml.safe_load(_members(filled)[MANIFEST])
    app_bytes = _members(filled)[APP]
    assert manifest == {
        "format": "dify.app",
        "format_version": 1,
        "apps": [{"path": APP, "size": len(app_bytes), "sha256": hashlib.sha256(app_bytes).hexdigest()}],
    }
    graph = yaml.safe_load(app_bytes)["workflow"]["graph"]
    codes = {issue.code for issue in check_graph(graph, mode=AppMode.WORKFLOW)}
    assert codes.isdisjoint({IssueCode.MODE_INCOMPATIBLE, IssueCode.EDGE_ENDPOINT_MISSING, IssueCode.GRAPH_INVALID})
    [tool] = [node for node in graph["nodes"] if node["id"] == "now"]
    assert tool["data"]["tool_configurations"]["timezone"] == {"type": "constant", "value": "UTC"}
    assert [edge["id"] for edge in graph["edges"]] == ["start-source-now-target", "now-source-end-target"]


def test_a_filled_skeleton_imports_as_a_new_app(
    app_services: AppServices,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_engine: Engine,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(RBAC_ENABLED=False, DEPLOYMENT_EDITION="COMMUNITY")
    _package_storage(monkeypatch, sqlite_engine)
    tenant = make_tenant(tenant_id=str(uuid4()))
    account = make_account(tenant=tenant)
    sqlite_session.add_all(
        [tenant, account, TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER)]
    )
    sqlite_session.commit()
    filled = fill_package(entries_from_folder({APP: io.BytesIO(_skeleton_dsl().encode())}), CTX, limits=LIMITS)

    result = app_services.console.import_app(
        RequestContext("request", None, account.id, tenant.id),
        AppImportParams(mode="yaml-content"),
        source=io.BytesIO(filled),
    )

    assert result.status == ImportStatus.COMPLETED, (result.error, result.warnings)
    sqlite_session.expire_all()
    draft = sqlite_session.query(Workflow).filter_by(app_id=result.app_id, version=Workflow.VERSION_DRAFT).one()
    assert {node["id"] for node in draft.graph_dict["nodes"]} == {"start", "now", "end"}


def _resource_package(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> bytes:
    """A real export with inline Agent souls, skills, files and an icon, plus a bundled workflow tool."""
    storage = _package_storage(monkeypatch, sqlite_engine)
    source = _source(sqlite_session, storage)
    icon = make_upload_file(
        tenant_id=source.tenant_id, key="uploads/icon.png", name="icon.png", extension="png", mime_type="image/png"
    )
    storage.files[icon.key] = b"icon payload"
    source.icon_type = IconType.IMAGE
    source.icon = icon.id
    sqlite_session.add(icon)
    sqlite_session.commit()
    with AppPackageService().export_app(
        may_bundle=_bundle_any_app, app_model=source, preserve_agent_bindings=False
    ) as exported:
        members = _members(exported.archive.read())
    nested = _nested_package(f"kind: app\nversion: {yaml.safe_load(members[APP])['version']}\napp:\n  mode: workflow\n")
    manifest = yaml.safe_load(members[MANIFEST])
    manifest["format_version"] = 2
    manifest["workflow_tools"] = [_workflow_tool(1, nested)]
    manifest["x_extension"] = {"kept": True}
    members[MANIFEST] = yaml.safe_dump(manifest).encode()
    members["w_000001.ifpkg"] = nested
    return _zip(members)


def test_resources_and_workflow_tools_pass_through(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    package = _resource_package(sqlite_session, monkeypatch, sqlite_engine)
    before = _members(package)
    prepared = AppPackageService().read_package(io.BytesIO(package))
    assert prepared is not None
    prepared.close()

    filled = _fill(package)

    after = _members(filled)
    assert after.keys() == before.keys()
    assert {"w_000001.ifpkg", "i_000001.png"} <= after.keys()
    assert any(path.startswith("s_") for path in after)
    for path in before.keys() - {APP, MANIFEST}:
        assert after[path] == before[path], path
    assert after[APP] != before[APP]
    manifest_before = yaml.safe_load(before[MANIFEST])
    manifest_after = yaml.safe_load(after[MANIFEST])
    app_entry = manifest_after["apps"][0]
    assert (app_entry["size"], app_entry["sha256"]) == (len(after[APP]), hashlib.sha256(after[APP]).hexdigest())
    for entry in (manifest_before, manifest_after):
        entry["apps"][0].pop("size")
        entry["apps"][0].pop("sha256")
    assert manifest_after == manifest_before
    prepared = AppPackageService().read_package(io.BytesIO(filled))
    assert prepared is not None
    prepared.close()


def test_filling_twice_gives_the_same_members() -> None:
    once = fill_package(entries_from_folder({APP: io.BytesIO(_skeleton_dsl().encode())}), CTX, limits=LIMITS)

    assert _members(_fill(once)) == _members(once)


def test_filling_a_resource_package_twice_gives_the_same_members(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    once = _fill(_resource_package(sqlite_session, monkeypatch, sqlite_engine))

    assert _members(_fill(once)) == _members(once)


def test_an_edited_app_yaml_gets_a_manifest_that_matches_it() -> None:
    exported = _members(_exported((FIXTURES / "simple_passthrough_workflow.yml").read_text()))
    edited = exported[APP].replace(b"name: echo", b"name: echo edited by the agent", 1)
    assert edited != exported[APP]

    filled = _fill(_zip({**exported, APP: edited}))

    assert _members(filled)[APP] == edited
    prepared = AppPackageService().read_package(io.BytesIO(filled))
    assert prepared is not None
    prepared.close()


def _manifest_for(app: bytes, **overrides: object) -> bytes:
    entry = {"path": APP, "size": len(app), "sha256": hashlib.sha256(app).hexdigest()}
    return yaml.safe_dump({"format": "dify.app", "format_version": 1, "apps": [entry], **overrides}).encode()


@pytest.mark.parametrize(
    "manifest",
    [
        pytest.param(lambda _app: b"apps: [unclosed", id="bad-yaml"),
        pytest.param(
            lambda app: _manifest_for(app, apps=[{"path": "other.yaml", "size": 1, "sha256": "0" * 64}]),
            id="root-app-elsewhere",
        ),
        pytest.param(lambda app: _manifest_for(app, format="dify.other"), id="invalid-manifest"),
    ],
)
def test_a_manifest_that_cannot_be_merged_keeps_the_package_as_written(manifest: Callable[[bytes], bytes]) -> None:
    app = _skeleton_dsl().encode()
    written = {APP: app, MANIFEST: manifest(b"stale")}

    filled = _members(_fill(_zip(written)))

    assert filled == written


def test_an_app_yaml_over_the_dsl_limit_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    app = _skeleton_dsl().encode()
    monkeypatch.setattr("services.workflow.authoring.fill.DSL_MAX_SIZE", len(app) - 1)

    with pytest.raises(RosterAgentPackageTooLargeError):
        _fill(_zip({APP: app}))


def test_a_manifest_over_its_limit_is_refused(config_overrides: Callable[..., None]) -> None:
    app = _skeleton_dsl().encode()
    manifest = _manifest_for(app)
    config_overrides(AGENT_PACKAGE_MAX_MANIFEST_BYTES=len(manifest) - 1)

    with pytest.raises(RosterAgentPackageTooLargeError):
        _fill(_zip({APP: app, MANIFEST: manifest}))


def test_a_chat_app_passes_through_unchanged() -> None:
    dsl = yaml.safe_dump({"kind": "app", "app": {"mode": AppMode.CHAT.value, "name": "Chat"}, "model_config": {}})
    exported = _exported(dsl)

    assert _members(_fill(exported)) == _members(exported)


def test_a_chat_document_is_not_filled() -> None:
    document = yaml.safe_load(_skeleton_dsl(AppMode.WORKFLOW))
    document["app"]["mode"] = AppMode.CHAT.value
    before = copy.deepcopy(document)

    fill_graph_document(document, CTX)

    assert document == before


def test_an_app_yaml_that_cannot_be_parsed_is_kept() -> None:
    entries = entries_from_folder({APP: io.BytesIO(b"app: [unclosed"), "notes.txt": io.BytesIO(b"n")})

    filled = _members(fill_package(entries, CTX, limits=LIMITS))

    assert (filled[APP], filled["notes.txt"]) == (b"app: [unclosed", b"n")


def test_reading_keeps_sub_folder_paths_and_skips_directories() -> None:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("s_000001/", b"")
        archive.writestr("s_000001/SKILL.md", b"skill")
        archive.writestr(APP, b"kind: app\n")

    entries = read_package_entries(io.BytesIO(output.getvalue()))

    assert {entry.path: b"".join(entry.open()) for entry in entries} == {
        "s_000001/SKILL.md": b"skill",
        APP: b"kind: app\n",
    }


@pytest.mark.parametrize(
    "content",
    [pytest.param(b"not a zip", id="bad-zip"), pytest.param(_zip({"../escape.yaml": b"x"}), id="unsafe-path")],
)
def test_unreadable_packages_are_refused(content: bytes) -> None:
    with pytest.raises(PackageUnreadableError):
        read_package_entries(io.BytesIO(content))


def test_a_package_inflating_past_the_limit_is_refused_before_reading(config_overrides: Callable[..., None]) -> None:
    config_overrides(AGENT_PACKAGE_MAX_BYTES=1024 * 1024)
    bomb = _zip({APP: b"kind: app\n", "zeros.bin": bytes(2 * 1024 * 1024)})
    assert len(bomb) < 64 * 1024

    with pytest.raises(RosterAgentPackageTooLargeError):
        read_package_entries(io.BytesIO(bomb))


def test_a_package_over_the_readers_entry_limit_is_refused_before_reading(
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(AGENT_PACKAGE_MAX_ENTRIES=2)
    at_limit = {APP: b"kind: app\n", "a.txt": b"a"}

    assert len(read_package_entries(io.BytesIO(_zip(at_limit)))) == 2
    with pytest.raises(RosterAgentPackageTooLargeError, match="more than 2"):
        read_package_entries(io.BytesIO(_zip({**at_limit, "b.txt": b"b"})))


def _corrupt_lzma_member() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_LZMA) as archive:
        archive.writestr("notes.txt", b"lzma notes " * 1000)
    content = bytearray(output.getvalue())
    with zipfile.ZipFile(io.BytesIO(bytes(content))) as archive:
        info = archive.getinfo("notes.txt")
    data_start = info.header_offset + 30 + len(info.filename) + len(info.extra)
    for offset in range(data_start + 8, data_start + 40):
        content[offset] ^= 0xFF
    return bytes(content)


def test_a_corrupt_lzma_member_cannot_be_read() -> None:
    [entry] = read_package_entries(io.BytesIO(_corrupt_lzma_member()))

    with pytest.raises(PackageUnreadableError):
        b"".join(entry.open())


def test_entries_are_written_with_deflate() -> None:
    filled = fill_package([ArchiveEntry(APP, lambda: [_skeleton_dsl().encode()])], CTX, limits=LIMITS)

    with zipfile.ZipFile(io.BytesIO(filled)) as archive:
        assert {info.compress_type for info in archive.infolist()} == {zipfile.ZIP_DEFLATED}


def test_limits_bound_the_written_package() -> None:
    entries = entries_from_folder({APP: io.BytesIO(_skeleton_dsl().encode()), "a.txt": io.BytesIO(b"a")})

    with pytest.raises(ArchiveTooLargeError):
        fill_package(entries, CTX, limits=ArchiveLimits(max_entries=2, max_bytes=dify_config.AGENT_PACKAGE_MAX_BYTES))


@pytest.mark.parametrize(
    ("document", "name"),
    [
        ({"app": {"name": "Skeleton"}}, "Skeleton"),
        ({"app": {"name": ["not", "text"]}}, None),
        ({"app": "not a mapping"}, None),
        ({}, None),
        (None, None),
    ],
)
def test_a_filled_package_reads_its_app_name_only_when_it_is_text(
    document: dict[str, object] | None, name: str | None
) -> None:
    root = FilledRoot(app=b"", document=document, submitted=SubmittedRoot(app=b"", manifest=None))

    assert FilledPackage(archive=b"", root=root).app_name == name


def test_a_filled_package_without_an_app_yaml_has_no_app_name() -> None:
    assert FilledPackage(archive=b"", root=None).app_name is None
