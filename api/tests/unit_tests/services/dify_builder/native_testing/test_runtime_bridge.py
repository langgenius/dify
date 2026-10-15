"""No ordinary collaborator is constructed for a marked native run."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from services.dify_builder.native_testing.context_binding import NativeContextUnavailable
from services.dify_builder.native_testing.runtime_contracts import ResolvedNativeTestContext
from tests.unit_tests.services.dify_builder.native_testing.test_runtime_contracts import CONTEXT


def bridge_fixture():
    from services.dify_builder.native_testing.runtime_bridge import NativeCollaborators, NativeRuntimeBridge

    context = ResolvedNativeTestContext(**CONTEXT)
    state = Mock(load_context=Mock(return_value=context))
    bundle = NativeCollaborators(**{name: object() for name in NativeCollaborators.__dataclass_fields__})
    provider = Mock(return_value=bundle)
    occurrences = Mock(return_value=("iteration", "3", "node"))
    arguments = Mock(return_value={"http_client": bundle.http})
    bridge = NativeRuntimeBridge(
        state=state,
        collaborators=provider,
        occurrences=occurrences,
        node_arguments=arguments,
    )
    return context, bridge, bundle, provider, occurrences, arguments


def test_occurrence_and_root_budget_are_passed_to_explicit_bundle():
    context, bridge, bundle, provider, _, _ = bridge_fixture()
    runtime = object()
    assert bridge.for_node(ref=context.ref, occurrence_path=("loop", "2", "node"), runtime_state=runtime) is bundle
    call = provider.call_args.kwargs
    assert call["context"].budget_ref == context.budget_ref
    assert call["occurrence_path"] == ("loop", "2", "node")
    assert call["runtime_state"] is runtime


def test_missing_occurrence_fails_before_collaborator_construction():
    context, bridge, _, provider, _, _ = bridge_fixture()
    with pytest.raises(NativeContextUnavailable, match="native_occurrence_missing"):
        bridge.for_node(ref=context.ref, occurrence_path=(), runtime_state=object())
    provider.assert_not_called()


def test_marked_factory_requires_bridge_before_eager_model_setup(monkeypatch):
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from core.workflow import node_factory

    eager = Mock(side_effect=AssertionError("ordinary setup"))
    monkeypatch.setattr(node_factory, "build_dify_model_access", eager)
    context = DifyRunContext(
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="actor-1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        native_test_required=True,
    )
    with pytest.raises(NativeContextUnavailable, match="native_context_missing"):
        node_factory.DifyNodeFactory(
            graph_init_params=SimpleNamespace(run_context={"_dify": context}),
            graph_runtime_state=object(),
        )
    eager.assert_not_called()


def test_factory_preserves_bridge_on_runtime_clone_and_checks_owners(monkeypatch):
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from core.workflow import node_factory

    context, bridge, _, provider, _, _ = bridge_fixture()
    eager = Mock(side_effect=AssertionError("ordinary setup"))
    monkeypatch.setattr(node_factory, "build_dify_model_access", eager)
    run = DifyRunContext(
        tenant_id=context.tenant_id,
        app_id=context.app_id,
        user_id=context.actor_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        native_test_required=True,
        native_test_ref=context.ref,
    )
    init = SimpleNamespace(
        run_context={"_dify": run}, workflow_id=context.workflow_id, graph_config=context.graph, call_depth=0
    )
    factory = node_factory.DifyNodeFactory(graph_init_params=init, graph_runtime_state=object(), native_runtime=bridge)
    clone = factory.with_runtime_state(object())
    assert clone._native_runtime is bridge
    provider.assert_not_called()
    eager.assert_not_called()
    init.workflow_id = "foreign"
    with pytest.raises(NativeContextUnavailable, match="native_context_mismatch"):
        node_factory.DifyNodeFactory(graph_init_params=init, graph_runtime_state=object(), native_runtime=bridge)


def test_unmarked_factory_cannot_accept_native_bridge(monkeypatch):
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from core.workflow import node_factory

    _, bridge, _, _, _, _ = bridge_fixture()
    eager = Mock(side_effect=AssertionError("ordinary setup"))
    monkeypatch.setattr(node_factory, "build_dify_model_access", eager)
    run = DifyRunContext(
        tenant_id="t", app_id="a", user_id="u", user_from=UserFrom.ACCOUNT, invoke_from=InvokeFrom.DEBUGGER
    )
    with pytest.raises(NativeContextUnavailable, match="native_context_missing"):
        node_factory.DifyNodeFactory(
            graph_init_params=SimpleNamespace(run_context={"_dify": run}, workflow_id="w"),
            graph_runtime_state=object(),
            native_runtime=bridge,
        )
    eager.assert_not_called()


def test_native_factory_constructs_real_registered_start_with_explicit_occurrence():
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from core.workflow.node_factory import DifyGraphInitContext, DifyNodeFactory
    from graphon.nodes.start.start_node import StartNode
    from graphon.runtime import GraphRuntimeState, VariablePool

    context, bridge, bundle, provider, occurrences, arguments = bridge_fixture()
    node = {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}
    context = context.model_copy(update={"graph": {"nodes": [node], "edges": []}})
    bridge.state.load_context.return_value = context
    arguments.return_value = {}
    occurrences.return_value = ("root", "start")
    run = DifyRunContext(
        tenant_id=context.tenant_id,
        app_id=context.app_id,
        user_id=context.actor_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        native_test_required=True,
        native_test_ref=context.ref,
    )
    factory = DifyNodeFactory.from_graph_init_context(
        graph_init_context=DifyGraphInitContext(
            workflow_id=context.workflow_id, graph_config=context.graph, run_context={"_dify": run}, call_depth=0
        ),
        graph_runtime_state=GraphRuntimeState(variable_pool=VariablePool(), start_at=0),
        native_runtime=bridge,
    )
    created = factory.create_node(node)
    assert isinstance(created, StartNode)
    assert provider.call_args.kwargs["occurrence_path"] == ("root", "start")
    assert arguments.call_args.kwargs["collaborators"] is bundle
