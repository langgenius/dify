from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from models.agent import (
    Agent,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import WorkflowNodeJobConfig
from models.workflow import Workflow
from services.agent import composer_service, roster_service
from services.agent.composer_service import AgentComposerService
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.errors import InvalidComposerConfigError
from services.agent.roster_service import AgentRosterService
from services.agent.workflow_publish_service import WorkflowAgentPublishService
from services.entities.agent_entities import AgentSoulConfig, ComposerSavePayload, ComposerSaveStrategy, ComposerVariant


class FakeScalarResult:
    def __init__(self, values):
        self.values = values

    def all(self):
        return self.values


class FakeSession:
    def __init__(self, *, scalars=None, scalar=None):
        self._scalars = list(scalars or [])
        self._scalar = list(scalar or [])
        self.added = []
        self.deleted = []
        self.commits = 0
        self.flushes = 0
        self.rollbacks = 0

    def scalar(self, _stmt):
        if self._scalar:
            return self._scalar.pop(0)
        return None

    def scalars(self, _stmt):
        if self._scalars:
            return FakeScalarResult(self._scalars.pop(0))
        return FakeScalarResult([])

    def add(self, value):
        self.added.append(value)

    def delete(self, value):
        self.deleted.append(value)

    def flush(self):
        self.flushes += 1
        for index, value in enumerate(self.added, start=1):
            if getattr(value, "id", None) is None:
                value.id = f"generated-{index}"

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_load_workflow_composer_returns_empty_state(monkeypatch):
    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **kwargs: None)

    result = AgentComposerService.load_workflow_composer(tenant_id="tenant-1", app_id="app-1", node_id="node-1")

    assert result["binding"] is None
    assert result["save_options"] == ["node_job_only", "save_to_roster"]
    assert result["workflow_id"] == "workflow-1"
    # Stage 4 §4.1 / §10.1 (D-3): empty state still surfaces PRD defaults so
    # the front-end has stable output names to render before the user declares
    # anything.
    effective = result["effective_declared_outputs"]
    assert [o["name"] for o in effective] == ["text", "files", "json"]
    files_output = next(o for o in effective if o["name"] == "files")
    assert files_output["array_item"] == {"type": "file", "description": None}


def test_load_workflow_composer_serializes_existing_binding(monkeypatch):
    binding = SimpleNamespace(
        agent_id="agent-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        current_snapshot_id="version-1",
    )
    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **kwargs: binding)
    monkeypatch.setattr(
        AgentComposerService,
        "_get_agent_if_present",
        lambda **kwargs: SimpleNamespace(id="agent-1", active_config_snapshot_id="version-1"),
    )
    monkeypatch.setattr(
        AgentComposerService,
        "_get_version_if_present",
        lambda **kwargs: SimpleNamespace(id="version-1"),
    )
    monkeypatch.setattr(
        AgentComposerService,
        "_serialize_workflow_state",
        lambda **kwargs: {"agent": kwargs["agent"].id, "version": kwargs["version"].id},
    )

    result = AgentComposerService.load_workflow_composer(tenant_id="tenant-1", app_id="app-1", node_id="node-1")

    assert result == {"agent": "agent-1", "version": "version-1"}


@pytest.mark.parametrize(
    ("strategy", "helper_name"),
    [
        (ComposerSaveStrategy.NODE_JOB_ONLY, "_save_node_job_only"),
        (ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION, "_save_to_current_version"),
        (ComposerSaveStrategy.SAVE_AS_NEW_VERSION, "_save_as_new_version"),
        (ComposerSaveStrategy.SAVE_AS_NEW_AGENT, "_save_as_new_agent"),
        (ComposerSaveStrategy.SAVE_TO_ROSTER, "_save_to_roster"),
    ],
)
def test_save_workflow_composer_dispatches_save_strategy(monkeypatch, strategy, helper_name):
    fake_session = FakeSession()
    binding = SimpleNamespace(
        agent_id="agent-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        current_snapshot_id="version-1",
    )
    calls = []

    monkeypatch.setattr(composer_service.db, "session", fake_session)
    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_save_payload", lambda payload: None)
    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **kwargs: None)
    monkeypatch.setattr(
        AgentComposerService,
        "_get_agent_if_present",
        lambda **kwargs: SimpleNamespace(id="agent-1", active_config_snapshot_id="version-1"),
    )
    monkeypatch.setattr(
        AgentComposerService,
        "_get_version_if_present",
        lambda **kwargs: SimpleNamespace(id="version-1"),
    )
    monkeypatch.setattr(AgentComposerService, "_serialize_workflow_state", lambda **kwargs: {"state": "ok"})

    def save_helper(**kwargs):
        calls.append(kwargs)
        return binding

    monkeypatch.setattr(AgentComposerService, helper_name, save_helper)
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.WORKFLOW.value,
            "save_strategy": strategy.value,
            "agent_soul": {"prompt": {"system_prompt": "x"}},
        }
    )

    result = AgentComposerService.save_workflow_composer(
        tenant_id="tenant-1", app_id="app-1", node_id="node-1", account_id="account-1", payload=payload
    )

    assert result.pop("validation") == {"warnings": [], "knowledge_retrieval_placeholder": []}
    assert result == {"state": "ok"}
    assert calls
    assert fake_session.commits == 1


def test_save_workflow_composer_rejects_agent_app_variant():
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.AGENT_APP.value,
            "save_strategy": ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION.value,
            "agent_soul": {"prompt": {"system_prompt": "x"}},
        }
    )

    with pytest.raises(ValueError):
        AgentComposerService.save_workflow_composer(
            tenant_id="tenant-1", app_id="app-1", node_id="node-1", account_id="account-1", payload=payload
        )


def test_save_agent_app_composer_creates_agent_when_missing(monkeypatch):
    fake_session = FakeSession(scalar=[None])
    created_version = SimpleNamespace(id="version-1")

    monkeypatch.setattr(composer_service.db, "session", fake_session)
    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_save_payload", lambda payload: None)
    monkeypatch.setattr(AgentComposerService, "_create_config_version", lambda **kwargs: created_version)
    monkeypatch.setattr(AgentComposerService, "load_agent_app_composer", lambda **kwargs: {"loaded": True})
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.AGENT_APP.value,
            "save_strategy": ComposerSaveStrategy.SAVE_AS_NEW_VERSION.value,
            "new_agent_name": "Analyst",
            "agent_soul": {"prompt": {"system_prompt": "x"}},
        }
    )

    result = AgentComposerService.save_agent_app_composer(
        tenant_id="tenant-1", app_id="app-1", account_id="account-1", payload=payload
    )

    assert result.pop("validation") == {"warnings": [], "knowledge_retrieval_placeholder": []}
    assert result == {"loaded": True}
    assert fake_session.added[0].name == "Analyst"
    assert fake_session.added[0].active_config_snapshot_id == "version-1"
    assert fake_session.commits == 1


def test_save_agent_app_composer_updates_current_version(monkeypatch):
    fake_session = FakeSession(
        scalar=[SimpleNamespace(id="agent-1", active_config_snapshot_id="version-1", updated_by=None)]
    )
    updated = {}

    monkeypatch.setattr(composer_service.db, "session", fake_session)
    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_save_payload", lambda payload: None)
    monkeypatch.setattr(AgentComposerService, "_require_version", lambda **kwargs: SimpleNamespace(id="version-1"))
    monkeypatch.setattr(
        AgentComposerService,
        "_update_current_version",
        lambda **kwargs: updated.update(kwargs) or SimpleNamespace(id="version-2"),
    )
    monkeypatch.setattr(AgentComposerService, "load_agent_app_composer", lambda **kwargs: {"loaded": True})
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.AGENT_APP.value,
            "save_strategy": ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION.value,
            "agent_soul": {"prompt": {"system_prompt": "updated"}},
        }
    )

    result = AgentComposerService.save_agent_app_composer(
        tenant_id="tenant-1", app_id="app-1", account_id="account-1", payload=payload
    )

    assert result.pop("validation") == {"warnings": [], "knowledge_retrieval_placeholder": []}
    assert result == {"loaded": True}
    assert updated["operation"].value == "save_current_version"
    assert fake_session._scalar == []
    assert fake_session.commits == 1


def test_agent_app_composer_candidates_and_impact(monkeypatch):
    bindings = [
        SimpleNamespace(app_id="app-1", workflow_id="workflow-1", node_id="node-1"),
        SimpleNamespace(app_id="app-1", workflow_id="workflow-1", node_id="node-2"),
    ]
    monkeypatch.setattr(composer_service.db, "session", FakeSession(scalars=[bindings]))

    # Candidates assembly is covered in test_composer_candidates.py; here we stub
    # the IO loaders and assert the response envelope per variant (ENG-615).
    def _no_draft_workflow(**kwargs):
        raise ValueError("draft workflow not found")

    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", _no_draft_workflow)
    monkeypatch.setattr(AgentComposerService, "_load_agent_app_soul", lambda **kwargs: None)
    monkeypatch.setattr(AgentComposerService, "_workspace_dify_tools", lambda **kwargs: [])

    workflow_candidates = AgentComposerService.get_workflow_candidates(
        tenant_id="tenant-1", app_id="app-1", node_id="node-1", user_id="account-1"
    )
    agent_app_candidates = AgentComposerService.get_agent_app_candidates(
        tenant_id="tenant-1", app_id="app-1", user_id="account-1"
    )
    impact = AgentComposerService.calculate_impact(tenant_id="tenant-1", current_snapshot_id="version-1")

    assert workflow_candidates["variant"] == "workflow"
    assert workflow_candidates["allowed_node_job_candidates"]["previous_node_outputs"] == []
    assert workflow_candidates["truncated"] is False
    assert agent_app_candidates["variant"] == "agent_app"
    assert agent_app_candidates["allowed_soul_candidates"]["dify_tools"] == []
    assert impact["workflow_node_count"] == 2
    assert impact["bindings"][1]["node_id"] == "node-2"


def test_serialize_workflow_state_changes_lock_and_save_options(monkeypatch):
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="agent-1",
        current_snapshot_id="version-1",
        workflow_id="workflow-1",
        node_id="node-1",
        node_job_config='{"workflow_prompt":"do work"}',
    )
    agent = Agent(id="agent-1", name="Analyst", description="", scope=AgentScope.ROSTER, status=AgentStatus.ACTIVE)
    version = AgentConfigSnapshot(id="version-1", version=1, config_snapshot='{"prompt":{"system_prompt":"x"}}')
    monkeypatch.setattr(AgentComposerService, "calculate_impact", lambda **kwargs: {"workflow_node_count": 1})

    state = AgentComposerService._serialize_workflow_state(binding=binding, agent=agent, version=version)

    assert state["soul_lock"]["locked"] is True
    assert "save_as_new_version" in state["save_options"]
    assert state["agent_soul"]["app_features"] == {}
    # Stage 4 §10.1 (D-3): binding with no declared_outputs → response surfaces
    # PRD defaults via effective_declared_outputs (DB row remains untouched).
    effective_names = [o["name"] for o in state["effective_declared_outputs"]]
    assert effective_names == ["text", "files", "json"]


def test_serialize_workflow_state_passes_user_declared_outputs_through_effective(monkeypatch):
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="agent-1",
        current_snapshot_id="version-1",
        workflow_id="workflow-1",
        node_id="node-1",
        node_job_config=(
            '{"workflow_prompt":"work","declared_outputs":[{"name":"summary","type":"string","required":true}]}'
        ),
    )
    agent = Agent(id="agent-1", name="Analyst", description="", scope=AgentScope.ROSTER, status=AgentStatus.ACTIVE)
    version = AgentConfigSnapshot(id="version-1", version=1, config_snapshot='{"prompt":{"system_prompt":"x"}}')
    monkeypatch.setattr(AgentComposerService, "calculate_impact", lambda **kwargs: {"workflow_node_count": 1})

    state = AgentComposerService._serialize_workflow_state(binding=binding, agent=agent, version=version)

    # When the user has declared outputs, effective_declared_outputs is the same
    # list (no defaults injected).
    effective = state["effective_declared_outputs"]
    assert [o["name"] for o in effective] == ["summary"]
    assert effective[0]["type"] == "string"
    assert effective[0]["required"] is True


def test_composer_save_helpers_create_and_rebind_agents(monkeypatch):
    fake_session = FakeSession()
    monkeypatch.setattr(composer_service.db, "session", fake_session)
    workflow_agent = SimpleNamespace(id="inline-agent-1", active_config_snapshot_id="inline-version-1")
    roster_agent = SimpleNamespace(id="roster-agent-1", active_config_snapshot_id="roster-version-1", name="Roster")
    monkeypatch.setattr(AgentComposerService, "_create_workflow_only_agent", lambda **kwargs: workflow_agent)
    monkeypatch.setattr(AgentComposerService, "_create_roster_agent_for_composer", lambda **kwargs: roster_agent)
    monkeypatch.setattr(AgentComposerService, "_require_agent", lambda **kwargs: roster_agent)
    monkeypatch.setattr(
        AgentComposerService,
        "_require_version",
        lambda **kwargs: AgentConfigSnapshot(
            id="source-version-1",
            tenant_id="tenant-1",
            agent_id="roster-agent-1",
            version=1,
            config_snapshot='{"prompt":{"system_prompt":"old"}}',
        ),
    )
    monkeypatch.setattr(
        AgentComposerService,
        "_create_config_version",
        lambda **kwargs: AgentConfigSnapshot(id="new-version-1", version=2),
    )

    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.WORKFLOW.value,
            "save_strategy": ComposerSaveStrategy.NODE_JOB_ONLY.value,
            "agent_soul": {"prompt": {"system_prompt": "new"}},
            "node_job": {"workflow_prompt": "use prior output"},
            "new_agent_name": "Copied Agent",
        }
    )
    existing_binding = WorkflowAgentNodeBinding(agent_id="inline-agent-1", current_snapshot_id="inline-version-1")

    updated_binding = AgentComposerService._save_node_job_only(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="node-1",
        account_id="account-1",
        binding=existing_binding,
        payload=payload,
    )
    inline_binding = AgentComposerService._save_node_job_only(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="node-2",
        account_id="account-1",
        binding=None,
        payload=payload,
    )
    new_agent_binding = AgentComposerService._save_as_new_agent(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="node-3",
        account_id="account-1",
        binding=None,
        payload=payload,
    )
    save_to_roster_binding = AgentComposerService._save_to_roster(
        tenant_id="tenant-1",
        account_id="account-1",
        binding=WorkflowAgentNodeBinding(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            node_id="node-4",
            agent_id="inline-agent-1",
            current_snapshot_id="inline-version-1",
        ),
        payload=payload,
    )
    new_version_binding = AgentComposerService._save_as_new_version(
        tenant_id="tenant-1",
        account_id="account-1",
        binding=WorkflowAgentNodeBinding(agent_id="roster-agent-1", current_snapshot_id="source-version-1"),
        payload=payload,
    )

    assert updated_binding.updated_by == "account-1"
    assert inline_binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT
    assert inline_binding.agent_id == "inline-agent-1"
    assert new_agent_binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
    assert save_to_roster_binding.agent_id == "roster-agent-1"
    assert new_version_binding.current_snapshot_id == "new-version-1"


def test_composer_version_helpers_and_lookup_errors(monkeypatch):
    fake_session = FakeSession(
        scalar=[
            1,
            3,
            2,
            4,
            SimpleNamespace(id="workflow-1"),
            None,
            SimpleNamespace(id="agent-1"),
            None,
            SimpleNamespace(id="version-1"),
            None,
        ]
    )
    monkeypatch.setattr(composer_service.db, "session", fake_session)
    agent_soul = AgentSoulConfig.model_validate({"prompt": {"system_prompt": "new"}})

    version = AgentComposerService._create_config_version(
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
        agent_soul=agent_soul,
        operation=AgentConfigRevisionOperation.SAVE_NEW_VERSION,
        version_note="note",
    )
    updated_snapshot = AgentComposerService._update_current_version(
        current_snapshot=AgentConfigSnapshot(
            id="version-1",
            tenant_id="tenant-1",
            agent_id="agent-1",
            version=1,
            config_snapshot='{"prompt":{"system_prompt":"old"}}',
        ),
        account_id="account-1",
        agent_soul=agent_soul,
        operation=AgentConfigRevisionOperation.SAVE_CURRENT_VERSION,
        version_note="updated",
    )
    workflow = AgentComposerService._get_draft_workflow(tenant_id="tenant-1", app_id="app-1")

    with pytest.raises(ValueError):
        AgentComposerService._get_draft_workflow(tenant_id="tenant-1", app_id="missing")
    assert AgentComposerService._require_agent(tenant_id="tenant-1", agent_id="agent-1").id == "agent-1"
    with pytest.raises(composer_service.AgentNotFoundError):
        AgentComposerService._require_agent(tenant_id="tenant-1", agent_id=None)
    assert AgentComposerService._get_agent_if_present(tenant_id="tenant-1", agent_id="agent-1") is None
    assert (
        AgentComposerService._require_version(tenant_id="tenant-1", agent_id="agent-1", version_id="version-1").id
        == "version-1"
    )
    with pytest.raises(composer_service.AgentVersionNotFoundError):
        AgentComposerService._require_version(tenant_id="tenant-1", agent_id="agent-1", version_id="missing")

    assert version.version == 2
    assert updated_snapshot.version == 3
    assert workflow.id == "workflow-1"


def test_composer_current_version_and_error_paths(monkeypatch):
    fake_session = FakeSession(scalar=[2])
    monkeypatch.setattr(composer_service.db, "session", fake_session)
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.WORKFLOW.value,
            "save_strategy": ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION.value,
            "agent_soul": {"prompt": {"system_prompt": "updated"}},
            "node_job": {"workflow_prompt": "job"},
        }
    )
    binding = WorkflowAgentNodeBinding(agent_id="agent-1", current_snapshot_id="version-1")
    version = AgentConfigSnapshot(
        id="version-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot='{"prompt":{"system_prompt":"old"}}',
    )
    monkeypatch.setattr(AgentComposerService, "_require_version", lambda **kwargs: version)
    monkeypatch.setattr(AgentComposerService, "_require_agent", lambda **kwargs: SimpleNamespace(updated_by=None))

    result = AgentComposerService._save_to_current_version(
        tenant_id="tenant-1", account_id="account-1", binding=binding, payload=payload
    )

    assert result.updated_by == "account-1"
    assert result.current_snapshot_id != "version-1"
    with pytest.raises(ValueError):
        AgentComposerService._require_binding(None)
    with pytest.raises(ValueError):
        AgentComposerService._save_as_new_agent(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            node_id="node-1",
            account_id="account-1",
            binding=None,
            payload=ComposerSavePayload.model_validate(
                {
                    "variant": ComposerVariant.WORKFLOW.value,
                    "save_strategy": ComposerSaveStrategy.SAVE_AS_NEW_AGENT.value,
                }
            ),
        )


def test_roster_list_and_invite_options(monkeypatch):
    created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    updated_at = datetime(2026, 1, 3, 3, 4, 5, tzinfo=UTC)
    version_created_at = datetime(2026, 1, 4, 3, 4, 5, tzinfo=UTC)
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Analyst",
        description="",
        role="researcher",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    agent.created_at = created_at
    agent.updated_at = updated_at
    version = AgentConfigSnapshot(id="version-1", agent_id="agent-1", version=1)
    version.created_at = version_created_at
    agent.active_config_snapshot_id = "version-1"
    fake_session = FakeSession(
        scalar=[1, 1, SimpleNamespace(id="workflow-1")],
        scalars=[[agent], [agent], [SimpleNamespace(agent_id="agent-1", node_id="node-1")]],
    )
    service = AgentRosterService(fake_session)
    monkeypatch.setattr(service, "_load_versions_by_id", lambda version_ids: {"version-1": version})
    monkeypatch.setattr(service, "_load_published_references_by_agent_id", lambda **kwargs: {})

    listed = service.list_roster_agents(tenant_id="tenant-1", page=1, limit=20)
    invited = service.list_invite_options(tenant_id="tenant-1", page=1, limit=20, app_id="app-1")

    assert listed["data"][0]["active_config_snapshot"]["id"] == "version-1"
    assert listed["data"][0]["role"] == "researcher"
    assert listed["data"][0]["created_at"] == int(created_at.timestamp())
    assert listed["data"][0]["updated_at"] == int(updated_at.timestamp())
    assert listed["data"][0]["active_config_snapshot"]["created_at"] == int(version_created_at.timestamp())
    assert invited["data"][0]["is_in_current_workflow"] is True
    assert invited["data"][0]["existing_node_ids"] == ["node-1"]


def test_roster_update_archive_versions_and_detail(monkeypatch):
    listed_version = AgentConfigSnapshot(id="version-2", agent_id="agent-1", version=2)
    listed_version_created_at = datetime(2026, 1, 5, 3, 4, 5, tzinfo=UTC)
    listed_version.created_at = listed_version_created_at
    revision_created_at = datetime(2026, 1, 6, 3, 4, 5, tzinfo=UTC)
    revision = SimpleNamespace(
        id="revision-1",
        previous_snapshot_id=None,
        current_snapshot_id="version-1",
        revision=1,
        operation=AgentConfigRevisionOperation.CREATE_VERSION,
        summary=None,
        version_note=None,
        created_by="account-1",
        created_at=revision_created_at,
    )
    fake_session = FakeSession(scalars=[[listed_version], [revision]])
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Analyst",
        description="old",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    version = AgentConfigSnapshot(id="version-1", agent_id="agent-1", version=1, config_snapshot='{"prompt":{}}')
    version.created_at = datetime(2026, 1, 4, 3, 4, 5, tzinfo=UTC)

    service = AgentRosterService(fake_session)
    monkeypatch.setattr(service, "_get_agent", lambda **kwargs: agent)
    monkeypatch.setattr(service, "_get_version", lambda **kwargs: version)
    monkeypatch.setattr(
        service,
        "get_roster_agent_detail",
        lambda **kwargs: {"id": kwargs["agent_id"], "description": agent.description},
    )

    updated = service.update_roster_agent(
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
        payload=roster_service.RosterAgentUpdatePayload(description="new"),
    )
    service.archive_roster_agent(tenant_id="tenant-1", agent_id="agent-1", account_id="account-1")
    versions = service.list_agent_versions(tenant_id="tenant-1", agent_id="agent-1")
    detail = service.get_agent_version_detail(tenant_id="tenant-1", agent_id="agent-1", version_id="version-1")

    assert updated["description"] == "new"
    assert agent.status == AgentStatus.ARCHIVED
    assert versions[0]["id"] == "version-2"
    assert versions[0]["created_at"] == int(listed_version_created_at.timestamp())
    assert detail["config_snapshot"] == {"prompt": {}}
    assert detail["created_at"] == int(version.created_at.timestamp())
    assert detail["revisions"][0]["created_at"] == int(revision_created_at.timestamp())


def test_roster_create_detail_and_lookup_helpers(monkeypatch):
    fake_session = FakeSession(
        scalar=[
            SimpleNamespace(id="agent-1"),
            None,
            SimpleNamespace(id="version-1"),
            None,
        ],
        scalars=[[AgentConfigSnapshot(id="version-1", agent_id="agent-1", version=1)]],
    )
    service = AgentRosterService(fake_session)
    payload = roster_service.RosterAgentCreatePayload(
        name="Analyst",
        description="desc",
        icon_type="emoji",
        icon="A",
        icon_background="#fff",
        agent_soul=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "x"}}),
        version_note="initial",
    )

    created = service.create_roster_agent(tenant_id="tenant-1", account_id="account-1", payload=payload)
    found_agent = service._get_agent(tenant_id="tenant-1", agent_id="agent-1")
    with pytest.raises(roster_service.AgentNotFoundError):
        service._get_agent(tenant_id="tenant-1", agent_id="missing")
    found_version = service._get_version(tenant_id="tenant-1", agent_id="agent-1", version_id="version-1")
    with pytest.raises(roster_service.AgentVersionNotFoundError):
        service._get_version(tenant_id="tenant-1", agent_id="agent-1", version_id=None)
    loaded_versions = service._load_versions_by_id(["version-1"])
    assert service._load_versions_by_id([]) == {}

    assert created.name == "Analyst"
    assert created.active_config_snapshot_id is not None
    assert found_agent.id == "agent-1"
    assert found_version.id == "version-1"
    assert loaded_versions["version-1"].agent_id == "agent-1"


def test_validator_dict_helpers_wrap_validation_errors():
    valid_soul = ComposerConfigValidator.validate_agent_soul_dict({"prompt": {"system_prompt": "x"}})
    valid_node_job = ComposerConfigValidator.validate_node_job_dict({"workflow_prompt": "x"})

    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict({"prompt": "not-a-dict"})
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_node_job_dict({"declared_outputs": [{"type": "string"}]})

    assert valid_soul.prompt.system_prompt == "x"
    assert valid_node_job.workflow_prompt == "x"


def test_composer_validator_rejects_stage_4_declared_output_violations():
    """Stage 4 §10.1: the model-layer validators surface stage-4-specific
    violations through InvalidComposerConfigError so the Composer save endpoint
    reports them with the same error shape as other shape failures.
    """
    # Output name violates the JSON-schema-friendly identifier pattern.
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_node_job_dict({"declared_outputs": [{"name": "1bad", "type": "string"}]})

    # Output check is enabled on a non-file output.
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_node_job_dict(
            {
                "declared_outputs": [
                    {
                        "name": "text",
                        "type": "string",
                        "check": {
                            "enabled": True,
                            "prompt": "p",
                            "benchmark_file_ref": {"file_id": "f"},
                        },
                    }
                ]
            }
        )

    # default_value shape doesn't match the declared type.
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_node_job_dict(
            {
                "declared_outputs": [
                    {
                        "name": "score",
                        "type": "number",
                        "failure_strategy": {
                            "on_failure": "default_value",
                            "default_value": "not a number",
                        },
                    }
                ]
            }
        )

    # Nested array_item is rejected outright.
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_node_job_dict(
            {"declared_outputs": [{"name": "matrix", "type": "array", "array_item": {"type": "array"}}]}
        )


def test_composer_validator_rejects_invalid_shell_env_and_cli():
    """ENG-367/368: env/secret names must be valid shell identifiers (no collisions),
    and an enabled CLI tool must declare a name or install command — caught at composer
    save instead of failing later in the agent backend shell layer."""
    # env var name is not a valid shell identifier
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict({"env": {"variables": [{"name": "bad-name"}]}})

    # secret ref name is not a valid shell identifier
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict({"env": {"secret_refs": [{"name": "1TOKEN"}]}})

    # env var and secret ref share the shell namespace -> collision
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict(
            {
                "env": {
                    "variables": [{"name": "TOKEN", "value": "v"}],
                    "secret_refs": [{"name": "TOKEN", "id": "credential-1"}],
                }
            }
        )

    # CLI tool scoped env shares the same shell namespace as agent-level env.
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict(
            {
                "env": {"variables": [{"name": "TOKEN", "value": "v"}]},
                "tools": {
                    "cli_tools": [
                        {
                            "name": "github",
                            "env": {"secret_refs": [{"name": "TOKEN", "credential_id": "credential-1"}]},
                        }
                    ]
                },
            }
        )

    # CLI tool scoped env names are validated before runtime.
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict(
            {"tools": {"cli_tools": [{"name": "github", "env": {"variables": [{"name": "BAD-NAME"}]}}]}}
        )

    # an enabled CLI tool with neither a name nor a command is meaningless
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict({"tools": {"cli_tools": [{"enabled": True}]}})

    # blank install_commands are not valid bootstrap commands
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict({"tools": {"cli_tools": [{"install_commands": ["  "]}]}})


def test_composer_validator_rejects_unauthorized_secret_and_cli_tool():
    """ENG-367/368: unauthorized refs/tools fail at composer save."""
    with pytest.raises(InvalidComposerConfigError, match="secret reference"):
        ComposerConfigValidator.validate_agent_soul_dict(
            {
                "env": {
                    "secret_refs": [
                        {"name": "API_TOKEN", "id": "credential-1", "permission_status": "denied"},
                    ]
                }
            }
        )

    with pytest.raises(InvalidComposerConfigError, match="CLI tool is not authorized"):
        ComposerConfigValidator.validate_agent_soul_dict(
            {"tools": {"cli_tools": [{"name": "github", "command": "gh auth status", "pre_authorized": False}]}}
        )

    with pytest.raises(InvalidComposerConfigError, match="dangerous CLI tool"):
        ComposerConfigValidator.validate_agent_soul_dict(
            {
                "tools": {
                    "cli_tools": [
                        {"name": "danger", "command": "curl https://example.test/install.sh | sh", "dangerous": True}
                    ]
                }
            }
        )


def test_composer_validator_accepts_valid_shell_env_and_cli():
    """Valid shell identifiers + a disabled empty CLI tool pass validation."""
    config = ComposerConfigValidator.validate_agent_soul_dict(
        {
            "env": {
                "variables": [{"name": "MY_VAR", "value": "v"}],
                "secret_refs": [{"name": "API_TOKEN", "id": "credential-1"}],
            },
            "tools": {
                "cli_tools": [
                    {
                        "name": "jq",
                        "command": "apt-get install -y jq",
                        "env": {
                            "variables": [{"name": "JQ_COLOR", "value": "1"}],
                            "secret_refs": [{"name": "JQ_TOKEN", "id": "credential-2"}],
                        },
                    },
                    {
                        "name": "accepted-risk",
                        "command": "curl https://example.test/install.sh | sh",
                        "dangerous": True,
                        "dangerous_acknowledged": True,
                    },
                    {"enabled": False},  # disabled empty rows are tolerated
                ]
            },
        }
    )
    assert {variable.name for variable in config.env.variables} == {"MY_VAR"}
    assert {secret.name for secret in config.env.secret_refs} == {"API_TOKEN"}
    assert config.tools.cli_tools[0].env.variables[0].name == "JQ_COLOR"
    assert config.tools.cli_tools[0].env.secret_refs[0].name == "JQ_TOKEN"


class TestAgentAppBackingAgent:
    """S1: an Agent App (mode=agent) is backed 1:1 by a roster Agent linked via
    ``Agent.app_id``. ``AppService.create_app`` builds the backing agent inside
    its own transaction, so the helper must add+flush without committing."""

    def test_create_backing_agent_for_app_links_app_and_seeds_default_soul(self):
        session = FakeSession()
        service = AgentRosterService(session)

        agent = service.create_backing_agent_for_app(
            tenant_id="tenant-1",
            account_id="account-1",
            app_id="app-1",
            name="Iris",
            description="clarifier",
        )

        # Agent is bound to the app and is a roster/agent_app entry.
        assert agent.app_id == "app-1"
        assert agent.scope == AgentScope.ROSTER
        assert agent.source == AgentSource.AGENT_APP
        assert agent.status == AgentStatus.ACTIVE
        assert agent.agent_kind == AgentKind.DIFY_AGENT
        assert agent.name == "Iris"
        # A v1 snapshot + revision are seeded and wired as the active version.
        snapshots = [a for a in session.added if isinstance(a, AgentConfigSnapshot)]
        assert len(snapshots) == 1
        assert snapshots[0].version == 1
        assert agent.active_config_snapshot_id == snapshots[0].id
        revisions = [
            a for a in session.added if getattr(a, "operation", None) == AgentConfigRevisionOperation.CREATE_VERSION
        ]
        assert len(revisions) == 1
        # Caller (AppService.create_app) owns the commit — helper must not commit.
        assert session.commits == 0

    def test_get_app_backing_agent_queries_active_agent_app_agent(self):
        sentinel = SimpleNamespace(id="agent-1", app_id="app-1")
        session = FakeSession(scalar=[sentinel])
        service = AgentRosterService(session)

        result = service.get_app_backing_agent(tenant_id="tenant-1", app_id="app-1")

        assert result is sentinel

    def test_get_app_backing_agent_returns_none_when_unbound(self):
        session = FakeSession()
        service = AgentRosterService(session)

        assert service.get_app_backing_agent(tenant_id="tenant-1", app_id="app-x") is None


class TestListWorkflowsReferencingAppAgent:
    def test_groups_bindings_by_workflow_app_and_sorts_by_name(self):
        agent = SimpleNamespace(id="agent-1")
        bindings = [
            SimpleNamespace(
                agent_id="agent-1", app_id="wf-app-1", workflow_id="wf-1", workflow_version="v1", node_id="node-b"
            ),
            SimpleNamespace(
                agent_id="agent-1", app_id="wf-app-1", workflow_id="wf-1", workflow_version="v1", node_id="node-a"
            ),
            SimpleNamespace(
                agent_id="agent-1", app_id="wf-app-2", workflow_id="wf-2", workflow_version="v2", node_id="node-a"
            ),
        ]
        apps = [
            SimpleNamespace(id="wf-app-1", name="Beta Flow", mode="workflow", workflow_id="wf-1"),
            SimpleNamespace(id="wf-app-2", name="Alpha Flow", mode="advanced-chat", workflow_id="wf-2"),
        ]
        # scalar -> backing agent; scalars -> bindings, then resolved apps.
        session = FakeSession(scalar=[agent], scalars=[bindings, apps])
        service = AgentRosterService(session)

        result = service.list_workflows_referencing_app_agent(tenant_id="tenant-1", app_id="app-1")

        assert [r["app_name"] for r in result] == ["Alpha Flow", "Beta Flow"]
        beta = next(r for r in result if r["app_id"] == "wf-app-1")
        assert beta["node_ids"] == ["node-a", "node-b"]  # deduped + sorted
        assert beta["workflow_id"] == "wf-1"
        assert beta["workflow_version"] == "v1"

    def test_returns_empty_when_no_backing_agent(self):
        session = FakeSession()  # scalar() -> None
        service = AgentRosterService(session)

        assert service.list_workflows_referencing_app_agent(tenant_id="tenant-1", app_id="app-x") == []

    def test_returns_empty_when_no_bindings(self):
        agent = SimpleNamespace(id="agent-1")
        session = FakeSession(scalar=[agent], scalars=[[]])
        service = AgentRosterService(session)

        assert service.list_workflows_referencing_app_agent(tenant_id="tenant-1", app_id="app-1") == []

    def test_skips_orphaned_binding_whose_app_is_gone(self):
        agent = SimpleNamespace(id="agent-1")
        bindings = [
            SimpleNamespace(
                agent_id="agent-1", app_id="wf-app-gone", workflow_id="wf-9", workflow_version="v9", node_id="node-a"
            )
        ]
        session = FakeSession(scalar=[agent], scalars=[bindings, []])  # no apps resolved
        service = AgentRosterService(session)

        assert service.list_workflows_referencing_app_agent(tenant_id="tenant-1", app_id="app-1") == []

    def test_skips_historical_published_workflow_versions(self):
        agent = SimpleNamespace(id="agent-1")
        bindings = [
            SimpleNamespace(
                agent_id="agent-1", app_id="wf-app-1", workflow_id="old-wf", workflow_version="old", node_id="old"
            ),
            SimpleNamespace(
                agent_id="agent-1", app_id="wf-app-1", workflow_id="current-wf", workflow_version="v2", node_id="new"
            ),
        ]
        apps = [SimpleNamespace(id="wf-app-1", name="Flow", mode="workflow", workflow_id="current-wf")]
        session = FakeSession(scalar=[agent], scalars=[bindings, apps])
        service = AgentRosterService(session)

        result = service.list_workflows_referencing_app_agent(tenant_id="tenant-1", app_id="app-1")

        assert len(result) == 1
        assert result[0]["workflow_id"] == "current-wf"
        assert result[0]["node_ids"] == ["new"]


class TestWorkflowAgentDraftBindingSync:
    def test_creates_roster_binding_from_agent_node_graph(self):
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph='{"nodes":[{"id":"agent-node","data":{"type":"agent","version":"2","agent_binding":{"binding_type":"roster_agent","agent_id":"agent-1"}}}]}',
        )
        agent = Agent(
            id="agent-1",
            tenant_id="tenant-1",
            name="Agent",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id="snapshot-2",
        )
        session = FakeSession(scalar=[agent], scalars=[[]])

        WorkflowAgentPublishService.sync_roster_agent_bindings_for_draft(
            session=session,
            draft_workflow=workflow,
            account_id="account-1",
        )

        binding = next(item for item in session.added if isinstance(item, WorkflowAgentNodeBinding))
        assert binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
        assert binding.agent_id == "agent-1"
        assert binding.current_snapshot_id == "snapshot-2"
        assert binding.node_job_config_dict == WorkflowNodeJobConfig().model_dump(mode="json")

    def test_deletes_draft_binding_when_agent_node_removed(self):
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph='{"nodes":[]}',
        )
        stale_binding = WorkflowAgentNodeBinding(
            id="binding-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="removed-node",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="agent-1",
            current_snapshot_id="snapshot-1",
            node_job_config=WorkflowNodeJobConfig(),
        )
        session = FakeSession(scalars=[[stale_binding]])

        WorkflowAgentPublishService.sync_roster_agent_bindings_for_draft(
            session=session,
            draft_workflow=workflow,
            account_id="account-1",
        )

        assert session.deleted == [stale_binding]


def test_dataset_rows_filters_malformed_ids(monkeypatch):
    """Mention ids are user-editable text: a non-UUID id must read as missing
    (placeholder semantics), never reach the UUID-typed dataset query (E2E 500)."""
    captured = {}

    def fake_get_datasets_by_ids(ids, tenant_id):
        captured["ids"] = ids
        return [], 0

    import services.dataset_service as dataset_service_module

    monkeypatch.setattr(dataset_service_module.DatasetService, "get_datasets_by_ids", fake_get_datasets_by_ids)

    valid = "550e8400-e29b-41d4-a716-446655440000"
    rows = AgentComposerService._dataset_rows(tenant_id="tenant-1", dataset_ids=["9999dead-beef", valid])
    assert rows == {}
    assert captured["ids"] == [valid]

    # all-malformed input never touches the DB
    captured.clear()
    assert AgentComposerService._dataset_rows(tenant_id="tenant-1", dataset_ids=["nope"]) == {}
    assert captured == {}


def test_workspace_dify_tools_returns_provider_and_tool_granularities(monkeypatch):
    """The slash-menu Tools tab needs both selection granularities: a provider
    hosts many tools (like an MCP server), so candidates return one
    provider-level entry (id = <provider>/*, = all tools) plus one per tool."""
    from types import SimpleNamespace

    provider = SimpleNamespace(
        name="duckduckgo",
        plugin_id="langgenius/duckduckgo",
        label=SimpleNamespace(en_US="DuckDuckGo"),
        description=SimpleNamespace(en_US="Privacy-first web search"),
        tools=[
            SimpleNamespace(name="ddg_search", label=SimpleNamespace(en_US="DuckDuckGo Search")),
            SimpleNamespace(name="ddg_news", label=SimpleNamespace(en_US="DuckDuckGo News")),
        ],
    )

    import services.tools.builtin_tools_manage_service as builtin_tools_module

    monkeypatch.setattr(
        builtin_tools_module.BuiltinToolManageService,
        "list_builtin_tools",
        staticmethod(lambda user_id, tenant_id: [provider]),
    )

    entries = AgentComposerService._workspace_dify_tools(tenant_id="tenant-1", user_id="user-1")

    assert entries[0] == {
        "id": "duckduckgo/*",
        "granularity": "provider",
        "name": "DuckDuckGo",
        "description": "Privacy-first web search",
        "provider": "duckduckgo",
        "plugin_id": "langgenius/duckduckgo",
        "tools_count": 2,
    }
    assert [entry["id"] for entry in entries[1:]] == ["duckduckgo/ddg_search", "duckduckgo/ddg_news"]
    assert {entry["granularity"] for entry in entries[1:]} == {"tool"}
