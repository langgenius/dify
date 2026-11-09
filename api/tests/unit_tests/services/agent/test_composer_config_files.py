"""Composer saves preserve assets omitted by ordinary configuration edits."""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker
from typing_extensions import TypedDict

from extensions.storage.storage_type import StorageType
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.enums import CreatorUserRole
from models.model import AppMode, UploadFile
from services.agent.composer_service import AgentComposerService
from services.agent_config_service import (
    AgentConfigService,
    AgentConfigVersionKind,
    ConfigPushFileItem,
    ConfigPushPayload,
)
from services.entities.agent_entities import ComposerSavePayload
from tests.helpers.unit.model_factories import make_account, make_app, make_workflow


@dataclass(frozen=True)
class ComposerTarget:
    tenant_id: str
    account_id: str
    agent_id: str
    draft_id: str
    app_id: str
    binding_id: str | None
    upload_ids: tuple[str, str]


class AssetTargetArgs(TypedDict, closed=True):
    tenant_id: str
    agent_id: str
    user_id: str
    config_version_id: str
    config_version_kind: AgentConfigVersionKind


@pytest.fixture(params=[False, True], ids=["agent", "inline-workflow"])
def composer_target(request: pytest.FixtureRequest, sqlite_session: Session) -> ComposerTarget:
    workflow = bool(request.param)
    tenant_id, account_id, agent_id, snapshot_id, draft_id, app_id = (str(uuid4()) for _ in range(6))
    agent = Agent(
        id=agent_id,
        tenant_id=tenant_id,
        name="Config files test",
        app_id=app_id,
        scope=AgentScope.WORKFLOW_ONLY if workflow else AgentScope.ROSTER,
        source=AgentSource.WORKFLOW if workflow else AgentSource.AGENT_APP,
        active_config_snapshot_id=snapshot_id,
        created_by=account_id,
        updated_by=account_id,
    )
    soul = AgentSoulConfig()
    snapshot = AgentConfigSnapshot(
        id=snapshot_id, tenant_id=tenant_id, agent_id=agent_id, version=1, config_snapshot=soul
    )
    draft = AgentConfigDraft(
        id=draft_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        draft_type=AgentConfigDraftType.DRAFT,
        base_snapshot_id=snapshot_id,
        config_snapshot=soul,
    )
    sqlite_session.add_all(
        [
            agent,
            snapshot,
            draft,
            make_account(account_id=account_id, name="File editor", email="files@example.com"),
            make_app(app_id=app_id, tenant_id=tenant_id, mode=AppMode.WORKFLOW if workflow else AppMode.AGENT_CHAT),
        ]
    )
    binding_id = None
    if workflow:
        workflow_id = str(uuid4())
        backing_app_id = str(uuid4())
        agent.workflow_id = workflow_id
        agent.workflow_node_id = "node-1"
        agent.backing_app_id = backing_app_id
        binding = WorkflowAgentNodeBinding(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_version="draft",
            node_id="node-1",
            binding_type=WorkflowAgentBindingType.INLINE_AGENT,
            agent_id=agent_id,
            current_snapshot_id=snapshot_id,
            node_job_config=WorkflowNodeJobConfig(),
        )
        sqlite_session.add_all(
            [
                binding,
                make_workflow(workflow_id=workflow_id, tenant_id=tenant_id, app_id=app_id),
                make_app(app_id=backing_app_id, tenant_id=tenant_id, mode=AppMode.AGENT_CHAT),
            ]
        )
        sqlite_session.flush()
        binding_id = binding.id
    upload_ids = (str(uuid4()), str(uuid4()))
    for upload_id, name in zip(upload_ids, ["first.md", "second.md"], strict=True):
        upload = UploadFile(
            tenant_id=tenant_id,
            storage_type=StorageType.LOCAL,
            key=f"uploads/{name}",
            name=name,
            size=5,
            extension="md",
            mime_type="text/markdown",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account_id,
            created_at=datetime.now(UTC).replace(tzinfo=None),
            used=False,
            hash=f"hash-{name}",
        )
        upload.id = upload_id
        sqlite_session.add(upload)
    sqlite_session.commit()
    return ComposerTarget(tenant_id, account_id, agent_id, draft_id, app_id, binding_id, upload_ids)


def save_composer(session: Session, target: ComposerTarget, soul: dict[str, object]) -> AgentSoulConfig:
    payload = ComposerSavePayload.model_validate(
        {
            "variant": "workflow" if target.binding_id else "agent_app",
            "save_strategy": "node_job_only" if target.binding_id else "save_to_current_version",
            "agent_soul": soul,
        }
    )
    if target.binding_id:
        state = AgentComposerService.save_workflow_composer(
            session=session,
            tenant_id=target.tenant_id,
            app_id=target.app_id,
            node_id="node-1",
            account_id=target.account_id,
            payload=payload,
        )
    else:
        state = AgentComposerService.save_agent_composer(
            session=session,
            tenant_id=target.tenant_id,
            agent_id=target.agent_id,
            account_id=target.account_id,
            payload=payload,
        )
        session.commit()
    return AgentSoulConfig.model_validate(state["agent_soul"])


def asset_target(target: ComposerTarget) -> AssetTargetArgs:
    return {
        "tenant_id": target.tenant_id,
        "agent_id": target.agent_id,
        "user_id": target.account_id,
        "config_version_id": target.draft_id,
        "config_version_kind": AgentConfigVersionKind.DRAFT,
    }


@pytest.mark.parametrize("file_count", [1, 2], ids=["single-bind", "batch-bind"])
def test_omitted_files_preserve_bindings_created_after_the_composer_was_read(
    sqlite_session_factory: sessionmaker[Session],
    composer_target: ComposerTarget,
    file_count: int,
) -> None:
    target = composer_target
    assets = AgentConfigService(session_factory=sqlite_session_factory)
    with sqlite_session_factory() as stale_session:
        # Keep the old ORM rows cached while another request binds the files.
        _cached_agent = stale_session.get(Agent, target.agent_id)
        _cached_draft = stale_session.get(AgentConfigDraft, target.draft_id)
        if target.binding_id:
            _cached_binding = stale_session.get(WorkflowAgentNodeBinding, target.binding_id)
        if file_count == 1:
            assets.push_file_for_console(**asset_target(target), upload_file_id=target.upload_ids[0])
        else:
            assets.push_files_for_console(**asset_target(target), upload_file_ids=list(target.upload_ids))
        state = save_composer(stale_session, target, {"prompt": {"system_prompt": "An older prompt edit"}})

    assert [item.file_id for item in state.config_files] == list(target.upload_ids[:file_count])
    assert state.prompt.system_prompt == "An older prompt edit"
    with sqlite_session_factory() as session:
        draft = session.get(AgentConfigDraft, target.draft_id)
        assert draft is not None
        assert [item.file_id for item in draft.config_snapshot.config_files] == list(target.upload_ids[:file_count])


def test_omitted_files_do_not_restore_an_asset_deleted_after_the_composer_was_read(
    sqlite_session_factory: sessionmaker[Session],
    composer_target: ComposerTarget,
) -> None:
    target = composer_target
    assets = AgentConfigService(session_factory=sqlite_session_factory)
    assets.push_file_for_console(**asset_target(target), upload_file_id=target.upload_ids[0])
    with sqlite_session_factory() as stale_session:
        _cached_draft = stale_session.get(AgentConfigDraft, target.draft_id)
        assets.push_for_console(
            **asset_target(target), payload=ConfigPushPayload(files=[ConfigPushFileItem(name="first.md")])
        )
        state = save_composer(stale_session, target, {"prompt": {"system_prompt": "Keep this edit"}})
    assert state.config_files == []


@pytest.mark.parametrize("delete_existing", [False, True], ids=["keep-batch", "keep-deletion"])
def test_omitted_files_do_not_autoflush_a_dirty_cached_snapshot_before_locking(
    sqlite_session_factory: sessionmaker[Session],
    composer_target: ComposerTarget,
    delete_existing: bool,
) -> None:
    target = composer_target
    assets = AgentConfigService(session_factory=sqlite_session_factory)
    if delete_existing:
        assets.push_file_for_console(**asset_target(target), upload_file_id=target.upload_ids[0])
    with sqlite_session_factory() as stale_session:
        cached = stale_session.get(AgentConfigDraft, target.draft_id)
        assert cached is not None
        local_edit = cached.config_snapshot.model_copy(deep=True)
        local_edit.config_note = "Pending local note"
        cached.config_snapshot = local_edit
        if delete_existing:
            assets.push_for_console(
                **asset_target(target),
                payload=ConfigPushPayload(files=[ConfigPushFileItem(name="first.md")]),
            )
        else:
            assets.push_files_for_console(**asset_target(target), upload_file_ids=list(target.upload_ids))
        result = save_composer(stale_session, target, {"prompt": {"system_prompt": "Ordinary edit"}})
    assert [file.file_id for file in result.config_files] == ([] if delete_existing else list(target.upload_ids))


@pytest.mark.parametrize("replace_with_file", [False, True], ids=["explicit-clear", "explicit-replace"])
def test_explicit_files_keep_complete_replacement_semantics(
    sqlite_session_factory: sessionmaker[Session],
    composer_target: ComposerTarget,
    replace_with_file: bool,
) -> None:
    target = composer_target
    assets = AgentConfigService(session_factory=sqlite_session_factory)
    assets.push_file_for_console(**asset_target(target), upload_file_id=target.upload_ids[0])
    files: list[dict[str, str]] = (
        [{"name": "second.md", "file_kind": "upload_file", "file_id": target.upload_ids[1]}]
        if replace_with_file
        else []
    )
    with sqlite_session_factory() as session:
        state = save_composer(
            session, target, {"prompt": {"system_prompt": "Applied configuration"}, "config_files": files}
        )
    assert [item.file_id for item in state.config_files] == ([target.upload_ids[1]] if replace_with_file else [])


@pytest.mark.parametrize("composer_target", [True], indirect=True, ids=["inline-workflow"])
def test_omitted_files_refresh_a_cached_inline_snapshot_and_binding(
    sqlite_session_factory: sessionmaker[Session],
    composer_target: ComposerTarget,
) -> None:
    target = composer_target
    assert target.binding_id is not None
    with sqlite_session_factory() as stale_session:
        stale_agent = stale_session.get(Agent, target.agent_id)
        stale_binding = stale_session.get(WorkflowAgentNodeBinding, target.binding_id)
        stale_draft = stale_session.get(AgentConfigDraft, target.draft_id)
        assert stale_agent is not None
        assert stale_binding is not None
        assert stale_draft is not None
        with sqlite_session_factory() as other_session:
            save_composer(
                other_session,
                target,
                {
                    "config_files": [
                        {
                            "name": "second.md",
                            "file_kind": "upload_file",
                            "file_id": target.upload_ids[1],
                        }
                    ]
                },
            )
        state = save_composer(stale_session, target, {"prompt": {"system_prompt": "Next edit"}})
    assert [item.file_id for item in state.config_files] == [target.upload_ids[1]]


def test_locking_the_latest_draft_keeps_pending_agent_profile_edits(
    sqlite_session_factory: sessionmaker[Session],
    composer_target: ComposerTarget,
) -> None:
    target = composer_target
    assets = AgentConfigService(session_factory=sqlite_session_factory)
    with sqlite_session_factory() as session:
        agent = session.get(Agent, target.agent_id)
        _cached_draft = session.get(AgentConfigDraft, target.draft_id)
        assert agent is not None
        agent.name = "Renamed in this transaction"
        assets.push_file_for_console(**asset_target(target), upload_file_id=target.upload_ids[0])
        draft = AgentComposerService.get_or_create_normal_agent_draft(
            session=session,
            tenant_id=target.tenant_id,
            agent=agent,
            created_by=target.account_id,
        )
        assert agent.name == "Renamed in this transaction"
        assert [item.file_id for item in draft.config_snapshot.config_files] == [target.upload_ids[0]]
        session.commit()
    with sqlite_session_factory() as session:
        saved_agent = session.get(Agent, target.agent_id)
        assert saved_agent is not None
        assert saved_agent.name == "Renamed in this transaction"


@pytest.mark.parametrize("composer_target", [True], indirect=True, ids=["inline-workflow"])
def test_inline_composer_shows_file_edits_before_the_next_node_save(
    sqlite_session_factory: sessionmaker[Session],
    composer_target: ComposerTarget,
) -> None:
    target = composer_target
    assets = AgentConfigService(session_factory=sqlite_session_factory)

    def loaded_file_ids(snapshot_id: str | None = None) -> list[str | None]:
        with sqlite_session_factory() as session:
            state = AgentComposerService.load_workflow_composer(
                session=session,
                tenant_id=target.tenant_id,
                app_id=target.app_id,
                node_id="node-1",
                snapshot_id=snapshot_id,
            )
        return [item.file_id for item in AgentSoulConfig.model_validate(state["agent_soul"]).config_files]

    assets.push_files_for_console(**asset_target(target), upload_file_ids=list(target.upload_ids))
    assert loaded_file_ids() == list(target.upload_ids)
    with sqlite_session_factory() as session:
        agent = session.get(Agent, target.agent_id)
        assert agent is not None
        bound_snapshot_id = agent.active_config_snapshot_id
    assert loaded_file_ids(bound_snapshot_id) == []

    assets.push_for_console(
        **asset_target(target), payload=ConfigPushPayload(files=[ConfigPushFileItem(name="first.md")])
    )
    assert loaded_file_ids() == [target.upload_ids[1]]
