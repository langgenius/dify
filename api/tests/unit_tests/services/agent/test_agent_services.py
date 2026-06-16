import json
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
from models.agent_config_entities import (
    AgentFileRefConfig,
    DeclaredOutputConfig,
    DeclaredOutputType,
    WorkflowNodeJobConfig,
)
from models.workflow import Workflow
from services.agent import composer_service, roster_service
from services.agent.agent_soul_state import agent_soul_has_model
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


def _agent_soul_with_model() -> AgentSoulConfig:
    return AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai/openai",
                "model_provider": "openai",
                "model": "gpt-4o",
            }
        }
    )


def test_agent_soul_has_model():
    assert agent_soul_has_model(_agent_soul_with_model()) is True
    assert agent_soul_has_model(AgentSoulConfig()) is False


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
    assert fake_session.added[0].active_config_has_model is False
    assert fake_session.commits == 1


def test_save_agent_app_composer_updates_current_version(monkeypatch):
    agent = SimpleNamespace(id="agent-1", active_config_snapshot_id="version-1", updated_by=None)
    fake_session = FakeSession(scalar=[agent])
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
            "agent_soul": _agent_soul_with_model().model_dump(mode="json"),
        }
    )

    result = AgentComposerService.save_agent_app_composer(
        tenant_id="tenant-1", app_id="app-1", account_id="account-1", payload=payload
    )

    assert result.pop("validation") == {"warnings": [], "knowledge_retrieval_placeholder": []}
    assert result == {"loaded": True}
    assert updated["operation"].value == "save_current_version"
    assert agent.active_config_has_model is True
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


def test_composer_create_agents_syncs_active_config_has_model(monkeypatch):
    fake_session = FakeSession()
    monkeypatch.setattr(composer_service.db, "session", fake_session)
    monkeypatch.setattr(
        AgentComposerService,
        "_create_config_version",
        lambda **kwargs: SimpleNamespace(id="version-with-model"),
    )

    workflow_agent = AgentComposerService._create_workflow_only_agent(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="node-1",
        account_id="account-1",
        agent_soul=_agent_soul_with_model(),
    )
    roster_agent = AgentComposerService._create_roster_agent_for_composer(
        tenant_id="tenant-1",
        account_id="account-1",
        name="Ready Agent",
        agent_soul=_agent_soul_with_model(),
        operation=AgentConfigRevisionOperation.CREATE_VERSION,
        version_note=None,
    )

    assert workflow_agent.active_config_snapshot_id == "version-with-model"
    assert workflow_agent.active_config_has_model is True
    assert roster_agent.active_config_snapshot_id == "version-with-model"
    assert roster_agent.active_config_has_model is True


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
    version = AgentConfigSnapshot(
        id="version-1", agent_id="agent-1", version=1, config_snapshot=_agent_soul_with_model()
    )
    version.created_at = version_created_at
    agent.active_config_snapshot_id = "version-1"
    agent.active_config_has_model = True
    unconfigured_agent = Agent(
        id="agent-2",
        tenant_id="tenant-1",
        name="Draft Agent",
        description="",
        role="draft",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    unconfigured_agent.active_config_snapshot_id = "version-2"
    unconfigured_agent.active_config_has_model = False
    unconfigured_version = AgentConfigSnapshot(
        id="version-2", agent_id="agent-2", version=1, config_snapshot=AgentSoulConfig()
    )
    fake_session = FakeSession(
        scalar=[2, 1, SimpleNamespace(id="workflow-1")],
        scalars=[
            [agent, unconfigured_agent],
            [agent],
            [SimpleNamespace(agent_id="agent-1", node_id="node-1")],
        ],
    )
    service = AgentRosterService(fake_session)
    monkeypatch.setattr(
        service,
        "_load_versions_by_id",
        lambda version_ids: {"version-1": version, "version-2": unconfigured_version},
    )
    monkeypatch.setattr(service, "_load_published_references_by_agent_id", lambda **kwargs: {})

    listed = service.list_roster_agents(tenant_id="tenant-1", page=1, limit=20)
    invited = service.list_invite_options(tenant_id="tenant-1", page=1, limit=20, app_id="app-1")

    assert [item["id"] for item in listed["data"]] == ["agent-1", "agent-2"]
    assert [item["id"] for item in invited["data"]] == ["agent-1"]
    assert invited["total"] == 1
    assert listed["data"][0]["active_config_snapshot"]["id"] == "version-1"
    assert listed["data"][0]["role"] == "researcher"
    assert listed["data"][0]["created_at"] == int(created_at.timestamp())
    assert listed["data"][0]["updated_at"] == int(updated_at.timestamp())
    assert listed["data"][0]["active_config_snapshot"]["created_at"] == int(version_created_at.timestamp())
    assert invited["data"][0]["is_in_current_workflow"] is True
    assert invited["data"][0]["existing_node_ids"] == ["node-1"]


def test_invite_options_uses_db_filtered_pagination(monkeypatch):
    configured_agent = Agent(
        id="agent-2",
        tenant_id="tenant-1",
        name="Ready Agent",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="version-2",
        active_config_has_model=True,
    )
    fake_session = FakeSession(scalar=[1], scalars=[[configured_agent]])
    service = AgentRosterService(fake_session)
    monkeypatch.setattr(
        service,
        "_load_versions_by_id",
        lambda version_ids: {
            "version-2": AgentConfigSnapshot(
                id="version-2", agent_id="agent-2", version=1, config_snapshot=_agent_soul_with_model()
            )
        },
    )
    monkeypatch.setattr(service, "_load_published_references_by_agent_id", lambda **kwargs: {})

    result = service.list_invite_options(tenant_id="tenant-1", page=1, limit=1)

    assert result["total"] == 1
    assert result["has_more"] is False
    assert [item["id"] for item in result["data"]] == ["agent-2"]


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
    backing_agent = service.create_backing_agent_for_app(
        tenant_id="tenant-1",
        account_id="account-1",
        app_id="app-1",
        name="Backing Agent",
    )
    found_agent = service._get_agent(tenant_id="tenant-1", agent_id="agent-1")
    with pytest.raises(roster_service.AgentNotFoundError):
        service._get_agent(tenant_id="tenant-1", agent_id="missing")
    found_version = service._get_version(tenant_id="tenant-1", agent_id="agent-1", version_id="version-1")
    with pytest.raises(roster_service.AgentVersionNotFoundError):
        service._get_version(tenant_id="tenant-1", agent_id="agent-1", version_id=None)
    loaded_versions = service._load_versions_by_id(["version-1"])
    assert service._load_versions_by_id([]) == {}

    assert created.name == "Analyst"
    assert created.source == AgentSource.ROSTER
    assert created.active_config_snapshot_id is not None
    assert created.active_config_has_model is False
    assert backing_agent.active_config_snapshot_id is not None
    assert backing_agent.active_config_has_model is False
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

    def test_get_agent_app_model_resolves_app_backing_agent(self):
        agent = Agent(
            id="agent-1",
            tenant_id="tenant-1",
            name="Iris",
            description="",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            app_id="app-1",
        )
        app = SimpleNamespace(id="app-1", mode="agent", status="normal")
        session = FakeSession(scalar=[agent, app])
        service = AgentRosterService(session)

        assert service.get_agent_app_model(tenant_id="tenant-1", agent_id="agent-1") is app

    def test_get_agent_app_model_rejects_unbound_agent(self):
        session = FakeSession()
        service = AgentRosterService(session)

        with pytest.raises(roster_service.AgentNotFoundError):
            service.get_agent_app_model(tenant_id="tenant-1", agent_id="agent-x")


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
    def test_projects_binding_declared_outputs_to_draft_graph_response(self):
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_binding": {
                                    "binding_type": "roster_agent",
                                    "agent_id": "agent-1",
                                },
                            },
                        }
                    ],
                    "edges": [],
                }
            ),
        )
        binding = WorkflowAgentNodeBinding(
            id="binding-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="agent-node",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="agent-1",
            current_snapshot_id="snapshot-1",
            node_job_config=WorkflowNodeJobConfig(
                workflow_prompt="Summarize the upstream result.",
                declared_outputs=[
                    DeclaredOutputConfig(name="summary", type=DeclaredOutputType.STRING, description="Short summary")
                ],
            ),
        )
        session = FakeSession(scalars=[[binding]])

        graph = WorkflowAgentPublishService.project_draft_bindings_to_graph(
            session=session,
            draft_workflow=workflow,
        )

        node_data = graph["nodes"][0]["data"]
        assert node_data["agent_task"] == "Summarize the upstream result."
        assert node_data["agent_declared_outputs"][0]["name"] == "summary"
        assert node_data["agent_declared_outputs"][0]["type"] == "string"
        assert node_data["agent_declared_outputs"][0]["description"] == "Short summary"
        assert "agent_declared_outputs" not in workflow.graph_dict["nodes"][0]["data"]

    def test_creates_roster_binding_from_agent_node_graph(self):
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_task": "Summarize the upstream result.",
                                "agent_declared_outputs": [
                                    {
                                        "name": "summary",
                                        "type": "string",
                                        "description": "Short summary",
                                    }
                                ],
                                "agent_binding": {
                                    "binding_type": "roster_agent",
                                    "agent_id": "agent-1",
                                },
                            },
                        }
                    ]
                }
            ),
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
        assert binding.node_job_config_dict == WorkflowNodeJobConfig(
            workflow_prompt="Summarize the upstream result.",
            declared_outputs=[
                DeclaredOutputConfig(
                    name="summary",
                    type=DeclaredOutputType.STRING,
                    description="Short summary",
                )
            ],
        ).model_dump(mode="json")

    def test_creates_inline_binding_from_agent_node_graph(self):
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_task": "Use the current node context.",
                                "agent_binding": {
                                    "binding_type": "inline_agent",
                                    "agent_id": "inline-agent-1",
                                    "current_snapshot_id": "inline-snapshot-1",
                                },
                            },
                        }
                    ]
                }
            ),
        )
        agent = Agent(
            id="inline-agent-1",
            tenant_id="tenant-1",
            name="Workflow Agent agent-node",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_node_id="agent-node",
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id="inline-snapshot-1",
        )
        snapshot = AgentConfigSnapshot(
            id="inline-snapshot-1",
            tenant_id="tenant-1",
            agent_id="inline-agent-1",
            version=1,
            config_snapshot=AgentSoulConfig(),
        )
        session = FakeSession(scalar=[agent, snapshot], scalars=[[]])

        WorkflowAgentPublishService.sync_agent_bindings_for_draft(
            session=session,
            draft_workflow=workflow,
            account_id="account-1",
        )

        binding = next(item for item in session.added if isinstance(item, WorkflowAgentNodeBinding))
        assert binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT
        assert binding.agent_id == "inline-agent-1"
        assert binding.current_snapshot_id == "inline-snapshot-1"
        assert binding.node_job_config_dict == WorkflowNodeJobConfig(
            workflow_prompt="Use the current node context.",
        ).model_dump(mode="json")

    def test_rejects_inline_binding_for_agent_owned_by_another_node(self):
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_binding": {
                                    "binding_type": "inline_agent",
                                    "agent_id": "inline-agent-1",
                                    "current_snapshot_id": "inline-snapshot-1",
                                },
                            },
                        }
                    ]
                }
            ),
        )
        agent = Agent(
            id="inline-agent-1",
            tenant_id="tenant-1",
            name="Workflow Agent other-node",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_node_id="other-node",
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id="inline-snapshot-1",
        )
        session = FakeSession(scalar=[agent], scalars=[[]])

        with pytest.raises(ValueError, match="inline_agent binding does not belong to this node"):
            WorkflowAgentPublishService.sync_agent_bindings_for_draft(
                session=session,
                draft_workflow=workflow,
                account_id="account-1",
            )

    def test_rejects_agent_node_graph_binding_with_unsupported_type(self):
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_binding": {
                                    "binding_type": "unknown",
                                    "agent_id": "agent-1",
                                },
                            },
                        }
                    ]
                }
            ),
        )

        with pytest.raises(ValueError, match="unsupported agent_binding type"):
            WorkflowAgentPublishService.sync_agent_bindings_for_draft(
                session=FakeSession(scalars=[[]]),
                draft_workflow=workflow,
                account_id="account-1",
            )

    def test_rejects_inline_binding_without_current_snapshot_id(self):
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_binding": {
                                    "binding_type": "inline_agent",
                                    "agent_id": "inline-agent-1",
                                },
                            },
                        }
                    ]
                }
            ),
        )

        with pytest.raises(ValueError, match="inline_agent binding requires current_snapshot_id"):
            WorkflowAgentPublishService.sync_agent_bindings_for_draft(
                session=FakeSession(scalars=[[]]),
                draft_workflow=workflow,
                account_id="account-1",
            )

    def test_rejects_inline_binding_with_missing_snapshot(self):
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_binding": {
                                    "binding_type": "inline_agent",
                                    "agent_id": "inline-agent-1",
                                    "current_snapshot_id": "missing-snapshot",
                                },
                            },
                        }
                    ]
                }
            ),
        )
        agent = Agent(
            id="inline-agent-1",
            tenant_id="tenant-1",
            name="Workflow Agent agent-node",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_node_id="agent-node",
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id="inline-snapshot-1",
        )

        with pytest.raises(ValueError, match="missing inline agent config snapshot"):
            WorkflowAgentPublishService.sync_agent_bindings_for_draft(
                session=FakeSession(scalar=[agent, None], scalars=[[]]),
                draft_workflow=workflow,
                account_id="account-1",
            )

    def test_updates_existing_roster_binding_prompt_from_agent_node_graph(self):
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_task": "Use the latest tender context.",
                                "agent_binding": {
                                    "binding_type": "roster_agent",
                                    "agent_id": "agent-1",
                                },
                            },
                        }
                    ]
                }
            ),
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
        existing_binding = WorkflowAgentNodeBinding(
            id="binding-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="agent-node",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="agent-1",
            current_snapshot_id="snapshot-1",
            node_job_config=WorkflowNodeJobConfig(
                workflow_prompt="Old prompt",
                declared_outputs=[
                    DeclaredOutputConfig(name="summary", type=DeclaredOutputType.STRING, description="Short summary")
                ],
            ),
        )
        session = FakeSession(scalar=[agent], scalars=[[existing_binding]])

        WorkflowAgentPublishService.sync_roster_agent_bindings_for_draft(
            session=session,
            draft_workflow=workflow,
            account_id="account-1",
        )

        node_job = WorkflowNodeJobConfig.model_validate(existing_binding.node_job_config_dict)
        assert node_job.workflow_prompt == "Use the latest tender context."
        assert [output.name for output in node_job.declared_outputs] == ["summary"]
        assert existing_binding.current_snapshot_id == "snapshot-2"

    def test_updates_existing_roster_binding_declared_outputs_from_agent_node_graph(self):
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_task": "Keep the prompt.",
                                "agent_declared_outputs": [],
                                "agent_binding": {
                                    "binding_type": "roster_agent",
                                    "agent_id": "agent-1",
                                },
                            },
                        }
                    ]
                }
            ),
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
        existing_binding = WorkflowAgentNodeBinding(
            id="binding-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="agent-node",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="agent-1",
            current_snapshot_id="snapshot-1",
            node_job_config=WorkflowNodeJobConfig(
                workflow_prompt="Old prompt",
                declared_outputs=[
                    DeclaredOutputConfig(
                        name="summary",
                        type=DeclaredOutputType.STRING,
                        description="Short summary",
                    )
                ],
            ),
        )
        session = FakeSession(scalar=[agent], scalars=[[existing_binding]])

        WorkflowAgentPublishService.sync_roster_agent_bindings_for_draft(
            session=session,
            draft_workflow=workflow,
            account_id="account-1",
        )

        node_job = WorkflowNodeJobConfig.model_validate(existing_binding.node_job_config_dict)
        assert node_job.workflow_prompt == "Keep the prompt."
        assert node_job.declared_outputs == []
        assert existing_binding.current_snapshot_id == "snapshot-2"

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


# ── ENG-623 §4.4: drive-backed ref validation ────────────────────────────────


def _drive_soul(**overrides):
    from services.entities.agent_entities import AgentSoulConfig

    base = {
        "skills_files": {
            "skills": [
                {"id": "sk-1", "name": "Tender Analyzer", "skill_md_key": "tender-analyzer/SKILL.md"},
            ],
            "files": [{"name": "sample.pdf", "drive_key": "files/sample.pdf"}],
        },
    }
    base.update(overrides)
    return AgentSoulConfig.model_validate(base)


def _patch_drive_keys(monkeypatch, existing_keys):
    import services.agent.composer_service as composer_service_module

    captured: dict[str, object] = {}

    def fake_scalars(stmt):
        captured["stmt"] = stmt
        return list(existing_keys)

    monkeypatch.setattr(composer_service_module.db, "session", type("S", (), {"scalars": staticmethod(fake_scalars)})())
    return captured


def test_drive_ref_findings_reports_missing_keys(monkeypatch):
    _patch_drive_keys(monkeypatch, existing_keys=["tender-analyzer/SKILL.md"])

    findings = AgentComposerService._drive_ref_findings(
        tenant_id="tenant-1", agent_id="agent-1", agent_soul=_drive_soul()
    )

    assert [(f["code"], f["id"]) for f in findings] == [("file_ref_dangling", "files/sample.pdf")]
    assert str(findings[0]["message"]).startswith("file_ref_dangling: ")


def test_drive_ref_findings_clean_when_all_keys_exist(monkeypatch):
    _patch_drive_keys(monkeypatch, existing_keys=["tender-analyzer/SKILL.md", "files/sample.pdf"])

    assert (
        AgentComposerService._drive_ref_findings(tenant_id="tenant-1", agent_id="agent-1", agent_soul=_drive_soul())
        == []
    )


def test_drive_ref_findings_skips_refs_without_drive_keys(monkeypatch):
    # No drive-backed ref at all -> no DB roundtrip, no findings.
    soul = _drive_soul(
        skills_files={"skills": [{"id": "legacy", "name": "Legacy"}], "files": [{"name": "u.pdf", "file_id": "u-1"}]}
    )
    findings = AgentComposerService._drive_ref_findings(tenant_id="tenant-1", agent_id="agent-1", agent_soul=soul)
    assert findings == []


def test_require_drive_refs_resolved_raises_with_stable_code(monkeypatch):
    from services.agent.errors import InvalidComposerConfigError

    _patch_drive_keys(monkeypatch, existing_keys=[])

    with pytest.raises(InvalidComposerConfigError, match="skill_ref_dangling"):
        AgentComposerService._require_drive_refs_resolved(
            tenant_id="tenant-1", agent_id="agent-1", agent_soul=_drive_soul()
        )


def test_collect_validation_findings_appends_drive_findings_with_agent_context(monkeypatch):
    from services.entities.agent_entities import ComposerSavePayload

    _patch_drive_keys(monkeypatch, existing_keys=[])
    payload = ComposerSavePayload.model_validate(
        {
            "variant": "agent_app",
            "save_strategy": "save_to_current_version",
            "agent_soul": _drive_soul().model_dump(mode="json"),
        }
    )

    findings = AgentComposerService.collect_validation_findings(
        tenant_id="tenant-1", payload=payload, agent_id="agent-1"
    )

    codes = {w["code"] for w in findings["warnings"]}
    assert {"skill_ref_dangling", "file_ref_dangling"} <= codes
    # without agent context the drive check is skipped entirely
    findings_no_agent = AgentComposerService.collect_validation_findings(tenant_id="tenant-1", payload=payload)
    assert all(w["code"] not in {"skill_ref_dangling", "file_ref_dangling"} for w in findings_no_agent["warnings"])


# ── ENG-625 D5: soul-first ref removal ───────────────────────────────────────


def _patch_remove_drive_refs_env(monkeypatch, *, soul_dict):
    """Wire the classmethod's collaborators so soul editing + versioning is observable."""
    from types import SimpleNamespace

    import services.agent.composer_service as module

    agent = SimpleNamespace(id="agent-1", active_config_snapshot_id="snap-1", updated_by=None)
    snapshot = SimpleNamespace(id="snap-1", tenant_id="tenant-1", agent_id="agent-1", config_snapshot_dict=soul_dict)
    committed: dict[str, object] = {}

    fake_session = SimpleNamespace(scalar=lambda stmt: agent, commit=lambda: committed.setdefault("committed", True))
    monkeypatch.setattr(module.db, "session", fake_session)
    monkeypatch.setattr(AgentComposerService, "_require_version", classmethod(lambda cls, **kwargs: snapshot))

    captured: dict[str, object] = {}

    def fake_update(cls, *, current_snapshot, account_id, agent_soul, operation, version_note):
        captured["agent_soul"] = agent_soul
        captured["version_note"] = version_note
        return SimpleNamespace(id="snap-2")

    monkeypatch.setattr(AgentComposerService, "_update_current_version", classmethod(fake_update))
    return agent, captured, committed


def test_remove_drive_refs_drops_skill_by_slug_and_versions(monkeypatch):
    soul_dict = {
        "skills_files": {
            "skills": [
                {"id": "sk-1", "name": "Tender Analyzer", "skill_md_key": "tender-analyzer/SKILL.md"},
                {"id": "sk-2", "name": "Other", "skill_md_key": "other-skill/SKILL.md"},
            ],
            "files": [],
        }
    }
    agent, captured, committed = _patch_remove_drive_refs_env(monkeypatch, soul_dict=soul_dict)

    version_id = AgentComposerService.remove_drive_refs(
        tenant_id="tenant-1", agent_id="agent-1", account_id="acc-1", skill_slug="tender-analyzer"
    )

    assert version_id == "snap-2"
    assert agent.active_config_snapshot_id == "snap-2"
    kept = [s.skill_md_key for s in captured["agent_soul"].skills_files.skills]
    assert kept == ["other-skill/SKILL.md"]
    assert "Tender Analyzer" in str(captured["version_note"])
    assert committed.get("committed") is True


def test_remove_drive_refs_is_noop_when_ref_absent(monkeypatch):
    soul_dict = {"skills_files": {"skills": [], "files": []}}
    agent, captured, committed = _patch_remove_drive_refs_env(monkeypatch, soul_dict=soul_dict)

    assert (
        AgentComposerService.remove_drive_refs(
            tenant_id="tenant-1", agent_id="agent-1", account_id="acc-1", file_key="files/none.pdf"
        )
        is None
    )
    assert "agent_soul" not in captured
    assert committed == {}


def test_remove_drive_refs_drops_file_by_key(monkeypatch):
    soul_dict = {
        "skills_files": {
            "skills": [],
            "files": [
                {"name": "keep.pdf", "drive_key": "files/keep.pdf"},
                {"name": "drop.pdf", "drive_key": "files/drop.pdf"},
            ],
        }
    }
    _, captured, _ = _patch_remove_drive_refs_env(monkeypatch, soul_dict=soul_dict)

    version_id = AgentComposerService.remove_drive_refs(
        tenant_id="tenant-1", agent_id="agent-1", account_id="acc-1", file_key="files/drop.pdf"
    )

    assert version_id == "snap-2"
    assert [f.drive_key for f in captured["agent_soul"].skills_files.files] == ["files/keep.pdf"]


def test_add_drive_file_ref_adds_or_replaces_file_and_versions(monkeypatch):
    soul_dict = {
        "skills_files": {
            "skills": [],
            "files": [
                {"name": "old.pdf", "drive_key": "files/old.pdf"},
                {"name": "stale.pdf", "drive_key": "files/new.pdf"},
            ],
        }
    }
    agent, captured, committed = _patch_remove_drive_refs_env(monkeypatch, soul_dict=soul_dict)

    version_id = AgentComposerService.add_drive_file_ref(
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="acc-1",
        file_ref=AgentFileRefConfig(name="new.pdf", file_id="uf-1", drive_key="files/new.pdf", type="application/pdf"),
    )

    assert version_id == "snap-2"
    assert agent.active_config_snapshot_id == "snap-2"
    assert [f.drive_key for f in captured["agent_soul"].skills_files.files] == ["files/old.pdf", "files/new.pdf"]
    assert captured["agent_soul"].skills_files.files[-1].name == "new.pdf"
    assert "new.pdf" in str(captured["version_note"])
    assert committed.get("committed") is True


def test_add_drive_file_ref_syncs_workflow_binding_snapshot(monkeypatch):
    binding = SimpleNamespace(agent_id="agent-1", current_snapshot_id="snap-1", updated_by=None)
    _patch_remove_drive_refs_env(monkeypatch, soul_dict={"skills_files": {"skills": [], "files": []}})
    monkeypatch.setattr(
        AgentComposerService, "_get_draft_workflow", classmethod(lambda cls, **kwargs: SimpleNamespace(id="wf-1"))
    )
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", classmethod(lambda cls, **kwargs: binding))

    AgentComposerService.add_drive_file_ref(
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="acc-1",
        file_ref=AgentFileRefConfig(name="new.pdf", file_id="uf-1", drive_key="files/new.pdf"),
        app_id="app-1",
        node_id="agent-node-1",
    )

    assert binding.current_snapshot_id == "snap-2"
    assert binding.updated_by == "acc-1"


def test_remove_drive_refs_requires_exactly_one_scope():
    with pytest.raises(ValueError):
        AgentComposerService.remove_drive_refs(tenant_id="t", agent_id="a", account_id="u")


# ── ENG-623/625: resolver helpers + save-path drive guard ────────────────────


def test_resolve_bound_agent_id_queries_active_roster_agent(monkeypatch):
    from types import SimpleNamespace

    import services.agent.composer_service as module

    monkeypatch.setattr(module.db, "session", SimpleNamespace(scalar=lambda stmt: "agent-9"))
    assert AgentComposerService.resolve_bound_agent_id(tenant_id="t-1", app_id="app-1") == "agent-9"


def test_resolve_workflow_node_agent_id_degrades_without_workflow_or_binding(monkeypatch):
    from types import SimpleNamespace

    def boom(cls, **kwargs):
        raise ValueError("no draft workflow")

    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", classmethod(boom))
    assert AgentComposerService.resolve_workflow_node_agent_id(tenant_id="t", app_id="a", node_id="n") is None

    monkeypatch.setattr(
        AgentComposerService, "_get_draft_workflow", classmethod(lambda cls, **kwargs: SimpleNamespace(id="wf-1"))
    )
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", classmethod(lambda cls, **kwargs: None))
    assert AgentComposerService.resolve_workflow_node_agent_id(tenant_id="t", app_id="a", node_id="n") is None

    monkeypatch.setattr(
        AgentComposerService,
        "_get_workflow_binding",
        classmethod(lambda cls, **kwargs: SimpleNamespace(agent_id="agent-7")),
    )
    assert AgentComposerService.resolve_workflow_node_agent_id(tenant_id="t", app_id="a", node_id="n") == "agent-7"


def test_remove_drive_refs_returns_none_without_agent_or_snapshot(monkeypatch):
    from types import SimpleNamespace

    import services.agent.composer_service as module

    monkeypatch.setattr(module.db, "session", SimpleNamespace(scalar=lambda stmt: None))
    assert AgentComposerService.remove_drive_refs(tenant_id="t", agent_id="a", account_id="u", skill_slug="s") is None

    agent_without_snapshot = SimpleNamespace(id="a", active_config_snapshot_id=None)
    monkeypatch.setattr(module.db, "session", SimpleNamespace(scalar=lambda stmt: agent_without_snapshot))
    assert AgentComposerService.remove_drive_refs(tenant_id="t", agent_id="a", account_id="u", skill_slug="s") is None


def test_save_workflow_composer_guards_drive_refs_for_existing_agent_strategies(monkeypatch):
    from types import SimpleNamespace

    from services.entities.agent_entities import ComposerSavePayload

    payload = ComposerSavePayload.model_validate(
        {
            "variant": "workflow",
            "save_strategy": "save_to_current_version",
            "agent_soul": _drive_soul().model_dump(mode="json"),
            "soul_lock": {"locked": False},
        }
    )
    monkeypatch.setattr(
        AgentComposerService, "_get_draft_workflow", classmethod(lambda cls, **kwargs: SimpleNamespace(id="wf-1"))
    )
    monkeypatch.setattr(
        AgentComposerService,
        "_get_workflow_binding",
        classmethod(lambda cls, **kwargs: SimpleNamespace(agent_id="agent-1")),
    )
    guarded: dict[str, str] = {}

    def fake_guard(cls, *, tenant_id, agent_id, agent_soul):
        guarded["agent_id"] = agent_id
        raise InvalidComposerConfigError("skill_ref_dangling: boom")

    from services.agent.errors import InvalidComposerConfigError

    monkeypatch.setattr(AgentComposerService, "_require_drive_refs_resolved", classmethod(fake_guard))

    with pytest.raises(InvalidComposerConfigError, match="skill_ref_dangling"):
        AgentComposerService.save_workflow_composer(
            tenant_id="t-1", app_id="app-1", node_id="n-1", account_id="acc-1", payload=payload
        )
    assert guarded["agent_id"] == "agent-1"


def test_remove_drive_refs_noop_when_skill_slug_unmatched(monkeypatch):
    soul_dict = {"skills_files": {"skills": [{"name": "Other", "skill_md_key": "other/SKILL.md"}], "files": []}}
    _, captured, committed = _patch_remove_drive_refs_env(monkeypatch, soul_dict=soul_dict)
    assert (
        AgentComposerService.remove_drive_refs(
            tenant_id="t-1", agent_id="agent-1", account_id="acc-1", skill_slug="ghost"
        )
        is None
    )
    assert committed == {}
