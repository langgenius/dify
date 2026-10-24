"""Published metadata must not expose editable Soul/configuration internals."""

from dataclasses import asdict
from uuid import uuid4

import pytest
import sqlalchemy.orm

from models.agent import Agent, AgentConfigSnapshot
from models.agent_config_entities import AgentSoulConfig
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.services.dify_builder.test_dify_port import PortDatabase


def test_projection_is_published_and_output_contract_is_honest() -> None:
    from services.dify_builder.native_testing.agent_catalog import project_published_agent

    agent = Agent(id=str(uuid4()), tenant_id=str(uuid4()), name="Risk reviewer", description="EDITABLE DRAFT SECRET")
    snapshot = AgentConfigSnapshot(
        id=str(uuid4()),
        agent_id=agent.id,
        tenant_id=agent.tenant_id,
        version=3,
        summary="Review risk evidence",
        config_snapshot=AgentSoulConfig.model_validate(
            {
                "app_variables": [{"name": "report", "type": "string", "required": True, "default": "PRIVATE DEFAULT"}],
                "prompt": {"system": "PRIVATE SYSTEM"},
                "env": {"variables": [{"name": "PRIVATE_ENV", "value": "PRIVATE VALUE"}]},
            }
        ),
    )
    candidate = project_published_agent(agent=agent, snapshot=snapshot)
    assert candidate.snapshot_id == snapshot.id
    # A pure snapshot projection has no native visible-history evidence.
    assert candidate.display_version is None
    assert candidate.snapshot_version == 3
    assert candidate.description == "Review risk evidence"
    assert candidate.input_schema == {"report": {"type": "string", "required": True}}
    assert candidate.output_schema is None
    assert candidate.output_contract_source == "node_job_required"
    assert candidate.input_contract_source == "published_soul.app_variables"
    assert "PRIVATE" not in repr(asdict(candidate))
    assert "EDITABLE" not in repr(asdict(candidate))


def test_projection_rejects_cross_owner_snapshot() -> None:
    from services.dify_builder.native_testing.agent_catalog import project_published_agent

    agent = Agent(id=str(uuid4()), tenant_id=str(uuid4()), name="Reviewer")
    snapshot = AgentConfigSnapshot(
        id=str(uuid4()), tenant_id=str(uuid4()), agent_id=agent.id, version=1, config_snapshot=AgentSoulConfig()
    )
    with pytest.raises(ValueError, match="owner"):
        project_published_agent(agent=agent, snapshot=snapshot)


@pytest.mark.parametrize("summary", [None, "", "Published risk review"])
def test_public_roster_description_is_an_honest_capability_fallback(summary: None | str) -> None:
    from services.dify_builder.native_testing.agent_catalog import project_published_agent

    agent = Agent(id=str(uuid4()), tenant_id=str(uuid4()), name="Reviewer", description="Public report review")
    snapshot = AgentConfigSnapshot(
        id=str(uuid4()),
        tenant_id=agent.tenant_id,
        agent_id=agent.id,
        version=1,
        summary=summary,
        config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "PRIVATE PROMPT"}}),
    )

    candidate = project_published_agent(agent=agent, snapshot=snapshot)

    assert candidate.description == (summary or "Public report review")
    assert candidate.capability == (summary or "Public report review")
    assert candidate.capability_source == ("published_snapshot.summary" if summary else "public_roster.description")
    assert "PRIVATE" not in repr(asdict(candidate))


@pytest.mark.parametrize("phase", ["discovery", "discovery_alias", "generation"])
def test_agent_contract_reaches_planning_without_private_soul_values(
    sqlite_session: sqlalchemy.orm.Session, monkeypatch: pytest.MonkeyPatch, phase: str
) -> None:
    """An eligible real SQL projection must survive both planning consumers intact."""
    import json

    from core.app.app_config.entities import ModelConfig
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.agent import build, resources
    from services.dify_builder.native_testing.agent_binding import native_node_data
    from services.dify_builder.native_testing.agent_catalog import project_published_agent
    from tests.builder_agent_fixtures import make_case

    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    case = make_case(sqlite_session)
    case.agent.description = "Public review capability " * 40
    case.snapshot.summary = None
    soul = case.snapshot.config_snapshot_dict
    soul["app_variables"][0]["default"] = "PRIVATE DEFAULT"
    soul["prompt"] = {"system_prompt": "PRIVATE SYSTEM"}
    case.snapshot.config_snapshot = AgentSoulConfig.model_validate(soul)
    sqlite_session.commit()
    candidate = project_published_agent(agent=case.agent, snapshot=case.snapshot)
    monkeypatch.setattr(resources, "db", PortDatabase(sqlite_session.get_bind()))
    monkeypatch.setattr(resources, "_list_models", lambda _tenant_id: [])
    monkeypatch.setattr(resources, "_list_datasets", lambda _tenant_id: [])
    monkeypatch.setattr(resources, "_list_tools", lambda _tenant_id: [])
    payloads = []
    if phase.startswith("discovery"):
        selected_id = f"agent:{case.agent.id}" if phase == "discovery_alias" else candidate.resource_id

        def recommend(_model: object, **kwargs: object) -> dict[str, object]:
            payloads.append(kwargs["user"])
            return {
                "resource_ids": [selected_id],
                "selection_reasons": {selected_id: "Its public review capability matches report review."},
            }

        monkeypatch.setattr(build.llm, "invoke_json", recommend)
        options = build.discover_resources(
            object(), case.actor.tenant_id, ["Review the report"], account_id=case.actor.account_id
        )
        assert len(options) == 1
        assert options[0].id == candidate.resource_id
        assert "public roster description" in options[0].meta
        assert f"Published version {case.snapshot.version}" in options[0].meta
        assert "Reference eligible for this member" in options[0].meta
        assert "actor-scoped published catalog" in options[0].meta
        assert "runtime authorization unverified" in options[0].meta
        assert "requires setup" in options[0].meta
        assert "Its public review capability matches report review." in options[0].meta
    else:
        mc = ModelConfig.model_validate({"provider": "provider", "name": "model", "mode": "chat"})
        monkeypatch.setattr(build, "_generator_model_config", lambda *_args: mc)
        agent_data = native_node_data(
            agent_id=case.agent.id,
            snapshot_id=case.snapshot.id,
            node_job=WorkflowNodeJobConfig(
                workflow_prompt="Review {{#start.report#}}", declared_outputs=[{"name": "summary", "type": "string"}]
            ),
        )

        def generate(**kwargs: object) -> dict[str, object]:
            payloads.append(kwargs["instruction"])
            return {
                "graph": {
                    "nodes": [
                        {
                            "id": "start",
                            "data": {
                                "type": "start",
                                "title": "Start",
                                "variables": [
                                    {"variable": "report", "label": "Report", "type": "paragraph", "required": True}
                                ],
                            },
                        },
                        {"id": "review", "data": agent_data},
                        {
                            "id": "end",
                            "data": {
                                "type": "end",
                                "title": "End",
                                "outputs": [
                                    {
                                        "variable": "summary",
                                        "value_type": "string",
                                        "value_selector": ["review", "summary"],
                                    }
                                ],
                            },
                        },
                    ],
                    "edges": [
                        {"id": "first", "source": "start", "target": "review"},
                        {"id": "last", "source": "review", "target": "end"},
                    ],
                }
            }

        monkeypatch.setattr(build.WorkflowGeneratorService, "generate_workflow_graph", generate)
        result = build.build_nodes(
            case.actor.tenant_id,
            {},
            ["Review the report"],
            resource_ids=[candidate.resource_id],
            account_id=case.actor.account_id,
        )
        assert result.intents, result.diagnostics
        assert any(intent.args.get("node_type") == "agent" for intent in result.intents)

    assert len(payloads) == 1
    prompt = payloads[0]
    assert isinstance(prompt, str)
    for public_value in (
        json.dumps({"report": {"type": "string", "required": True}}, sort_keys=True),
        "published_soul.app_variables",
        "node_job_required",
        "public_roster.description",
        "model:model-plugin/provider/test-model",
        "tool:plugin/provider/read",
        '"reference_permitted": true',
        '"reference_permission_source": "actor_scoped_published_catalog"',
        f'"display_version": {case.snapshot.version}',
        # Capability evidence beyond the display prose cap remains available.
        '"capability": "' + case.agent.description,
    ):
        assert public_value in prompt
    assert "PRIVATE" not in prompt
    assert "HIDDEN" not in prompt


def test_catalog_source_failure_is_not_an_empty_catalog(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: sqlalchemy.orm.Session
) -> None:
    from services.agent import access_service
    from services.dify_builder.native_testing.agent_catalog import AgentCatalogService

    monkeypatch.setattr(access_service, "require_builder_agent_access", lambda **_kwargs: None)
    monkeypatch.setattr(
        access_service,
        "resolve_current_agent_access_filter",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("unavailable")),
    )
    with pytest.raises(RuntimeError, match="unavailable"):
        AgentCatalogService(sqlite_session).list_candidates(
            tenant_id=str(uuid4()), actor_id=str(uuid4()), app_id=str(uuid4()), query=None
        )


def test_selected_agent_uses_existing_resource_option_and_fresh_binding(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent import build, resources
    from services.dify_builder.native_testing.agent_catalog import project_published_agent

    agent = Agent(id=str(uuid4()), tenant_id=str(uuid4()), name="Risk reviewer")
    snapshot = AgentConfigSnapshot(
        id=str(uuid4()),
        tenant_id=agent.tenant_id,
        agent_id=agent.id,
        version=1,
        summary="Risk review",
        config_snapshot=AgentSoulConfig(),
    )
    item = project_published_agent(agent=agent, snapshot=snapshot)
    ref = resources.ResourceRef(id=item.resource_id, label=item.name)
    inv = resources.TenantResources(models=[], datasets=[], tools=[], agents=[ref])
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_args, **_kwargs: inv)
    monkeypatch.setattr(
        build.llm,
        "invoke_json",
        lambda *_args, **_kwargs: {
            "resource_ids": [item.resource_id],
            "selection_reasons": {
                item.resource_id: "Its published risk review capability matches the risk review step."
            },
        },
    )
    options = build.discover_resources(object(), agent.tenant_id, ["Review risk"])
    assert len(options) == 1
    assert options[0].kind == "agent"
    assert options[0].id == item.resource_id
    assert item.resource_id in build.bind_resources(None, agent.tenant_id, ["Review risk"], [item.resource_id])[0]


@pytest.mark.parametrize("reason", [None, "", "  ", 7, [], {"reason": "review"}, "x" * 361])
def test_agent_recommendation_preserves_selection_with_an_unavailable_reason_note(
    monkeypatch: pytest.MonkeyPatch, reason: object
) -> None:
    from services.dify_builder.agent import build, resources

    inv = resources.TenantResources(
        models=[resources.ResourceRef(id="provider/model", label="Model", meta="Configured model")],
        datasets=[],
        tools=[],
        agents=[
            resources.ResourceRef(
                id="agent:reviewer:snapshot:digest",
                label="Reviewer",
                meta="Published version 3; reference eligible for this member; capability: report risk review.",
                readiness="missing_config",
            )
        ],
    )
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_args, **_kwargs: inv)
    monkeypatch.setattr(
        build.llm,
        "invoke_json",
        lambda *_args, **_kwargs: {
            "resource_ids": ["agent:reviewer:snapshot:digest", "provider/model", "agent:unknown"],
            "selection_reasons": {
                "agent:reviewer:snapshot:digest": reason,
                "agent:unknown": "Invented candidate",
                "provider/model": "Must not change existing model metadata",
            },
        },
    )

    options = build.discover_resources(object(), "tenant", ["Review the report"])

    assert [option.id for option in options] == ["agent:reviewer:snapshot:digest", "provider/model"]
    assert options[0].meta == (
        "Published version 3; reference eligible for this member; capability: report risk review. "
        "Selection rationale unavailable; review the declared capability against your goal before confirming."
    )
    assert options[0].readiness == "missing_config"
    assert options[1].meta == "Configured model"


@pytest.mark.parametrize("reason_map", [None, [], {}, "malformed"])
def test_agent_only_legacy_or_malformed_reason_response_is_not_a_false_no_match(
    monkeypatch: pytest.MonkeyPatch, reason_map: object
) -> None:
    from services.dify_builder.agent import build, resources
    from services.dify_builder.trace_diagnostics import scope

    inv = resources.TenantResources(
        models=[],
        datasets=[],
        tools=[],
        agents=[resources.ResourceRef(id="agent:chosen", label="Chosen", meta="Published version 3")],
    )
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_args, **_kwargs: inv)
    calls: list[dict[str, object]] = []

    def recommend(_model: object, **kwargs: object) -> dict[str, object]:
        calls.append(kwargs)
        result: dict[str, object] = {"resource_ids": ["agent:chosen", "agent:unknown"]}
        if reason_map is not None:
            result["selection_reasons"] = reason_map
        return result

    monkeypatch.setattr(build.llm, "invoke_json", recommend)

    diagnostics: list[dict[str, object]] = []
    with scope(diagnostics.append, "discover-resources"):
        options = build.discover_resources(object(), "tenant", ["Review a contract"])

    assert [option.id for option in options] == ["agent:chosen"]
    assert options[0].meta == (
        "Published version 3 Selection rationale unavailable; "
        "review the declared capability against your goal before confirming."
    )
    assert len(calls) == 1
    assert [(item["code"], item["fallback_used"]) for item in diagnostics] == [("response_schema_invalid", True)]


def test_agent_reason_cannot_select_an_unchosen_candidate(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent import build, resources

    inv = resources.TenantResources(
        models=[],
        datasets=[],
        tools=[],
        agents=[
            resources.ResourceRef(id="agent:chosen", label="Chosen", meta="Published version 3"),
            resources.ResourceRef(id="agent:unchosen", label="Unchosen"),
        ],
    )
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_args, **_kwargs: inv)
    calls: list[dict[str, object]] = []

    def recommend(_model: object, **kwargs: object) -> dict[str, object]:
        calls.append(kwargs)
        return {
            "resource_ids": ["agent:chosen", "agent:chosen", "agent:unknown", {"id": "agent:unchosen"}],
            "selection_reasons": {
                "agent:chosen": "  Its declared contract risk review matches the requested contract analysis.  ",
                "agent:unchosen": "This reason must not select a candidate",
                "agent:unknown": "This reason must not invent a candidate",
            },
        }

    monkeypatch.setattr(build.llm, "invoke_json", recommend)

    options = build.discover_resources(object(), "tenant", ["Analyze contract risks"], goal_text="Review a contract")

    assert [option.id for option in options] == ["agent:chosen"]
    assert options[0].meta == (
        "Published version 3 Selection rationale (model): "
        "Its declared contract risk review matches the requested contract analysis."
    )
    assert len(calls) == 1
    assert "Review a contract" in str(calls[0]["user"])


# The short identity was observed in Dev reasoning; the snapshot/digest below
# are a controlled canonical catalog fixture, not a historical final JSON trace.
_DISCOVERY_AGENT_ALIAS = "agent:01a14c90-9556-7625-bba7-aa36ac56b8a8"
_DISCOVERY_AGENT_ID = _DISCOVERY_AGENT_ALIAS + ":01234567-89ab-cdef-0123-456789abcdef:" + "a" * 64


@pytest.mark.parametrize("full_id_position", ["absent", "first", "last"])
def test_agent_discovery_returns_current_canonical_identity_and_selected_reason(
    monkeypatch: pytest.MonkeyPatch, full_id_position: str
) -> None:
    from services.dify_builder.agent import build, resources

    ref = resources.ResourceRef(
        id=_DISCOVERY_AGENT_ID,
        label="Contract reviewer",
        meta="Published version 3; actor-scoped reference eligible; runtime authorization unverified.",
        readiness="missing_config",
    )
    inv = resources.TenantResources(models=[], datasets=[], tools=[], agents=[ref])
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_args, **_kwargs: inv)
    selected = [_DISCOVERY_AGENT_ALIAS, _DISCOVERY_AGENT_ALIAS]
    if full_id_position == "first":
        selected.insert(0, _DISCOVERY_AGENT_ID)
    elif full_id_position == "last":
        selected += [_DISCOVERY_AGENT_ID, _DISCOVERY_AGENT_ALIAS]
    calls: list[dict[str, object]] = []

    def recommend(_model: object, **kwargs: object) -> dict[str, object]:
        calls.append(kwargs)
        return {
            "resource_ids": selected,
            "selection_reasons": {
                _DISCOVERY_AGENT_ALIAS: "  Its declared contract risk review fits the contract analysis.  ",
                _DISCOVERY_AGENT_ID: "Its canonical selection fits the requested risk review.",
            },
        }

    monkeypatch.setattr(build.llm, "invoke_json", recommend)

    options = build.discover_resources(object(), "tenant", ["Review contract risk"], account_id="actor")

    assert len(options) == 1
    assert options[0].id == _DISCOVERY_AGENT_ID
    assert options[0].kind == "agent"
    assert options[0].label == ref.label
    assert options[0].readiness == "missing_config"
    reason = (
        "Its canonical selection fits the requested risk review."
        if full_id_position != "absent"
        else "Its declared contract risk review fits the contract analysis."
    )
    assert options[0].meta == ref.meta + " Selection rationale (model): " + reason
    assert len(calls) == 1


@pytest.mark.parametrize(
    "selected",
    [
        "agent:01a14c90-9556-7625-bba7-aa36ac56b8a9",  # Unknown UUID.
        "agent:Contract reviewer",  # Names are not identities.
        "agent:01a14c9095567625bba7aa36ac56b8a8",  # No normalized UUID fallback.
        " " + _DISCOVERY_AGENT_ALIAS,
        _DISCOVERY_AGENT_ALIAS + ":",
        _DISCOVERY_AGENT_ALIAS + ":stale-snapshot:" + "a" * 64,
        _DISCOVERY_AGENT_ALIAS + ":01234567-89ab-cdef-0123-456789abcdef:" + "b" * 64,
        _DISCOVERY_AGENT_ID + ":extra",
    ],
)
def test_agent_discovery_never_repairs_unknown_malformed_or_stale_full_ids(
    monkeypatch: pytest.MonkeyPatch, selected: str
) -> None:
    from services.dify_builder.agent import build, resources

    inv = resources.TenantResources(
        models=[], datasets=[], tools=[], agents=[resources.ResourceRef(id=_DISCOVERY_AGENT_ID, label="Reviewer")]
    )
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_args, **_kwargs: inv)
    monkeypatch.setattr(
        build.llm,
        "invoke_json",
        lambda *_args, **_kwargs: {"resource_ids": [selected], "selection_reasons": {selected: "Review risk"}},
    )

    assert build.discover_resources(object(), "tenant", ["Review contract risk"], account_id="actor") == []


def test_agent_discovery_refuses_ambiguous_short_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent import build, resources

    inv = resources.TenantResources(
        models=[],
        datasets=[],
        tools=[],
        agents=[
            resources.ResourceRef(id=_DISCOVERY_AGENT_ID, label="First"),
            resources.ResourceRef(
                id=_DISCOVERY_AGENT_ALIAS + ":11234567-89ab-cdef-0123-456789abcdef:" + "b" * 64, label="Second"
            ),
        ],
    )
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_args, **_kwargs: inv)
    monkeypatch.setattr(
        build.llm,
        "invoke_json",
        lambda *_args, **_kwargs: {"resource_ids": [_DISCOVERY_AGENT_ALIAS]},
    )

    assert build.discover_resources(object(), "tenant", ["Review contract risk"], account_id="actor") == []


def test_changed_agent_selection_cannot_silently_rebind(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent import build, resources
    from services.dify_builder.native_testing.agent_binding import AgentSnapshotChanged

    ref = resources.ResourceRef(id="agent:agent-1:snapshot-4:" + "a" * 64, label="Reviewer")
    monkeypatch.setattr(
        resources,
        "list_tenant_resources",
        lambda *_args, **_kwargs: resources.TenantResources(models=[], datasets=[], tools=[], agents=[ref]),
    )
    with pytest.raises(AgentSnapshotChanged):
        build.bind_resources(None, "tenant-1", ["Review"], ["agent:agent-1:snapshot-3:" + "a" * 64])


def test_native_catalog_filters_before_pagination(
    sqlite_session: sqlalchemy.orm.Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from models.account import Tenant
    from models.agent import AgentStatus
    from services.agent import access_service
    from services.dify_builder.native_testing.agent_catalog import AgentCatalogService
    from tests.builder_agent_fixtures import add_agent, make_case

    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    case = make_case(sqlite_session)
    hidden, _ = add_agent(sqlite_session, tenant_id=case.actor.tenant_id, name="Hidden")
    unpublished, _ = add_agent(sqlite_session, tenant_id=case.actor.tenant_id, name="Unpublished", published=False)
    archived, _ = add_agent(
        sqlite_session, tenant_id=case.actor.tenant_id, name="Archived", status=AgentStatus.ARCHIVED
    )
    other = Tenant(name="Other workspace")
    sqlite_session.add(other)
    sqlite_session.flush()
    other_agent, _ = add_agent(sqlite_session, tenant_id=other.id, name="Other tenant")
    monkeypatch.setattr(
        access_service,
        "resolve_current_agent_access_filter",
        lambda **_kwargs: access_service.AgentAccessFilter(
            accessible_agent_ids={case.agent.id, unpublished.id, archived.id, other_agent.id}
        ),
    )
    result = AgentCatalogService(sqlite_session).list_candidates(
        tenant_id=case.actor.tenant_id, actor_id=case.actor.account_id, app_id=case.workflow.app_id, query=None, limit=1
    )
    assert [item.agent_id for item in result] == [case.agent.id]
    unpaginated = AgentCatalogService(sqlite_session).list_candidates(
        tenant_id=case.actor.tenant_id, actor_id=case.actor.account_id, app_id=case.workflow.app_id, query=None
    )
    assert [item.agent_id for item in unpaginated] == [case.agent.id]


def test_missing_tool_credentials_remain_discoverable_with_setup_status(
    sqlite_session: sqlalchemy.orm.Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.dify_builder.native_testing.agent_catalog import AgentCatalogService
    from tests.builder_agent_fixtures import make_case

    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    case = make_case(sqlite_session)
    candidates = AgentCatalogService(sqlite_session).list_candidates(
        tenant_id=case.actor.tenant_id, actor_id=case.actor.account_id, app_id=case.workflow.app_id, query=None
    )
    assert len(candidates) == 1
    assert candidates[0].readiness == "missing_config"
    assert candidates[0].dependencies == ("model:model-plugin/provider/test-model", "tool:plugin/provider/read")


@pytest.mark.parametrize("origin", ["agent_app", "roster", "imported_app", "imported_roster"])
def test_catalog_public_version_matches_native_visible_history_with_hidden_revisions(
    sqlite_session: sqlalchemy.orm.Session, monkeypatch: pytest.MonkeyPatch, origin: str
) -> None:
    from models.agent import AgentConfigRevision, AgentConfigRevisionOperation, AgentSource
    from services.agent.roster_service import AgentRosterService
    from services.dify_builder.agent import resources
    from services.dify_builder.native_testing.agent_catalog import AgentCatalogService, project_published_agent
    from tests.builder_agent_fixtures import make_case

    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    case = make_case(sqlite_session)
    case.agent.source = (
        AgentSource.IMPORTED
        if origin.startswith("imported")
        else AgentSource.ROSTER
        if origin == "roster"
        else AgentSource.AGENT_APP
    )
    if origin == "imported_app":
        case.agent.app_id = case.workflow.app_id
    initial_revision = sqlite_session.query(AgentConfigRevision).filter_by(agent_id=case.agent.id).one()
    initial_revision.operation = (
        AgentConfigRevisionOperation.IMPORT_PACKAGE
        if origin.startswith("imported")
        else AgentConfigRevisionOperation.CREATE_VERSION
        if origin == "roster"
        else AgentConfigRevisionOperation.PUBLISH_DRAFT
    )
    snapshots = {}
    for number in (2, 3, 4):
        snapshot = AgentConfigSnapshot(
            tenant_id=case.actor.tenant_id,
            agent_id=case.agent.id,
            version=number,
            summary="Published risk review",
            config_snapshot=case.snapshot.config_snapshot,
        )
        sqlite_session.add(snapshot)
        sqlite_session.flush()
        snapshots[number] = snapshot
    for revision, snapshot_number, operation in (
        (2, 2, AgentConfigRevisionOperation.SAVE_CURRENT_VERSION),  # hidden snapshot revision
        (3, 3, AgentConfigRevisionOperation.SAVE_NEW_VERSION),
        (4, 3, AgentConfigRevisionOperation.RESTORE_VERSION),  # duplicate visible reference, not a new version
        (5, 4, AgentConfigRevisionOperation.SAVE_NEW_VERSION),  # newer than the active restored snapshot
    ):
        sqlite_session.add(
            AgentConfigRevision(
                tenant_id=case.actor.tenant_id,
                agent_id=case.agent.id,
                current_snapshot_id=snapshots[snapshot_number].id,
                revision=revision,
                operation=operation,
            )
        )
    active = snapshots[3]
    case.agent.active_config_snapshot_id = active.id
    sqlite_session.commit()
    versions = AgentRosterService(sqlite_session).list_agent_versions(
        tenant_id=case.actor.tenant_id, agent_id=case.agent.id
    )
    native_active = next(version for version in versions if version["id"] == active.id)
    assert native_active["display_version"] == 2
    assert native_active["snapshot_version"] == 3
    assert len(versions) == 3

    candidate = AgentCatalogService(sqlite_session).list_candidates(
        tenant_id=case.actor.tenant_id, actor_id=case.actor.account_id, app_id=None, query=None
    )[0]

    assert candidate.display_version == native_active["display_version"]
    assert candidate.snapshot_version == native_active["snapshot_version"]
    # Display numbering must not change the confirmed snapshot binding/digest.
    assert candidate.resource_id == project_published_agent(agent=case.agent, snapshot=active).resource_id
    monkeypatch.setattr(resources, "db", PortDatabase(sqlite_session.get_bind()))
    monkeypatch.setattr(resources, "_list_models", lambda _tenant_id: [])
    monkeypatch.setattr(resources, "_list_datasets", lambda _tenant_id: [])
    monkeypatch.setattr(resources, "_list_tools", lambda _tenant_id: [])
    ref = resources.list_tenant_resources(case.actor.tenant_id, account_id=case.actor.account_id).agents[0]
    assert f"Published version 2 (snapshot {active.id})" in ref.meta
    assert ref.agent_contract is not None
    assert ref.agent_contract["display_version"] == 2
    assert ref.agent_contract["snapshot_version"] == 3


def test_catalog_without_native_visible_version_labels_only_the_snapshot_revision(
    sqlite_session: sqlalchemy.orm.Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from models.agent import AgentSource
    from services.agent.roster_service import AgentRosterService
    from services.dify_builder.agent import resources
    from tests.builder_agent_fixtures import make_case

    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    case = make_case(sqlite_session)
    case.agent.source = AgentSource.ROSTER
    sqlite_session.commit()
    # Direct roster eligibility is valid even without a user-facing version entry.
    assert (
        AgentRosterService(sqlite_session).list_agent_versions(tenant_id=case.actor.tenant_id, agent_id=case.agent.id)
        == []
    )
    monkeypatch.setattr(resources, "db", PortDatabase(sqlite_session.get_bind()))
    monkeypatch.setattr(resources, "_list_models", lambda _tenant_id: [])
    monkeypatch.setattr(resources, "_list_datasets", lambda _tenant_id: [])
    monkeypatch.setattr(resources, "_list_tools", lambda _tenant_id: [])

    ref = resources.list_tenant_resources(case.actor.tenant_id, account_id=case.actor.account_id).agents[0]

    assert f"Snapshot revision 1 (snapshot {case.snapshot.id}); public version unavailable" in ref.meta
    assert "Published version" not in ref.meta
    assert ref.agent_contract is not None
    assert ref.agent_contract["display_version"] is None
    assert ref.agent_contract["snapshot_version"] == 1


@pytest.mark.parametrize("state", ["unchanged", "drifted", "revoked"])
def test_confirmed_agent_is_revalidated_directly_after_catalog_page_movement(
    sqlite_session: sqlalchemy.orm.Session, monkeypatch: pytest.MonkeyPatch, state: str
) -> None:
    from datetime import datetime

    from models.agent import AgentConfigRevision, AgentConfigRevisionOperation
    from services.agent import access_service
    from services.dify_builder.agent import build, resources
    from services.dify_builder.native_testing.agent_binding import AgentSnapshotChanged
    from services.dify_builder.native_testing.agent_catalog import project_published_agent
    from tests.builder_agent_fixtures import add_agent, make_case

    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    case = make_case(sqlite_session)
    candidate = project_published_agent(agent=case.agent, snapshot=case.snapshot)
    for index in range(101):
        newer, _ = add_agent(sqlite_session, tenant_id=case.actor.tenant_id, name=f"Newer Agent {index}")
        newer.updated_at = datetime(2026, 10, 14)
    case.agent.updated_at = datetime(2000, 1, 1)
    sqlite_session.commit()
    monkeypatch.setattr(resources, "db", PortDatabase(sqlite_session.get_bind()))
    monkeypatch.setattr(resources, "_list_models", lambda _tenant_id: [])
    monkeypatch.setattr(resources, "_list_datasets", lambda _tenant_id: [])
    monkeypatch.setattr(resources, "_list_tools", lambda _tenant_id: [])
    inventory = resources.list_tenant_resources(case.actor.tenant_id, account_id=case.actor.account_id)
    assert len(inventory.agents) == 100
    assert candidate.resource_id not in {ref.id for ref in inventory.agents}
    if state == "drifted":
        replacement = AgentConfigSnapshot(
            tenant_id=case.actor.tenant_id,
            agent_id=case.agent.id,
            version=2,
            config_snapshot=case.snapshot.config_snapshot,
        )
        sqlite_session.add(replacement)
        sqlite_session.flush()
        case.agent.active_config_snapshot_id = replacement.id
        sqlite_session.add(
            AgentConfigRevision(
                tenant_id=case.actor.tenant_id,
                agent_id=case.agent.id,
                current_snapshot_id=replacement.id,
                revision=2,
                operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
            )
        )
        sqlite_session.commit()
        with pytest.raises(AgentSnapshotChanged):
            build.bind_resources(
                None, case.actor.tenant_id, ["Review risk"], [candidate.resource_id], account_id=case.actor.account_id
            )
    elif state == "revoked":
        monkeypatch.setattr(
            access_service,
            "resolve_current_agent_access_filter",
            lambda **_kwargs: access_service.AgentAccessFilter(accessible_agent_ids=set()),
        )
        with pytest.raises(ValueError, match="no longer available"):
            build.bind_resources(
                None, case.actor.tenant_id, ["Review risk"], [candidate.resource_id], account_id=case.actor.account_id
            )
    else:
        result = build.bind_resources(
            None, case.actor.tenant_id, ["Review risk"], [candidate.resource_id], account_id=case.actor.account_id
        )
        assert candidate.resource_id in result[0]
