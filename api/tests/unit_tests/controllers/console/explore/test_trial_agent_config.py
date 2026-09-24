"""Exercise public template assets through real admission, snapshots, and file services."""

import io
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.test import TestResponse

from controllers.console.app import agent_config_inspector as inspector
from controllers.console.app import preview_admission
from extensions.ext_storage import StorageType
from libs.external_api import ExternalApi
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import CreatorUserRole
from models.model import App, AppMode, RecommendedApp, UploadFile
from models.tools import ToolFile
from repositories.app_preview_query_repository import AppPreviewQueryRepository
from repositories.recommended_app_catalog_repository import DatabaseRecommendedAppCatalogRepository
from services.agent_config_service import AgentConfigService
from services.app_preview_query_service import AppPreviewQueryService


@dataclass
class Harness:
    app: Flask
    factory: sessionmaker[Session]
    source: App
    agent: Agent
    snapshot: AgentConfigSnapshot
    upload_id: str
    skill_id: str
    reads: list[str]

    def url(self, suffix: str) -> str:
        return f"/console/api/trial-apps/{self.source.id}/agent/config/{suffix}"

    def get(self, suffix: str, **query: str) -> TestResponse:
        return self.app.test_client().get(self.url(suffix), query_string=query)


@pytest.fixture
def harness(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> Harness:
    config_overrides(SECRET_KEY="trial-config-test", FILES_URL="http://localhost")
    tenant_id, agent_id, snapshot_id, account_id = (str(uuid4()) for _ in range(4))
    source = App(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name="Template",
        mode=AppMode.AGENT,
        is_public=True,
        enable_site=False,
        enable_api=False,
    )
    agent = Agent(
        id=agent_id,
        tenant_id=tenant_id,
        app_id=source.id,
        name="Template",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        active_config_snapshot_id=snapshot_id,
    )
    skill_id = str(uuid4())
    skill_zip = io.BytesIO()
    with zipfile.ZipFile(skill_zip, "w") as archive:
        archive.writestr("SKILL.md", "---\nname: research\ndescription: Research\n---\nPublished skill")
        archive.writestr("scripts/run.py", "print('published')")
    payloads = {"skill.zip": skill_zip.getvalue(), "guide.txt": b"Published attachment"}
    upload = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key="guide.txt",
        name="guide.txt",
        size=len(payloads["guide.txt"]),
        extension="txt",
        mime_type="text/plain",
        created_by=account_id,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_at=datetime(2026, 1, 1),
        used=False,
    )
    snapshot = AgentConfigSnapshot(
        id=snapshot_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        version=1,
        config_snapshot=AgentSoulConfig.model_validate(
            {
                "config_skills": [{"name": "research", "file_id": skill_id}],
                "config_files": [{"name": "guide.txt", "file_kind": "upload_file", "file_id": upload.id}],
            }
        ),
    )
    skill_file = ToolFile(
        tenant_id=tenant_id,
        user_id=account_id,
        conversation_id=None,
        file_key="skill.zip",
        mimetype="application/zip",
        name="research.zip",
        size=len(payloads["skill.zip"]),
    )
    skill_file.id = skill_id
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                source,
                agent,
                snapshot,
                upload,
                skill_file,
                RecommendedApp(
                    app_id=source.id,
                    description={},
                    copyright="",
                    privacy_policy="",
                    category="Agent",
                    categories=["Agent"],
                    custom_disclaimer="",
                    position=1,
                    is_listed=True,
                    language="en-US",
                ),
                AgentConfigRevision(
                    tenant_id=tenant_id,
                    agent_id=agent_id,
                    current_snapshot_id=snapshot_id,
                    revision=1,
                    operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
                ),
                AgentConfigDraft(
                    tenant_id=tenant_id,
                    agent_id=agent_id,
                    draft_type=AgentConfigDraftType.DRAFT,
                    draft_owner_key="",
                    base_snapshot_id=snapshot_id,
                    config_snapshot=AgentSoulConfig.model_validate(
                        {
                            "config_files": [{"name": "private.txt", "file_kind": "upload_file", "file_id": upload.id}],
                        }
                    ),
                ),
            ]
        )

    reads: list[str] = []

    def load_once(key: str) -> bytes:
        reads.append(key)
        return payloads[key]

    monkeypatch.setattr("services.agent_config_service.storage", SimpleNamespace(load_once=load_once))
    catalog = DatabaseRecommendedAppCatalogRepository(sqlite_session_factory, redis=Mock())
    services = SimpleNamespace(
        app_previews=AppPreviewQueryService(
            apps=AppPreviewQueryRepository(session_factory=sqlite_session_factory),
            is_previewable=catalog.contains,
        )
    )
    monkeypatch.setattr(preview_admission, "application_services", lambda: services)
    monkeypatch.setattr(inspector, "application_services", lambda: services)
    monkeypatch.setattr(inspector, "_service", lambda: AgentConfigService(session_factory=sqlite_session_factory))
    app = Flask(__name__)
    api = ExternalApi(app)
    routes = [
        (inspector.TrialAgentConfigSkillsApi, "skills"),
        (inspector.TrialAgentConfigFilesApi, "files"),
        (inspector.TrialAgentConfigSkillInspectApi, "skills/<string:name>/inspect"),
        (inspector.TrialAgentConfigSkillDownloadApi, "skills/<string:name>/download"),
        (inspector.TrialAgentConfigSkillFilePreviewApi, "skills/<string:name>/files/preview"),
        (inspector.TrialAgentConfigSkillFileDownloadApi, "skills/<string:name>/files/download"),
        (inspector.TrialAgentConfigFilePreviewApi, "files/<string:name>/preview"),
        (inspector.TrialAgentConfigFileDownloadApi, "files/<string:name>/download"),
    ]
    prefix = "/console/api/trial-apps/<uuid:app_id>/agent/config/"
    for resource, suffix in routes:
        api.add_resource(resource, prefix + suffix)
    api.add_resource(
        inspector.TrialAgentConfigSkillFileContentApi,
        prefix + "skills/<string:name>/files/content",
        endpoint="console.trial_agent_config_skill_file_content",
    )
    return Harness(app, sqlite_session_factory, source, agent, snapshot, upload.id, skill_id, reads)


def test_published_template_files_are_readable_without_workspace_membership(harness: Harness) -> None:
    for kind, name in [("skills", "research"), ("files", "guide.txt")]:
        response = harness.get(kind)
        assert response.status_code == 200
        assert response.json is not None
        assert response.json["items"][0]["name"] == name
        assert response.json["config_version"] == {"id": harness.snapshot.id, "kind": "snapshot", "writable": False}
    response = harness.get("skills/research/inspect")
    assert response.status_code == 200
    assert response.json is not None
    assert "Published skill" in response.json["skill_md"]["text"]
    response = harness.get("skills/research/files/preview", path="scripts/run.py")
    assert response.status_code == 200
    assert response.json is not None
    assert response.json["text"] == "print('published')"
    response = harness.get("files/guide.txt/preview", version_id=harness.snapshot.id)
    assert response.status_code == 200
    assert response.json is not None
    assert response.json["text"] == "Published attachment"
    assert response.headers["Cache-Control"] == "no-store"
    for path in ["files/guide.txt/download", "skills/research/download"]:
        response = harness.get(path)
        assert response.status_code == 200
        assert response.json is not None
        assert {"timestamp", "nonce", "sign"} <= parse_qs(urlsplit(response.json["url"]).query).keys()
    response = harness.get("skills/research/files/download", path="scripts/run.py")
    assert response.json is not None
    url = response.json["url"]
    download = harness.app.test_client().get(url)
    assert download.status_code == 200
    assert download.data == b"print('published')"
    assert download.headers["Content-Disposition"].startswith("attachment;")
    with harness.factory() as session:
        assert session.scalar(select(func.count()).select_from(AgentConfigDraft)) == 1
        assert session.scalar(select(func.count()).select_from(UploadFile)) == 1
    with harness.factory.begin() as session:
        app = session.get(App, harness.source.id)
        assert app is not None
        app.is_public = False
    reads_before = list(harness.reads)
    assert harness.app.test_client().get(url).status_code == 404
    assert harness.reads == reads_before


@pytest.mark.parametrize(
    ("query", "status"),
    [
        ({"draft_type": "draft"}, 422),
        ({"file_id": "other"}, 422),
        ({"version_id": str(uuid4())}, 404),
    ],
)
def test_version_and_resource_selectors_cannot_bypass_admission(
    harness: Harness,
    query: dict[str, str],
    status: int,
) -> None:
    assert harness.get("files/guide.txt/preview", **query).status_code == status
    assert harness.reads == []


@pytest.mark.parametrize("path", ["../SKILL.md", "scripts/../../SKILL.md"])
def test_skill_member_paths_cannot_escape_archive(harness: Harness, path: str) -> None:
    assert harness.get("skills/research/files/preview", path=path).status_code == 400
    assert harness.reads == []


@pytest.mark.parametrize("kind", ["file", "skill"])
def test_foreign_tenant_payloads_are_not_read(harness: Harness, kind: str) -> None:
    with harness.factory.begin() as session:
        if kind == "file":
            upload = session.get(UploadFile, harness.upload_id)
            assert upload is not None
            upload.tenant_id = str(uuid4())
        else:
            skill = session.get(ToolFile, harness.skill_id)
            assert skill is not None
            skill.tenant_id = str(uuid4())
    suffix = "files/guide.txt/preview" if kind == "file" else "skills/research/files/preview"
    assert harness.get(suffix, **({"path": "SKILL.md"} if kind == "skill" else {})).status_code == 404
    assert harness.reads == []


def test_draft_only_files_and_writes_are_unavailable(harness: Harness) -> None:
    assert harness.get("files/private.txt/preview").status_code == 404
    for method in ["POST", "PUT", "PATCH", "DELETE"]:
        assert harness.app.test_client().open(harness.url("files"), method=method).status_code == 405
    assert harness.reads == []


@pytest.mark.parametrize(
    ("state", "status"),
    [
        ("unlisted", 404),
        ("unpublished", 400),
        ("foreign_snapshot", 400),
    ],
)
def test_unavailable_template_never_reads_storage(harness: Harness, state: str, status: int) -> None:
    with harness.factory.begin() as session:
        if state == "unlisted":
            listing = session.scalar(select(RecommendedApp).where(RecommendedApp.app_id == harness.source.id))
            assert listing is not None
            listing.is_listed = False
        elif state == "unpublished":
            revision = session.scalar(
                select(AgentConfigRevision).where(AgentConfigRevision.agent_id == harness.agent.id)
            )
            assert revision is not None
            revision.operation = AgentConfigRevisionOperation.IMPORT_PACKAGE
        else:
            snapshot = session.get(AgentConfigSnapshot, harness.snapshot.id)
            assert snapshot is not None
            snapshot.tenant_id = str(uuid4())
    assert harness.get("files/guide.txt/preview").status_code == status
    assert harness.reads == []
