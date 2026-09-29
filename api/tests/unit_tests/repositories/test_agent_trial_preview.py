from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from fields.agent_fields import AgentAppComposerResponse
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
from models.model import App, AppMode
from repositories.app_preview_query_repository import AppPreviewQueryRepository
from services.agent.composer_service import AgentComposerService
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.app_preview_query_service import AppPreviewQueryService, AppPreviewRef


def _preview(session: Session, app: AppPreviewRef) -> AgentAppComposerResponse:
    repository = AppPreviewQueryRepository(session_factory=sessionmaker(bind=session.get_bind()))
    result = AppPreviewQueryService(apps=repository, is_previewable=lambda _app_id: True).get_agent_composer(app=app)
    return AgentAppComposerResponse.model_validate(result)


def _published_app(session: Session) -> tuple[App, Agent, AgentConfigSnapshot]:
    tenant_id, app_id, agent_id, snapshot_id = (str(uuid4()) for _ in range(4))
    app = App(id=app_id, tenant_id=tenant_id, name="Sample", mode=AppMode.AGENT, enable_site=False, enable_api=False)
    agent = Agent(
        id=agent_id,
        tenant_id=tenant_id,
        app_id=app_id,
        name="Sample",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
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
                    "cli_tools": [
                        {
                            "name": "search-cli",
                            "env": {"variables": [{"name": "TOKEN", "value": "private-cli-token"}]},
                            "invoke_metadata": {"password": "private-invoke-password"},
                        }
                    ],
                    "dify_tools": [
                        {
                            "provider_type": "api",
                            "provider_id": "private-provider",
                            "tool_name": "search",
                            "runtime_parameters": {"password": "private-password"},
                        }
                    ],
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


def test_detached_preview_reference_preserves_owner_scope(sqlite_session: Session) -> None:
    app, _, _ = _published_app(sqlite_session)
    preview = _preview(sqlite_session, AppPreviewRef(app_id=app.id, tenant_id=app.tenant_id))
    assert preview.agent_soul.prompt.system_prompt == "Published prompt"
    with pytest.raises(AppDefinitionUnavailableError, match="unavailable"):
        _preview(sqlite_session, AppPreviewRef(app_id=app.id, tenant_id=str(uuid4())))


def test_preview_reads_published_snapshot_without_creating_draft(sqlite_session: Session) -> None:
    app, agent, snapshot = _published_app(sqlite_session)
    before = sqlite_session.scalar(select(func.count()).select_from(AgentConfigDraft))

    preview = _preview(sqlite_session, AppPreviewRef(app_id=app.id, tenant_id=app.tenant_id))

    assert preview.agent_soul.prompt.system_prompt == "Published prompt"
    assert preview.agent_soul.model is not None
    assert preview.agent_soul.model.model == "gpt-4o"
    assert preview.agent_soul.config_skills[0].name == "research"
    assert preview.agent_soul.config_files[0].name == "guide.txt"
    assert preview.agent_soul.tools.dify_tools[0].tool_name == "search"
    assert preview.agent.id == agent.id
    assert preview.active_config_snapshot is not None
    assert preview.active_config_snapshot.id == snapshot.id
    assert preview.active_config_is_published is True
    assert preview.draft is None
    assert preview.save_options == []
    assert preview.chat_endpoint is None
    serialized = preview.model_dump_json()
    for value in [
        "private-credential",
        "private-token",
        "private-password",
        "private-cli-token",
        "private-invoke-password",
        app.tenant_id,
    ]:
        assert value not in serialized
    assert sqlite_session.scalar(select(func.count()).select_from(AgentConfigDraft)) == before
    assert not sqlite_session.new
    assert not sqlite_session.dirty


def test_preview_does_not_expose_unpublished_edits(sqlite_session: Session) -> None:
    app, agent, snapshot = _published_app(sqlite_session)
    sqlite_session.add(
        AgentConfigDraft(
            tenant_id=app.tenant_id,
            agent_id=agent.id,
            draft_type=AgentConfigDraftType.DRAFT,
            draft_owner_key="",
            base_snapshot_id=snapshot.id,
            config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "Unpublished secret prompt"}}),
        )
    )
    sqlite_session.commit()

    preview = _preview(sqlite_session, AppPreviewRef(app_id=app.id, tenant_id=app.tenant_id))

    assert preview.agent_soul.prompt.system_prompt == "Published prompt"
    assert "Unpublished" not in preview.model_dump_json()
    editable = AgentAppComposerResponse.model_validate(
        AgentComposerService.load_agent_composer(
            session=sqlite_session,
            tenant_id=app.tenant_id,
            agent_id=agent.id,
        )
    )
    assert editable.agent_soul.prompt.system_prompt == "Unpublished secret prompt"
    assert editable.draft is not None
    assert editable.save_options


def test_preview_rejects_seeded_import_snapshot(sqlite_session: Session) -> None:
    app, agent, _ = _published_app(sqlite_session)
    revision = sqlite_session.scalar(select(AgentConfigRevision).where(AgentConfigRevision.agent_id == agent.id))
    assert revision is not None
    revision.operation = AgentConfigRevisionOperation.IMPORT_PACKAGE
    sqlite_session.commit()

    with pytest.raises(AppDefinitionUnavailableError):
        _preview(sqlite_session, AppPreviewRef(app_id=app.id, tenant_id=app.tenant_id))


def test_preview_rejects_cross_tenant_snapshot(sqlite_session: Session) -> None:
    app, _, snapshot = _published_app(sqlite_session)
    snapshot.tenant_id = str(uuid4())
    sqlite_session.commit()

    with pytest.raises(AppDefinitionUnavailableError, match="unavailable"):
        _preview(sqlite_session, AppPreviewRef(app_id=app.id, tenant_id=app.tenant_id))
