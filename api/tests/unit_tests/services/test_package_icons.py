"""Packaged image icons travel with Apps and receive destination-owned file ids."""

import hashlib
import io
import zipfile
from collections.abc import Callable
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock
from uuid import uuid4

import pytest
import yaml

from services.agent.errors import (
    InvalidRosterAgentPackageError,
    RosterAgentPackageExportFailedError,
    RosterAgentPackageTooLargeError,
)
from services.agent.package_resource_exporter import AgentPackageResourceExporter, _FileSource, _SkillSource
from services.agent.package_resource_importer import AgentPackageResourceImporter
from services.agent.roster_package_entities import PackageIcon, PreparedPackageArchive, RosterAgentPackageMember
from services.app_package_service import AppPackageService


def _icon_archive(*, payload: bytes = b"image", digest: str | None = None, reference: str = "i_000001") -> io.BytesIO:
    dsl = yaml.safe_dump({"kind": "app", "app": {"mode": "chat", "icon_type": "image", "icon": reference}})
    with AppPackageService().export(dsl=dsl.replace(reference, "legacy-id"), name="Example") as exported:
        with zipfile.ZipFile(exported.archive) as package:
            manifest = yaml.safe_load(package.read("manifest.yaml"))
    app_bytes = dsl.encode()
    manifest["apps"][0].update(size=len(app_bytes), sha256=hashlib.sha256(app_bytes).hexdigest())
    manifest["icons"] = [
        {
            "id": "i_000001",
            "path": "i_000001.png",
            "size": len(payload),
            "sha256": digest or hashlib.sha256(payload).hexdigest(),
        }
    ]
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as package:
        package.writestr("manifest.yaml", yaml.safe_dump(manifest))
        package.writestr("app.yaml", app_bytes)
        package.writestr("i_000001.png", payload)
    output.seek(0)
    return output


def test_app_icon_export_deduplicates_uploads_and_restores_references(monkeypatch: pytest.MonkeyPatch) -> None:
    source_id = str(uuid4())
    payload = b"image payload"
    backend = Mock()
    backend.load_stream.side_effect = lambda _: iter([payload])
    exporter = AgentPackageResourceExporter(storage_backend=backend)
    upload_lookup = Mock(return_value={source_id: SimpleNamespace(key="source/icon.png", extension="png")})
    monkeypatch.setattr(exporter, "_upload_files", upload_lookup)
    metadata = {"mode": "chat", "icon_type": "image", "icon": source_id}
    duplicate = dict(metadata)
    exporter.collect_icon(session=Mock(), tenant_id="source-tenant", metadata=metadata)
    exporter.collect_icon(session=Mock(), tenant_id="source-tenant", metadata=duplicate)
    assert metadata["icon"] == duplicate["icon"] == "i_000001"
    assert upload_lookup.call_args.kwargs["tenant_id"] == "source-tenant"
    assert upload_lookup.call_count == 1
    dsl = yaml.safe_dump({"kind": "app", "app": metadata})
    with AppPackageService().export(dsl=dsl, name="Example", resources=exporter) as exported:
        with zipfile.ZipFile(exported.archive) as package:
            assert package.read("i_000001.png") == payload
        exported.archive.seek(0)
        prepared = AppPackageService().read_package(exported.archive)
        assert prepared is not None
        with prepared:
            restore = Mock(return_value={"i_000001": "destination-id"})
            monkeypatch.setattr(AgentPackageResourceImporter, "materialize_icons", restore)
            data = yaml.safe_load(prepared.dsl)
            prepared.materialize_icons(data=data, tenant_id="destination", account_id="account")
            assert data["app"]["icon"] == "destination-id"
            assert restore.call_args.kwargs["tenant_id"] == "destination"


def test_icon_export_rejects_unavailable_tenant_upload(monkeypatch: pytest.MonkeyPatch) -> None:
    exporter = AgentPackageResourceExporter(storage_backend=Mock())
    monkeypatch.setattr(exporter, "_upload_files", Mock(return_value={}))
    with pytest.raises(RosterAgentPackageExportFailedError, match="unavailable"):
        exporter.collect_icon(session=Mock(), tenant_id="tenant", metadata={"icon_type": "image", "icon": str(uuid4())})


def test_icon_checksum_is_required() -> None:
    with pytest.raises(InvalidRosterAgentPackageError, match="integrity"):
        AppPackageService().read_package(_icon_archive(digest="0" * 64))


@pytest.mark.parametrize("reference", ["i_000002", "unrelated-upload"])
def test_icon_must_resolve_to_metadata(reference: str) -> None:
    with pytest.raises(InvalidRosterAgentPackageError, match="references"):
        AppPackageService().read_package(_icon_archive(reference=reference))


def test_icon_image_limit_is_enforced(config_overrides: Callable[..., None]) -> None:
    config_overrides(UPLOAD_IMAGE_FILE_SIZE_LIMIT=0)
    with pytest.raises(RosterAgentPackageTooLargeError, match="image size"):
        AppPackageService().read_package(_icon_archive())


def test_materialized_icon_is_owned_by_destination(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = b"image payload"
    digest = hashlib.sha256(payload).hexdigest()
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as package:
        package.writestr("i_000001.png", payload)
    prepared = PreparedPackageArchive(
        archive=archive, members={"i_000001.png": RosterAgentPackageMember(size=len(payload), sha256=digest)}
    )
    icon = PackageIcon(id="i_000001", path="i_000001.png", size=len(payload), sha256=digest)
    session = MagicMock()
    monkeypatch.setattr(
        "services.agent.package_resource_importer.session_factory.create_session",
        MagicMock(return_value=session),
    )
    backend = Mock()
    with prepared:
        mapping = AgentPackageResourceImporter(storage_backend=backend).materialize_icons(
            archive=prepared, icons=[icon], tenant_id="destination", account_id="importer"
        )
    row = session.__enter__.return_value.add_all.call_args.args[0][0]
    assert row.id == mapping["i_000001"]
    assert row.tenant_id == "destination"
    assert row.created_by == "importer"
    assert row.mime_type == "image/png"
    assert row.key.startswith("upload_files/destination/")
    backend.save.assert_called_once_with(row.key, payload)


def test_roster_export_embeds_agent_icon(monkeypatch: pytest.MonkeyPatch) -> None:
    from models.agent_config_entities import AgentSoulConfig
    from models.model import App
    from services.agent.dsl_entities import AgentPackage, AgentPackageMetadata, make_agent_app_dsl
    from services.agent.roster_package_exporter import RosterAgentPackageExporter
    from services.agent.roster_package_reader import RosterAgentPackageReader

    backend = Mock()
    backend.load_stream.side_effect = lambda _: iter([b"icon"])
    resources = AgentPackageResourceExporter(storage_backend=backend)
    resources.sources["agent_1"] = (list[_SkillSource](), list[_FileSource]())
    metadata = {"name": "Agent", "icon_type": "image", "icon": "source-id"}
    monkeypatch.setattr(
        resources,
        "_upload_files",
        Mock(
            return_value={
                "source-id": SimpleNamespace(key="icon.png", extension="png"),
            }
        ),
    )
    resources.collect_icon(session=Mock(), tenant_id="source", metadata=metadata)
    app = make_agent_app_dsl(
        App(name="Agent", mode="agent"),
        package_ref="agent_1",
        packages={
            "agent_1": AgentPackage(metadata=AgentPackageMetadata.model_validate(metadata), soul=AgentSoulConfig())
        },
        dependencies=[],
    )
    with RosterAgentPackageExporter(storage_backend=backend)._build_archive(app=app, resources=resources) as exported:
        with RosterAgentPackageReader().read(exported.archive) as prepared:
            assert prepared.apps["app.yaml"].package.metadata.icon == "i_000001"
            assert prepared.manifest.icons[0].path == "i_000001.png"
            assert RosterAgentPackageReader().read_member_bytes(prepared, "i_000001.png", max_bytes=4) == b"icon"
