"""Trusted identity mapping reaches real quota persistence without storage bypasses."""

from collections.abc import Callable
from dataclasses import dataclass, field

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition
from extensions.application_services.files import build_file_upload_services
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.end_user_upload_service import WorkspaceUploadQuotaExceededError
from services.file_service import FileService, FileUploadActor, FileUploadResult
from tests.helpers.unit.model_factories import make_end_user, make_tenant


@dataclass
class Objects:
    """Only the external storage boundary is substituted."""

    values: dict[str, bytes] = field(default_factory=dict)

    def save(self, filename: str, data: bytes) -> None:
        """Write externally visible bytes under their generated object key."""
        self.values[filename] = data

    def load_once(self, filename: str) -> bytes:
        """Read stored bytes, raising only confirmed absence as FileNotFoundError."""
        if filename not in self.values:
            raise FileNotFoundError(filename)
        return self.values[filename]


@pytest.mark.parametrize("actor_reference", [False, True])
def test_end_user_gateway_retains_response_and_enforces_quota(
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
    actor_reference: bool,
) -> None:
    """Local and reconstructed actors share one policy and preserve source/creator metadata."""
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, WORKSPACE_UPLOAD_QUOTA_FILES=1)
    objects = Objects()
    monkeypatch.setattr("extensions.application_services.files.storage", objects)
    user = make_end_user(end_user_id="end-user", tenant_id="workspace")
    with sqlite_session_factory.begin() as session:
        session.add_all([make_tenant(tenant_id="workspace"), user])
    gateway = build_file_upload_services(
        database_client=sqlite_session_factory,
        staff=FileService(sqlite_session_factory),
        deployment_edition=DeploymentEdition.COMMUNITY,
    ).gateway
    actor = FileUploadActor(id=user.id, creator_role=CreatorUserRole.END_USER) if actor_reference else user
    result = gateway.upload_file(
        user=actor,
        tenant_id="workspace",
        filename="file.txt",
        content=b"file",
        mimetype="text/plain",
        source_url="https://example.com/original.txt",
    )
    assert isinstance(result, FileUploadResult)
    assert (result.tenant_id, result.created_by, result.name, result.size) == ("workspace", user.id, "file.txt", 4)
    assert result.source_url == "https://example.com/original.txt"
    with pytest.raises(WorkspaceUploadQuotaExceededError):
        gateway.upload_file(
            user=actor, tenant_id="workspace", filename="file.txt", content=b"file", mimetype="text/plain"
        )
    with sqlite_session_factory() as session:
        persisted = session.scalars(select(UploadFile)).one()
        assert persisted.created_by_role == CreatorUserRole.END_USER
        assert objects.values == {persisted.key: b"file"}


def test_legacy_path_cannot_bypass_end_user_admission(sqlite_session_factory: sessionmaker[Session]) -> None:
    """An old direct caller is rejected before touching storage or adding metadata."""
    with pytest.raises(TypeError, match="FileUploadGateway"):
        FileService(sqlite_session_factory).upload_file(
            user=make_end_user(), filename="a.txt", content=b"a", mimetype="text/plain"
        )
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(UploadFile)) == 0
