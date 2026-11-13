"""Package icon imports persist destination-owned uploads in one transaction."""

from __future__ import annotations

import hashlib
import io
import zipfile
from collections.abc import Callable, Iterator

import pytest
from PIL import Image
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.storage_type import StorageType
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.agent.errors import RosterAgentPackageResourceUnavailableError
from services.agent.package_resource_importer import AgentPackageResourceImporter
from services.agent.roster_package_entities import PackageIcon, PreparedPackageArchive, RosterAgentPackageMember


class RecordingStorage:
    def __init__(self, *, failure: Exception | None = None) -> None:
        self.saved: list[tuple[str, bytes]] = []
        self.failure = failure

    def save(self, filename: str, data: bytes) -> None:
        if self.failure is not None and len(self.saved) == 1:
            raise self.failure
        self.saved.append((filename, data))


@pytest.fixture
def packaged_icons(
    config_overrides: Callable[..., None],
) -> Iterator[tuple[PreparedPackageArchive, list[PackageIcon], dict[str, bytes]]]:
    config_overrides(STORAGE_TYPE="local")
    payloads: dict[str, bytes] = {}
    icons: list[PackageIcon] = []
    members: dict[str, RosterAgentPackageMember] = {}
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as package:
        for index, (extension, color) in enumerate([("png", "red"), ("jpg", "blue")], start=1):
            image = io.BytesIO()
            Image.new("RGB", (1, 1), color=color).save(image, format="PNG" if extension == "png" else "JPEG")
            payload = image.getvalue()
            icon_id = f"i_{index:06d}"
            path = f"{icon_id}.{extension}"
            digest = hashlib.sha256(payload).hexdigest()
            package.writestr(path, payload)
            payloads[path] = payload
            members[path] = RosterAgentPackageMember(size=len(payload), sha256=digest)
            icons.append(PackageIcon(id=icon_id, path=path, size=len(payload), sha256=digest))
    with PreparedPackageArchive(archive=archive, members=members) as prepared:
        yield prepared, icons, payloads


def test_materialize_icons_commits_destination_owned_uploads(
    packaged_icons: tuple[PreparedPackageArchive, list[PackageIcon], dict[str, bytes]],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    archive, icons, payloads = packaged_icons
    storage = RecordingStorage()

    mapping = AgentPackageResourceImporter(storage_backend=storage).materialize_icons(
        archive=archive, icons=icons, tenant_id="destination", account_id="importer"
    )

    with sqlite_session_factory() as session:
        rows = {row.id: row for row in session.scalars(select(UploadFile))}
    assert set(mapping) == {icon.id for icon in icons}
    assert set(mapping.values()) == set(rows)
    assert len(rows) == 2
    for icon in icons:
        row = rows[mapping[icon.id]]
        payload = payloads[icon.path]
        extension = icon.path.rsplit(".", 1)[1]
        assert row.tenant_id == "destination"
        assert row.created_by == "importer"
        assert row.created_by_role == CreatorUserRole.ACCOUNT
        assert row.storage_type == StorageType.LOCAL
        assert row.name == icon.path
        assert row.size == len(payload)
        assert row.hash == hashlib.sha3_256(payload).hexdigest()
        assert row.mime_type == ("image/png" if extension == "png" else "image/jpeg")
        assert row.key == f"upload_files/destination/{row.id}.{extension}"
    assert storage.saved == [(rows[mapping[icon.id]].key, payloads[icon.path]) for icon in icons]


def test_materialize_icons_storage_failure_does_not_persist_partial_metadata(
    packaged_icons: tuple[PreparedPackageArchive, list[PackageIcon], dict[str, bytes]],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    archive, icons, _ = packaged_icons
    error = OSError("storage unavailable")
    storage = RecordingStorage(failure=error)

    with pytest.raises(RosterAgentPackageResourceUnavailableError) as caught:
        AgentPackageResourceImporter(storage_backend=storage).materialize_icons(
            archive=archive, icons=icons, tenant_id="destination", account_id="importer"
        )

    assert caught.value.__cause__ is error
    with sqlite_session_factory() as session:
        assert list(session.scalars(select(UploadFile))) == []


def test_materialize_icons_commit_failure_rolls_back_all_uploads(
    packaged_icons: tuple[PreparedPackageArchive, list[PackageIcon], dict[str, bytes]],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    archive, icons, _ = packaged_icons
    storage = RecordingStorage()
    error = RuntimeError("database commit failed")

    def fail_commit(session: Session) -> None:
        # Insert the rows in the real transaction before injecting the commit failure.
        session.flush()
        raise error

    event.listen(sqlite_session_factory, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError) as caught:
            AgentPackageResourceImporter(storage_backend=storage).materialize_icons(
                archive=archive, icons=icons, tenant_id="destination", account_id="importer"
            )
    finally:
        event.remove(sqlite_session_factory, "before_commit", fail_commit)

    assert caught.value is error
    with sqlite_session_factory() as session:
        assert list(session.scalars(select(UploadFile))) == []
