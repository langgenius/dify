from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from models.agent import Agent, AgentConfigDraft, AgentConfigRevision, AgentConfigRevisionOperation, AgentConfigSnapshot
from models.agent_config_entities import AgentSoulConfig
from models.model import App, AppMode
from models.skill import AgentSkillBindingSnapshot, Skill, SkillVersion, SkillVersionManifest
from repositories.app_preview_query_repository import AppPreviewQueryRepository
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.app_preview_query_service import AppPreviewQueryService, AppPreviewRef


def _preview(session: Session, app: AppPreviewRef):
    repository = AppPreviewQueryRepository(session_factory=sessionmaker(bind=session.get_bind()))
    return AppPreviewQueryService(apps=repository, is_previewable=lambda _app_id: True).get_agent_preview(app=app)


def _published_app(session: Session) -> tuple[App, Agent, AgentConfigSnapshot]:
    tenant_id, app_id, agent_id, snapshot_id = (str(uuid4()) for _ in range(4))
    app = App(id=app_id, tenant_id=tenant_id, name="Sample", mode=AppMode.AGENT, enable_site=False, enable_api=False)
    agent = Agent(
        id=agent_id,
        tenant_id=tenant_id,
        app_id=app_id,
        name="Sample",
        scope="roster",
        source="agent_app",
        active_config_snapshot_id=snapshot_id,
        active_config_is_published=False,
    )
    snapshot = AgentConfigSnapshot(
        id=snapshot_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        version=1,
        config_snapshot=AgentSoulConfig.model_validate(
            {
                "prompt": {"system_prompt": "Published prompt"},
                "model": {
                    "plugin_id": "langgenius/openai",
                    "model_provider": "langgenius/openai/openai",
                    "model": "gpt-4o",
                    "credential_ref": {"type": "provider", "id": "private-credential"},
                },
                "env": {"variables": [{"name": "TOKEN", "value": "private-token"}]},
                "config_skills": [{"name": "research", "file_id": "private-skill", "description": "Research skill"}],
                "config_files": [{"name": "guide.txt", "file_kind": "upload_file", "file_id": "private-file"}],
                "tools": {
                    "dify_tools": [
                        {
                            "provider_type": "api",
                            "provider_id": "private-provider",
                            "tool_name": "search",
                            "runtime_parameters": {"password": "private-password"},
                        }
                    ]
                },
            }
        ),
    )
    session.add_all(
        [
            app,
            agent,
            snapshot,
            AgentConfigRevision(
                tenant_id=tenant_id,
                agent_id=agent_id,
                current_snapshot_id=snapshot_id,
                revision=1,
                operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
            ),
        ]
    )
    session.commit()
    return app, agent, snapshot


def test_detached_preview_reference_preserves_owner_scope(sqlite_session: Session):
    app, _, _ = _published_app(sqlite_session)
    preview = _preview(sqlite_session, AppPreviewRef(app_id=app.id, tenant_id=app.tenant_id))
    assert preview.system_prompt == "Published prompt"
    with pytest.raises(AppDefinitionUnavailableError, match="unavailable"):
        _preview(sqlite_session, AppPreviewRef(app_id=app.id, tenant_id=str(uuid4())))


def test_preview_reads_published_snapshot_without_creating_draft(sqlite_session: Session):
    app, agent, snapshot = _published_app(sqlite_session)
    before = sqlite_session.scalar(select(func.count()).select_from(AgentConfigDraft))

    preview = _preview(sqlite_session, AppPreviewRef(app_id=app.id, tenant_id=app.tenant_id))

    assert preview.system_prompt == "Published prompt"
    assert preview.model is not None
    assert preview.model.model == "gpt-4o"
    assert preview.skills[0].name == "research"
    assert preview.files[0].name == "guide.txt"
    assert preview.tools[0].name == "search"
    serialized = preview.model_dump_json()
    for value in ["private-", app.tenant_id, agent.id, snapshot.id]:
        assert value not in serialized
    assert sqlite_session.scalar(select(func.count()).select_from(AgentConfigDraft)) == before
    assert not sqlite_session.new
    assert not sqlite_session.dirty


def test_preview_does_not_expose_unpublished_edits(sqlite_session: Session):
    app, agent, snapshot = _published_app(sqlite_session)
    sqlite_session.add(
        AgentConfigDraft(
            tenant_id=app.tenant_id,
            agent_id=agent.id,
            draft_type="draft",
            draft_owner_key="",
            base_snapshot_id=snapshot.id,
            config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "Unpublished secret prompt"}}),
        )
    )
    sqlite_session.commit()

    preview = _preview(sqlite_session, AppPreviewRef(app_id=app.id, tenant_id=app.tenant_id))

    assert preview.system_prompt == "Published prompt"
    assert "Unpublished" not in preview.model_dump_json()


def test_preview_rejects_seeded_import_snapshot(sqlite_session: Session):
    app, agent, _ = _published_app(sqlite_session)
    revision = sqlite_session.scalar(select(AgentConfigRevision).where(AgentConfigRevision.agent_id == agent.id))
    assert revision is not None
    revision.operation = AgentConfigRevisionOperation.IMPORT_PACKAGE
    sqlite_session.commit()

    with pytest.raises(AppDefinitionUnavailableError):
        _preview(sqlite_session, AppPreviewRef(app_id=app.id, tenant_id=app.tenant_id))


def test_preview_rejects_cross_tenant_snapshot(sqlite_session: Session):
    app, _, snapshot = _published_app(sqlite_session)
    snapshot.tenant_id = str(uuid4())
    sqlite_session.commit()

    with pytest.raises(AppDefinitionUnavailableError, match="unavailable"):
        _preview(sqlite_session, AppPreviewRef(app_id=app.id, tenant_id=app.tenant_id))


def test_preview_uses_published_workspace_skill_metadata(sqlite_session: Session):
    app, agent, snapshot = _published_app(sqlite_session)
    skill_id, version_id = str(uuid4()), str(uuid4())
    sqlite_session.add_all(
        [
            Skill(
                id=skill_id,
                tenant_id=app.tenant_id,
                name="researcher",
                display_name="Private draft name",
                description="Private draft description",
                latest_published_version_id=version_id,
            ),
            SkillVersion(
                id=version_id,
                skill_id=skill_id,
                version_number=1,
                archive_tool_file_id=str(uuid4()),
                hash_code="hash",
                archive_size=1,
                manifest=SkillVersionManifest(
                    files=[], name="researcher", display_name="Published Research", description="Published description"
                ),
            ),
            AgentSkillBindingSnapshot(
                tenant_id=app.tenant_id,
                agent_id=agent.id,
                config_snapshot_id=snapshot.id,
                skill_id=skill_id,
                priority=0,
            ),
        ]
    )
    sqlite_session.commit()

    preview = _preview(sqlite_session, AppPreviewRef(app_id=app.id, tenant_id=app.tenant_id))

    assert preview.skills[-1].name == "Published Research"
    assert preview.skills[-1].description == "Published description"
    assert "Private draft" not in preview.model_dump_json()
