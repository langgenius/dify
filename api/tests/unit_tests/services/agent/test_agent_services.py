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
from services.agent import composer_service, roster_service
from services.agent.composer_service import AgentComposerService
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.errors import InvalidComposerConfigError
from services.agent.roster_service import AgentRosterService
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


def test_load_workflow_composer_serializes_existing_binding(monkeypatch):
    binding = SimpleNamespace(agent_id="agent-1", current_snapshot_id="version-1")
    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **kwargs: binding)
    monkeypatch.setattr(AgentComposerService, "_get_agent_if_present", lambda **kwargs: SimpleNamespace(id="agent-1"))
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
    binding = SimpleNamespace(agent_id="agent-1", current_snapshot_id="version-1")
    calls = []

    monkeypatch.setattr(composer_service.db, "session", fake_session)
    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_save_payload", lambda payload: None)
    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **kwargs: None)
    monkeypatch.setattr(AgentComposerService, "_get_agent_if_present", lambda **kwargs: SimpleNamespace(id="agent-1"))
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

    workflow_candidates = AgentComposerService.get_workflow_candidates(app_id="app-1")
    agent_app_candidates = AgentComposerService.get_agent_app_candidates(app_id="app-1")
    impact = AgentComposerService.calculate_impact(tenant_id="tenant-1", current_snapshot_id="version-1")

    assert workflow_candidates["variant"] == "workflow"
    assert agent_app_candidates["variant"] == "agent_app"
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
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Analyst",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    version = AgentConfigSnapshot(id="version-1", agent_id="agent-1", version=1)
    agent.active_config_snapshot_id = "version-1"
    fake_session = FakeSession(
        scalar=[1, 1, SimpleNamespace(id="workflow-1")],
        scalars=[[agent], [agent], [SimpleNamespace(agent_id="agent-1", node_id="node-1")]],
    )
    service = AgentRosterService(fake_session)
    monkeypatch.setattr(service, "_load_versions_by_id", lambda version_ids: {"version-1": version})

    listed = service.list_roster_agents(tenant_id="tenant-1", page=1, limit=20)
    invited = service.list_invite_options(tenant_id="tenant-1", page=1, limit=20, app_id="app-1")

    assert listed["data"][0]["active_config_snapshot"]["id"] == "version-1"
    assert invited["data"][0]["is_in_current_workflow"] is True
    assert invited["data"][0]["existing_node_ids"] == ["node-1"]


def test_roster_update_archive_versions_and_detail(monkeypatch):
    listed_version = AgentConfigSnapshot(id="version-2", agent_id="agent-1", version=2)
    fake_session = FakeSession(scalars=[[listed_version]])
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
    assert detail["config_snapshot"] == {"prompt": {}}


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
