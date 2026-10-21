"""Real catalogue identities and truthful metadata ground Builder edits."""

from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Never
from unittest.mock import patch

import pytest
from pydantic import JsonValue

from core.entities.model_entities import ModelStatus
from core.workflow.generator.tool_catalogue import ToolCatalogueEntry
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from services.dify_builder.agent import resources
from services.dify_builder.agent.resources import TenantResources
from services.entities.model_provider_entities import ProviderWithModelsResponse
from tests.unit_tests.services.dify_builder.test_resources import _provider_models


def catalogue(models: list[ProviderWithModelsResponse]) -> AbstractContextManager[object]:
    return patch.multiple(
        resources,
        _list_models=lambda _tenant: models,
        _list_tools=lambda _tenant: [],
        _list_datasets=lambda _tenant: [],
    )


def test_catalogue_failure_is_distinct_from_successful_empty() -> None:
    with catalogue([]):
        assert resources.list_tenant_resources("tenant").model_source_error is None

    def unavailable(_tenant: object) -> Never:
        raise ConnectionRefusedError("private service address")

    with catalogue([]), patch.object(resources, "_list_models", unavailable):
        result = resources.list_tenant_resources("tenant")
    assert result.models == []
    assert result.model_source_error == "inventory_unavailable"


def test_model_binding_uses_exact_source_ids_without_claiming_live_health() -> None:
    provider = _provider_models("langgenius/anthropic/anthropic", ["claude-fable-5-1"])
    with catalogue([provider]):
        ref = resources.list_tenant_resources("tenant").models[0]
    assert ref.binding == {"provider": "langgenius/anthropic/anthropic", "name": "claude-fable-5-1"}
    assert ref.availability["configuration"] == "configured"
    assert ref.availability["runtime"] == "unverified"
    assert ref.availability["lifecycle"] == "not_reported"


def test_explicitly_deprecated_models_are_not_candidates() -> None:
    provider = _provider_models("provider", ["retired"])
    provider.models[0].deprecated = True
    with catalogue([provider]):
        assert resources.list_tenant_resources("tenant").models == []


def test_visible_model_without_configuration_is_not_ready() -> None:
    provider = _provider_models("provider", ["needs-setup"])
    provider.models[0].status = ModelStatus.NO_CONFIGURE
    with catalogue([provider]):
        ref = resources.list_tenant_resources("tenant").models[0]
    assert ref.readiness == "missing_config"
    assert ref.availability["runtime"] == "unverified"


def test_partial_tool_catalogue_retains_verified_entries_and_source_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def partial(_tenant: object, *, on_source_error: Callable[[str], None] | None = None) -> list[ToolCatalogueEntry]:
        assert on_source_error is not None
        on_source_error("plugin_inventory")
        return [
            {
                "provider_name": "time",
                "tool_name": "now",
                "provider_type": "builtin",
                "plugin_id": "",
                "tool_label": "Now",
                "description": "Clock",
                "needs_credentials": False,
            }
        ]

    monkeypatch.setattr(resources, "build_tool_catalogue", partial)
    with (
        patch.object(resources, "_list_models", lambda _tenant: list[ProviderWithModelsResponse]()),
        patch.object(resources, "_list_datasets", lambda _tenant: list[object]()),
    ):
        result = resources.list_tenant_resources("tenant")
    assert result.tools[0].id == "time/now"
    assert result.tool_source_error == "inventory_unavailable"


def model_graph(provider: str = "provider", name: str = "old") -> dict[str, JsonValue]:
    return {
        "nodes": [
            {"id": "llm", "data": {"type": "llm", "model": {"provider": provider, "name": name, "mode": "chat"}}}
        ],
        "edges": [],
    }


def test_changed_model_requires_exact_catalogue_identity_and_confirmed_choice() -> None:
    import pytest

    from services.dify_builder.resource_grounding import ResourceBindingError, validate_changed_resources

    ref = resources.ResourceRef(
        id="langgenius/anthropic/anthropic/claude-fable-5-1",
        label="Fable 5.1",
        binding={"provider": "langgenius/anthropic/anthropic", "name": "claude-fable-5-1"},
    )
    directory = resources.TenantResources(models=[ref], tools=[], datasets=[])
    before = model_graph()
    after = model_graph("langgenius/anthropic/anthropic", "claude-fable-5-1")
    validate_changed_resources(before, after, directory, confirmed_ids=["model:" + ref.id])
    with pytest.raises(ResourceBindingError, match="resource_not_in_catalogue"):
        validate_changed_resources(before, model_graph("anthropic", "claude-5.1-fable"), directory)
    with pytest.raises(ResourceBindingError, match="resource_selection_required"):
        validate_changed_resources(before, after, directory, confirmed_ids=[])


def test_unrelated_old_resource_does_not_block_other_edits() -> None:
    from services.dify_builder.resource_grounding import validate_changed_resources

    before = model_graph("historical-provider", "old-unavailable-model")
    after = model_graph("historical-provider", "old-unavailable-model")
    nodes = after["nodes"]
    assert isinstance(nodes, list)
    node = nodes[0]
    assert isinstance(node, dict)
    data = node["data"]
    assert isinstance(data, dict)
    data["title"] = "Renamed node"
    validate_changed_resources(
        before,
        after,
        resources.TenantResources(models=[], tools=[], datasets=[], model_source_error="inventory_unavailable"),
    )


def test_missing_candidate_from_failed_source_is_not_reported_as_absent() -> None:
    import pytest

    from services.dify_builder.resource_grounding import ResourceBindingError, validate_changed_resources

    with pytest.raises(ResourceBindingError, match="resource_catalogue_unavailable"):
        validate_changed_resources(
            model_graph(),
            model_graph(name="new"),
            resources.TenantResources(models=[], tools=[], datasets=[], model_source_error="inventory_unavailable"),
        )


def test_installed_unauthorized_tool_can_bind_for_later_setup() -> None:
    from services.dify_builder.resource_grounding import validate_changed_resources

    ref = resources.ResourceRef(
        id="provider/action",
        label="Tool",
        readiness="missing_config",
        binding={"provider_id": "provider", "tool_name": "action", "provider_type": "builtin"},
    )
    graph = {
        "nodes": [
            {
                "id": "tool",
                "data": {"type": "tool", "provider_id": "provider", "provider_type": "builtin", "tool_name": "action"},
            }
        ]
    }
    validate_changed_resources(
        {"nodes": []},
        graph,
        resources.TenantResources(models=[], tools=[ref], datasets=[]),
        confirmed_ids=["tool:" + ref.id],
    )


def test_real_write_boundary_rechecks_workspace_before_opening_write_transaction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from copy import deepcopy
    from unittest.mock import patch

    import pytest

    from core.dify_builder.models import Actor, MutationIntent
    from services.dify_builder.dify_port import WorkflowServiceDifyPort
    from services.dify_builder.resource_grounding import ResourceBindingError

    before = model_graph()
    port = WorkflowServiceDifyPort()
    monkeypatch.setattr(port, "read_graph", lambda _app, _actor: (deepcopy(before), "current"))
    calls = []

    def current_directory(tenant_id: str, *, account_id: str) -> TenantResources:
        calls.append((tenant_id, account_id))
        return resources.TenantResources(models=[], tools=[], datasets=[])

    monkeypatch.setattr(resources, "list_tenant_resources", current_directory)
    with patch("services.dify_builder.dify_port._session_factory") as writer:
        with pytest.raises(ResourceBindingError, match="resource_not_in_catalogue"):
            port.apply_repair(
                "app",
                Actor(account_id="actor", tenant_id="tenant"),
                [
                    MutationIntent(
                        op="set_node_config",
                        args={
                            "node_id": "llm",
                            "path": "model",
                            "value": {"provider": "anthropic", "name": "claude-5.1-fable", "mode": "chat"},
                        },
                    )
                ],
                expected_revision="current",
            )
    assert calls == [("tenant", "actor")]
    writer.assert_not_called()


def test_blank_editor_node_remains_an_explicit_unconfigured_placeholder() -> None:
    from services.dify_builder.resource_grounding import changed_resource_nodes

    graph = {"nodes": [{"id": "llm", "data": {"type": "llm", "model": {"provider": "", "name": "", "mode": "chat"}}}]}
    assert changed_resource_nodes({"nodes": []}, graph) == []


def test_edit_resource_form_uses_canonical_unique_match() -> None:
    from services.dify_builder.resource_grounding import ground_edit_impact, resolve_edit_choices

    ref = resources.ResourceRef(
        id="langgenius/anthropic/anthropic/claude-fable-5-1",
        label="Fable 5.1",
        binding={"provider": "langgenius/anthropic/anthropic", "name": "claude-fable-5-1"},
    )
    directory = resources.TenantResources(models=[ref], tools=[], datasets=[])
    impact = ground_edit_impact(
        {
            "fields": [],
            "values": {},
            "target_node_ids": ["llm"],
            "resource_requests": [{"kind": "model", "node_id": "llm", "query": "fable 5.1"}],
        },
        directory,
    )
    field = impact["fields"][0]
    assert field["options"] == ["model:" + ref.id]
    assert field["required"] is True
    selected = resolve_edit_choices(impact["fields"], impact["values"], directory)
    assert selected["resource_ids"] == ["model:" + ref.id]
    assert selected["bindings"][field["key"]]["name"] == "claude-fable-5-1"


def test_ambiguous_resources_have_no_automatic_choice() -> None:
    import pytest

    from services.dify_builder.resource_grounding import ResourceBindingError, ground_edit_impact, resolve_edit_choices

    refs = [
        resources.ResourceRef(
            id=f"{provider}/claude-fable-5-1",
            label="Fable 5.1",
            binding={"provider": provider, "name": "claude-fable-5-1"},
        )
        for provider in ("first", "second")
    ]
    directory = resources.TenantResources(models=refs, tools=[], datasets=[])
    impact = ground_edit_impact(
        {"fields": [], "values": {}, "resource_requests": [{"kind": "model", "query": "fable 5.1"}]}, directory
    )
    assert list(impact["values"].values()) == [""]
    with pytest.raises(ResourceBindingError, match="resource_selection_required"):
        resolve_edit_choices(impact["fields"], impact["values"], directory)
    key = impact["fields"][0]["key"]
    selected = resolve_edit_choices(impact["fields"], {key: "model:" + refs[1].id}, directory)
    assert selected["resource_ids"] == ["model:" + refs[1].id]


def test_resource_removed_after_form_creation_is_rejected_before_planning() -> None:
    import pytest

    from services.dify_builder.resource_grounding import ResourceBindingError, ground_edit_impact, resolve_edit_choices

    ref = resources.ResourceRef(id="provider/new", label="new", binding={"provider": "provider", "name": "new"})
    directory = resources.TenantResources(models=[ref], tools=[], datasets=[])
    impact = ground_edit_impact(
        {"fields": [], "values": {}, "resource_requests": [{"kind": "model", "query": "new"}]}, directory
    )
    with pytest.raises(ResourceBindingError, match="resource_not_in_catalogue"):
        resolve_edit_choices(
            impact["fields"], impact["values"], resources.TenantResources(models=[], tools=[], datasets=[])
        )


def test_real_edit_agent_discovers_actor_scoped_resource_choices(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent import edit
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    ref = resources.ResourceRef(
        id="provider/claude-fable-5-1", label="Fable 5.1", binding={"provider": "provider", "name": "claude-fable-5-1"}
    )
    calls = []

    def directory(tenant: str, *, account_id: str) -> TenantResources:
        calls.append((tenant, account_id))
        return resources.TenantResources(models=[ref], tools=[], datasets=[])

    monkeypatch.setattr(resources, "list_tenant_resources", directory)
    monkeypatch.setattr(
        edit.llm,
        "invoke_json",
        lambda *_a, **_k: {
            "fields": [],
            "values": {},
            "target_node_ids": ["llm"],
            "resource_requests": [{"kind": "model", "node_id": "llm", "query": "fable 5.1"}],
        },
    )
    agent = LlmBuilderAgent("tenant", account_id="actor")
    monkeypatch.setattr(agent, "model_or_none", lambda: object())
    impact = agent.analyze_impact("换成 fable 5.1", model_graph())
    assert impact["fields"][0]["options"] == ["model:" + ref.id]
    assert calls == [("tenant", "actor")]
    selected = agent.resolve_edit_bindings(impact["fields"], impact["values"], model_graph())
    assert selected["resource_ids"] == ["model:" + ref.id]


def test_edit_gate_resolves_resource_choices_before_asking_for_plan(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Session, Turn
    from core.dify_builder.state import PcState
    from services.dify_builder.application.handlers_edit import handle_impact_analysis
    from services.dify_builder.plan import WorkflowPlan
    from tests.unit_tests.core.dify_builder.test_runner import _new_env

    env, _ = _new_env()
    seen: list[dict[str, JsonValue]] = []
    selection = {
        "resource_ids": ["model:provider/real"],
        "bindings": {"choice": {"provider": "provider", "name": "real"}},
        "fingerprints": {"model:provider/real": "revision"},
    }
    monkeypatch.setattr(env.agent, "resolve_edit_bindings", lambda *_args: selection, raising=False)

    def plan(
        edit_rules: dict[str, JsonValue], graph: dict[str, JsonValue], *, reply_language: str | None = None
    ) -> WorkflowPlan:
        del graph, reply_language
        seen.append(edit_rules)
        return WorkflowPlan(
            title="Real model", input_summary="Input", output_summary="Output", items=["Use the selected model"]
        )

    env.agent.propose_edit_plan = plan
    session = Session(
        id="s",
        app_id="app",
        tenant_id="t",
        owner_account_id="u",
        entry_mode=EntryMode.EDIT,
        current_state=PcState.EDIT_IMPACT_ANALYSIS,
    )
    context = DifyBuilderContext(
        form_fields=[{"key": "choice", "type": "select"}], edit_rules={"choice": "model:provider/real"}
    )
    step = handle_impact_analysis(
        env,
        Turn(
            actor=Actor(account_id="u", tenant_id="t"),
            action=Action(kind="submit_edit_rules", payload={"choice": "model:provider/real"}),
        ),
        session,
        context,
    )
    assert step.next == PcState.EDIT_PLAN_APPROVAL
    assert context.resource_selection["resource_ids"] == ["model:provider/real"]
    bindings = seen[0]["__builder_resource_bindings"]
    assert isinstance(bindings, dict)
    choice = bindings["choice"]
    assert isinstance(choice, dict)
    assert choice["name"] == "real"


def test_missing_choice_returns_to_edit_form_instead_of_failed_task(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Session, Turn
    from core.dify_builder.state import PcState
    from services.dify_builder.application.handlers_edit import handle_impact_analysis
    from services.dify_builder.resource_grounding import ResourceBindingError
    from tests.unit_tests.core.dify_builder.test_runner import _new_env

    env, _ = _new_env()

    def refuse(*_args: object) -> Never:
        raise ResourceBindingError("resource_selection_required", "llm", "model")

    monkeypatch.setattr(env.agent, "resolve_edit_bindings", refuse, raising=False)
    from services.dify_builder.plan import WorkflowPlan

    env.agent.propose_edit_plan = lambda *_a, **_k: WorkflowPlan(
        title="Plan", input_summary="Input", output_summary="Output", items=["Change"]
    )
    session = Session(
        id="s",
        app_id="app",
        tenant_id="t",
        owner_account_id="u",
        entry_mode=EntryMode.EDIT,
        current_state=PcState.EDIT_IMPACT_ANALYSIS,
    )
    context = DifyBuilderContext(form_fields=[{"key": "choice", "type": "select"}])
    step = handle_impact_analysis(
        env, Turn(actor=Actor(account_id="u", tenant_id="t"), action=Action(kind="submit_edit_rules")), session, context
    )
    assert step.next == PcState.EDIT_IMPACT_ANALYSIS
    assert any(item.kind == "form" for item in step.items)


def test_resource_version_change_requires_new_choice_and_plan() -> None:
    import pytest

    from services.dify_builder.resource_grounding import (
        ResourceBindingError,
        ground_edit_impact,
        resolve_edit_choices,
        validate_changed_resources,
    )

    original = resources.ResourceRef(
        id="provider/action",
        label="Action",
        binding={
            "provider_id": "provider",
            "provider_type": "builtin",
            "tool_name": "action",
            "plugin_unique_identifier": "version-1",
        },
    )
    updated = resources.ResourceRef(
        id=original.id, label="Action", binding={**original.binding, "plugin_unique_identifier": "version-2"}
    )
    directory = resources.TenantResources(models=[], tools=[original], datasets=[])
    impact = ground_edit_impact(
        {"fields": [], "values": {}, "resource_requests": [{"kind": "tool", "query": "action"}]}, directory
    )
    chosen = resolve_edit_choices(impact["fields"], impact["values"], directory)
    current = resources.TenantResources(models=[], tools=[updated], datasets=[])
    with pytest.raises(ResourceBindingError, match="resource_catalogue_changed"):
        resolve_edit_choices(impact["fields"], impact["values"], current)
    graph = {
        "nodes": [
            {
                "id": "tool",
                "data": {"type": "tool", "provider_id": "provider", "provider_type": "builtin", "tool_name": "action"},
            }
        ]
    }
    with pytest.raises(ResourceBindingError, match="resource_catalogue_changed"):
        validate_changed_resources(
            {"nodes": []},
            graph,
            current,
            confirmed_ids=chosen["resource_ids"],
            expected_fingerprints=chosen["fingerprints"],
        )


def test_malformed_resource_request_does_not_crash_edit_preparation() -> None:
    from services.dify_builder.resource_grounding import ground_edit_impact

    result = ground_edit_impact(
        {"fields": [], "values": {}, "resource_requests": [{"kind": ["model"]}, None]},
        resources.TenantResources(models=[], tools=[], datasets=[]),
    )
    assert result["fields"] == []


def test_tool_schema_change_invalidates_confirmed_choice() -> None:
    import pytest

    from services.dify_builder.resource_grounding import ResourceBindingError, ground_edit_impact, resolve_edit_choices

    entry: ToolCatalogueEntry = {
        "provider_name": "provider",
        "provider_type": "builtin",
        "plugin_id": "",
        "tool_name": "action",
        "tool_label": "Action",
        "description": "",
        "needs_credentials": False,
        "parameters": [{"name": "query", "type": "string", "required": True}],
        "output_schema": {},
    }
    before = resources._tool_ref(entry, set())
    impact = ground_edit_impact(
        {"resource_requests": [{"kind": "tool", "query": "action"}]},
        resources.TenantResources(models=[], datasets=[], tools=[before]),
    )
    after = resources._tool_ref(
        {**entry, "parameters": [{"name": "record_id", "type": "string", "required": True}]}, set()
    )
    with pytest.raises(ResourceBindingError, match="resource_catalogue_changed"):
        resolve_edit_choices(
            impact["fields"], impact["values"], resources.TenantResources(models=[], datasets=[], tools=[after])
        )


def test_replacing_tool_rejects_parameters_not_declared_by_selected_action() -> None:
    import pytest

    from services.dify_builder.resource_grounding import ResourceBindingError, validate_changed_resources

    entry: ToolCatalogueEntry = {
        "provider_name": "provider",
        "provider_type": "builtin",
        "plugin_id": "",
        "tool_name": "new",
        "tool_label": "New",
        "description": "",
        "needs_credentials": False,
        "parameters": [{"name": "record_id", "form": "llm", "type": "string", "required": True}],
    }
    ref = resources._tool_ref(entry, set())
    graph: dict[str, JsonValue] = {
        "nodes": [
            {
                "id": "tool-1",
                "data": {
                    "type": "tool",
                    "provider_id": "provider",
                    "provider_type": "builtin",
                    "tool_name": "new",
                    "tool_parameters": {"query": {"type": "constant", "value": "test"}},
                },
            }
        ]
    }
    with pytest.raises(ResourceBindingError, match="resource_configuration_incompatible"):
        validate_changed_resources({"nodes": []}, graph, resources.TenantResources(models=[], datasets=[], tools=[ref]))
    nodes = graph["nodes"]
    assert isinstance(nodes, list)
    node = nodes[0]
    assert isinstance(node, dict)
    data = node["data"]
    assert isinstance(data, dict)
    data["tool_parameters"] = {"record_id": {"type": "variable", "value": ["start", "record_id"]}}
    validate_changed_resources({"nodes": []}, graph, resources.TenantResources(models=[], datasets=[], tools=[ref]))


def test_two_confirmed_resources_cannot_be_swapped_between_target_nodes() -> None:
    import pytest

    from services.dify_builder.resource_grounding import (
        ResourceBindingError,
        ground_edit_impact,
        resolve_edit_choices,
        validate_changed_resources,
    )

    refs = [
        resources.ResourceRef(id=f"p/{name}", label=name, binding={"provider": "p", "name": name})
        for name in ("a", "b")
    ]
    directory = resources.TenantResources(models=refs, tools=[], datasets=[])
    impact = ground_edit_impact(
        {
            "resource_requests": [
                {"kind": "model", "node_id": "n1", "query": "p/a"},
                {"kind": "model", "node_id": "n2", "query": "p/b"},
            ]
        },
        directory,
    )
    chosen = resolve_edit_choices(impact["fields"], impact["values"], directory)
    graph = {
        "nodes": [
            {"id": node, "data": {"type": "llm", "model": {"provider": "p", "name": name}}}
            for node, name in (("n1", "b"), ("n2", "a"))
        ]
    }
    with pytest.raises(ResourceBindingError, match="resource_selection_required"):
        validate_changed_resources(
            {"nodes": []},
            graph,
            directory,
            confirmed_ids=chosen["resource_ids"],
            expected_fingerprints=chosen["fingerprints"],
            expected_node_resources=chosen["node_resources"],
        )
    graph["nodes"][0]["data"]["model"]["name"] = "a"
    graph["nodes"][1]["data"]["model"]["name"] = "b"
    validate_changed_resources(
        {"nodes": []},
        graph,
        directory,
        confirmed_ids=chosen["resource_ids"],
        expected_fingerprints=chosen["fingerprints"],
        expected_node_resources=chosen["node_resources"],
    )


def test_explicit_unchanged_target_must_match_its_confirmed_resource() -> None:
    import pytest

    from services.dify_builder.resource_grounding import ResourceBindingError, validate_changed_resources

    refs = [
        resources.ResourceRef(id=f"p/{name}", label=name, binding={"provider": "p", "name": name})
        for name in ("a", "b")
    ]
    graph = {"nodes": [{"id": "n", "data": {"type": "llm", "model": {"provider": "p", "name": "a"}}}]}
    with pytest.raises(ResourceBindingError, match="resource_selection_required"):
        validate_changed_resources(
            graph,
            graph,
            resources.TenantResources(models=refs, datasets=[], tools=[]),
            confirmed_ids=["model:p/a", "model:p/b"],
            expected_node_resources={"n": "model:p/b"},
        )


def test_native_noop_rechecks_explicit_resource_choice_before_transaction(monkeypatch: pytest.MonkeyPatch) -> None:
    import pytest

    from core.dify_builder.models import Actor
    from services.dify_builder.dify_port import WorkflowServiceDifyPort
    from services.dify_builder.resource_grounding import ResourceBindingError

    port = WorkflowServiceDifyPort()
    graph = model_graph("p", "a")
    monkeypatch.setattr(port, "read_graph", lambda *_: (graph, "rev"))
    refs = [
        resources.ResourceRef(id=f"p/{name}", label=name, binding={"provider": "p", "name": name})
        for name in ("a", "b")
    ]
    monkeypatch.setattr(
        resources,
        "list_tenant_resources",
        lambda *_a, **_k: resources.TenantResources(models=refs, datasets=[], tools=[]),
    )
    with patch("services.dify_builder.dify_port._session_factory") as writer:
        with pytest.raises(ResourceBindingError, match="resource_selection_required"):
            port.apply_repair(
                "app",
                Actor(account_id="actor", tenant_id="tenant"),
                [],
                expected_revision="rev",
                confirmed_resource_ids=["model:p/b"],
                expected_node_resources={"llm": "model:p/b"},
            )
        writer.assert_not_called()


def test_existing_build_plugin_selection_uses_the_same_exact_tool_identity() -> None:
    from services.dify_builder.resource_grounding import validate_changed_resources

    ref = resources.ResourceRef(
        id="provider/action",
        label="Action",
        binding={"provider_id": "provider", "tool_name": "action", "provider_type": "builtin"},
    )
    graph = {
        "nodes": [
            {
                "id": "tool",
                "data": {"type": "tool", "provider_type": "builtin", "provider_id": "provider", "tool_name": "action"},
            }
        ]
    }
    validate_changed_resources(
        {"nodes": []},
        graph,
        resources.TenantResources(models=[], datasets=[], tools=[ref]),
        confirmed_ids=["plugin:provider/action"],
    )


def test_resource_cognition_receives_configuration_and_unknown_health_facts() -> None:
    from services.dify_builder.agent.build import _discovery_line

    ref = resources.ResourceRef(
        id="p/m",
        label="Model",
        readiness="ready",
        availability={"configuration": "configured", "runtime": "unverified", "lifecycle": "not_reported"},
    )
    line = _discovery_line(ref.id, "model", ref)
    assert '"runtime": "unverified"' in line
    assert '"lifecycle": "not_reported"' in line


def test_selected_model_preserves_declared_mode_for_compatibility() -> None:
    import pytest

    from services.dify_builder.resource_grounding import ResourceBindingError, validate_changed_resources

    provider = _provider_models("provider", ["new"])
    provider.models[0].model_properties = {ModelPropertyKey.MODE: "completion"}
    with catalogue([provider]):
        directory = resources.list_tenant_resources("tenant")
    graph = model_graph(name="new")  # existing chat mode cannot silently become a completion model
    with pytest.raises(ResourceBindingError, match="resource_configuration_incompatible"):
        validate_changed_resources({"nodes": []}, graph, directory)
    nodes = graph["nodes"]
    assert isinstance(nodes, list)
    node = nodes[0]
    assert isinstance(node, dict)
    data = node["data"]
    assert isinstance(data, dict)
    model = data["model"]
    assert isinstance(model, dict)
    model["mode"] = "completion"
    validate_changed_resources({"nodes": []}, graph, directory)


def test_model_mode_declaration_change_invalidates_shown_choice() -> None:
    from dataclasses import replace

    from services.dify_builder.resource_grounding import resource_fingerprint

    ref = resources.ResourceRef(
        id="provider/model",
        label="Model",
        binding={"provider": "provider", "name": "model"},
        model_contract={"mode": "chat", "features": []},
    )
    assert resource_fingerprint(ref) != resource_fingerprint(replace(ref, model_contract={"mode": "completion"}))


def test_selected_tool_binding_contains_native_required_public_fields() -> None:
    from graphon.nodes.tool.entities import ToolNodeData

    ref = resources._tool_ref(
        {
            "provider_name": "langgenius/json_process/json_process",
            "provider_type": "builtin",
            "plugin_id": "",
            "tool_name": "parse",
            "tool_label": "JSON Parse",
            "description": "Extract JSON",
            "needs_credentials": False,
            "parameters": [],
        },
        set(),
    )
    node = ToolNodeData.model_validate(
        {
            "type": "tool",
            "title": "字段验证",
            "tool_parameters": {},
            "tool_configurations": {},
            **ref.binding,
        }
    )
    assert node.provider_name == "langgenius/json_process/json_process"
    assert node.tool_label == "JSON Parse"
    assert node.tool_name == "parse"
