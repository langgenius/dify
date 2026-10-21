"""Concrete opaque HTTP policy and actual native semantic attestation, offline only."""

from collections.abc import Callable, Generator
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import NoReturn, cast

import httpx
import pytest
from sqlalchemy.orm import sessionmaker

from core.dify_builder.models import Actor
from graphon.http import HttpResponse
from graphon.nodes.http_request import HttpRequestNode
from graphon.nodes.http_request.entities import HttpRequestNodeData, Response
from graphon.runtime import VariablePool
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.contracts import DispatchPermit, EffectIntent, JsonValue, NativeTestContextRef
from runtime_contracts.builder.native.runtime_contracts import NativeStatePort
from services.dify_builder.native_testing import http_binding as http_binding_module
from services.dify_builder.native_testing.call_adapter import NativeCallAdapter, ScalarAuthorizationPort
from services.dify_builder.native_testing.http_adapter import (
    NativeHttpIntentPort,
    PreparedHttpBinding,
    PreparedHttpRequest,
    ScalarCallPort,
)
from services.dify_builder.native_testing.http_binding import (
    DeferredNativeHttpClient,
    NativeHttpBindingProducer,
    NativeHttpBindingResolver,
    NativeHttpPreparedObserver,
)
from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
from services.dify_builder.native_testing.private_reads import PrivateReadOwner
from services.dify_builder.native_testing.repository import OwnedNativeTest, OwnedNativeTestLoader
from services.dify_builder.native_testing.runtime_bridge import NativeNodePreparation, NativeRuntimeBridge
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from tests.unit_tests.services.dify_builder.native_testing.test_call_adapter import Authorization, State
from tests.unit_tests.services.dify_builder.native_testing.test_http_adapter import (
    protected_application_logs as protected_application_logs,  # noqa: PLC0414 - shared pytest fixture
)
from tests.unit_tests.services.dify_builder.native_testing.test_runtime_bridge import SyntheticSink


@dataclass
class ConcreteHttpCase:
    producer: NativeHttpBindingProducer
    state: State
    auth: Authorization
    journal: NodeOperationJournal
    association: NativeNodePreparation
    node: HttpRequestNode
    events: list[tuple[object, ...]]
    uuid: str
    raw: dict[str, JsonValue]
    owned: OwnedNativeTest
    reply: Callable[[httpx.Request], httpx.Response] | None = None
    prepared: list[PreparedHttpBinding] = field(default_factory=list)
    sent: list[httpx.Request] = field(default_factory=list)
    client: DeferredNativeHttpClient | None = None


class NonCallableHttpCalls:
    call: None = None


def data(**changes: JsonValue) -> dict[str, JsonValue]:
    return {
        "type": "http-request",
        "version": "1",
        "title": "HTTP",
        "method": "post",
        "url": "https://example.com/private/SENTINEL?token=SENTINEL",
        "authorization": {"type": "no-auth"},
        "headers": "",
        "params": "",
        "body": {"type": "json", "data": [{"type": "text", "key": "", "value": '{"secret":"SENTINEL","flag":true}'}]},
        **changes,
    }


def test_profile_has_explicit_shared_accounting_and_caps() -> None:
    m = http_binding_module
    p = m.build_native_http_profile()
    assert p.profile_id == p.implementation_revision == "builder-native-http-opaque-v1"
    assert p.limits == {"calls": 16, "dispatches": 16, "cost_units": 16}
    assert m.http_policy()["max_redirect_hops"] == 0
    assert m.http_policy()["max_result_bytes"] == 8388608
    assert m.http_policy()["cost_units"] == 1
    assert m.http_policy()["additional_budget"] == {}


def test_resource_projection_is_real_versioned_metadata_without_literals() -> None:
    m = http_binding_module
    descriptor = m.describe_http_resource(
        node_id="http", raw=data(), workflow_revision="a" * 64, app_id="app", workflow_id="workflow"
    )
    assert descriptor["kind"] == "http"
    assert descriptor["native_class"] == "graphon.nodes.http_request.node.HttpRequestNode"
    assert descriptor["node_config_digest"] == canonical_digest(data())
    assert descriptor["graphon_version"] == "0.8.0"
    assert descriptor["httpx_version"] == "0.28.1"
    assert "SENTINEL" not in str(descriptor)
    assert descriptor["policy"]["opacity_notice"] == m.OPACITY_NOTICE


@pytest.mark.parametrize(
    "change",
    [
        {"headers": "X-Key:SENTINEL"},
        {"authorization": {"type": "api-key"}},
        {"url": "https://name:password@example.com"},
        {"url": "https://example.com/{{#x.y#}}"},
        {"params": "key:{{#env.SECRET#}}"},
        {"timeout": {"connect": 2, "read": 2, "write": 2}},
        {"body": {"type": "binary", "data": [{"type": "file", "file": ["node", "file"]}]}},
    ],
)
def test_unqualified_variants_refuse_before_native_preparation(change: dict[str, JsonValue]) -> None:
    with pytest.raises(BuilderExecutionPolicyError):
        http_binding_module.describe_http_resource(
            node_id="http", raw=data(**change), workflow_revision="a" * 64, app_id="app", workflow_id="workflow"
        )


def test_offline_native_attestation_keeps_json_types_and_refuses_tamper() -> None:
    m = http_binding_module
    expected = m.native_http_request(raw=data(), variable_pool=VariablePool())
    assert expected["json"] == {"secret": "SENTINEL", "flag": True}
    from services.dify_builder.native_testing.http_adapter import NativeHttpClient

    # Pure preparation only, with the accepted existing request owner.
    client = NativeHttpClient(
        ref=NativeTestContextRef(request_id="r", invocation_id="i", context_digest="a" * 64),
        calls=cast(NativeCallAdapter, object()),
        intents=cast(NativeHttpIntentPort, object()),
        max_redirect_hops=0,
        max_response_bytes=1048576,
    )
    request = client._prepare("POST", expected.pop("url"), expected)
    m.attest_http_request(request=request, raw=data(), variable_pool=VariablePool())
    for changed in (
        replace(request, content=b"wrong"),
        replace(request, url="https://other.example"),
        replace(request, timeout=(1, 1, 1)),
    ):
        with pytest.raises(BuilderExecutionPolicyError, match="native_http_request_mismatch"):
            m.attest_http_request(request=changed, raw=data(), variable_pool=VariablePool())


def test_concrete_producer_and_deferred_entry_exist_without_factory_activation() -> None:
    m = http_binding_module
    assert hasattr(m, "NativeHttpBindingProducer"), "actual per-occurrence producer missing"
    assert hasattr(m, "NativeHttpBindingResolver"), "current metadata resolver missing"
    assert hasattr(m, "DeferredNativeHttpClient"), "deferred actual HTTP owner missing"
    assert hasattr(m, "NativeHttpDisclosure"), "opaque disclosure owner missing"


def test_strict_file_collaborator_never_synthesizes_empty_file_outputs() -> None:
    m = http_binding_module
    files = m.RefusingNativeHttpFiles()
    for call in (lambda: files.download(object()), lambda: files.create_file_by_raw(object()), lambda: files()):
        with pytest.raises(BuilderExecutionPolicyError, match="native_http_files_unsupported"):
            call()


@pytest.fixture
def concrete_case(monkeypatch: pytest.MonkeyPatch) -> ConcreteHttpCase:
    from copy import deepcopy
    from uuid import uuid4

    from graphon.runtime import InitParams, RuntimeState
    from services.dify_builder.native_testing.control import BoundaryOwnerState, marked_native_node_class
    from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
    from services.dify_builder.native_testing.runtime_bridge import NativeNodePreparation
    from tests.unit_tests.services.dify_builder.native_testing.test_call_adapter import REF, Authorization, State

    m = http_binding_module

    class InputState(State):
        """Explicit C03 input stand-in; encrypted SQL/storage owner is covered only by CI."""

        store_node_inputs: Callable[..., str]

    events = []
    state, auth = InputState(events), Authorization(events)
    graph = {"nodes": [{"id": "http", "data": data()}]}
    descriptor = m.describe_http_resource(
        node_id="http", raw=data(), workflow_revision="a" * 64, app_id="app", workflow_id="workflow"
    )
    state.context = state.context.model_copy(
        update={"graph": graph, "graph_revision": "a" * 64, "resource_manifest": (descriptor,)}
    )

    def store_inputs(
        *, ref: NativeTestContextRef, generation: int, native_execution_id: str, inputs: dict[str, JsonValue]
    ) -> str:
        del ref, generation
        events.append(("input_ack", native_execution_id))
        input_ref = "node-input:" + native_execution_id
        old = state.values.setdefault(input_ref, deepcopy(inputs))
        if canonical_digest(old) != canonical_digest(inputs):
            raise BuilderExecutionPolicyError("native_payload_conflict")
        return input_ref

    state.store_node_inputs = store_inputs
    runtime = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
    bridge = NativeRuntimeBridge(
        state=state,
        collaborators=lambda **_kwargs: pytest.fail("producer test constructed runtime collaborators"),
        boundary_owner=BoundaryOwnerState(ref=REF),
        control_sink=SyntheticSink(),
        node_arguments=lambda **_kwargs: pytest.fail("producer test requested runtime arguments"),
    )
    association = NativeNodePreparation(
        bridge=bridge,
        ref=REF,
        node_id="http",
        node_class=marked_native_node_class(HttpRequestNode, marked=True),
        runtime_state=runtime,
    )
    node = cast(Callable[..., HttpRequestNode], association.node_class)(
        native_control_owner=bridge._boundary_owner,
        native_control_sink=bridge._control_sink,
        node_id="http",
        data=HttpRequestNodeData.model_validate(data()),
        init_params=InitParams(workflow_id="workflow", graph_config=graph, run_context={}, call_depth=0),
        runtime_state=runtime,
        http_request_config=m.native_http_config(),
        http_client=object(),
        file_manager=m.RefusingNativeHttpFiles(),
        tool_file_manager_factory=m.RefusingNativeHttpFiles(),
        file_reference_factory=m.RefusingNativeHttpFiles(),
    )
    association.attach(node)
    loader = OwnedNativeTestLoader(
        sessionmaker(), actor=Actor(tenant_id="tenant", account_id="actor"), resolver=NativeHttpBindingResolver()
    )
    owned = OwnedNativeTest(
        ref=REF,
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        session_id="session",
        test_input_id="input",
        bindings={},
        generation=0,
        task_approved=False,
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
        state="running",
    )

    def load(**_kwargs: object) -> OwnedNativeTest:
        events.append(("load",))
        return owned

    monkeypatch.setattr(loader, "load", load)
    authority = PrivateReadOwner(
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        parent_invocation_id=None,
        context_object_id="context",
        generation=0,
        graph_revision="a" * 64,
        root_revision_matches=True,
        input_revision=None,
        expires_at=owned.expires_at,
        cancelled=False,
        active=True,
        request_state="running",
    )
    monkeypatch.setattr(m, "validate_private_read", lambda *_args: authority)
    journal = NodeOperationJournal(state=state, authorization=auth)
    producer = m.NativeHttpBindingProducer(
        association=association, loader=loader, state_store=cast(NativeExecutionStateStore, state), journal=journal
    )

    def install(**_kw: object) -> None:
        events.append(("install",))
        assert any(event[0] == "input_ack" for event in events)

    monkeypatch.setattr(producer, "_install", install)
    return ConcreteHttpCase(
        owned=owned,
        producer=producer,
        state=state,
        auth=auth,
        journal=journal,
        association=association,
        node=node,
        events=events,
        uuid=str(uuid4()),
        raw=data(),
    )


def test_concrete_prebound_entry_has_zero_protected_io(concrete_case: ConcreteHttpCase) -> None:
    c = concrete_case
    from services.dify_builder.native_testing.context_binding import NativeContextUnavailable

    with pytest.raises(NativeContextUnavailable, match="native_execution_id_missing"):
        c.producer.begin()
    assert c.events == []


def test_actual_node_typed_input_ack_precedes_journal_and_install(concrete_case: ConcreteHttpCase) -> None:
    c = concrete_case
    c.node.bind_execution_id(c.uuid)
    c.producer.begin()
    from services.dify_builder.native_testing.http_adapter import NativeHttpClient

    args = http_binding_module.native_http_request(raw=c.raw, variable_pool=c.association.runtime_state.variable_pool)
    client = NativeHttpClient(
        ref=c.association.ref,
        calls=cast(NativeCallAdapter, object()),
        intents=cast(NativeHttpIntentPort, object()),
        max_redirect_hops=0,
        max_response_bytes=1048576,
    )
    prepared = client._prepare("POST", args.pop("url"), args)
    binding = c.producer.prepare(request=prepared, hop=0, previous_response=None)
    assert binding.request is prepared
    assert binding.intent.parameters == prepared.material()
    assert binding.intent.input_digest == canonical_digest(prepared.material())
    assert binding.intent.key.occurrence_path == (c.uuid,)
    assert c.journal.snapshot(ref=c.association.ref)[0].input_result_ref == "node-input:" + c.uuid
    assert c.events[-1] == ("install",)
    c.producer.begin()
    again = c.producer.prepare(request=prepared, hop=0, previous_response=None)
    assert again.intent == binding.intent


def test_actual_node_mutation_refuses_before_input_ack(concrete_case: ConcreteHttpCase) -> None:
    c = concrete_case
    c.node.bind_execution_id(c.uuid)
    c.node.node_data.url = "https://other.example/secret"
    with pytest.raises(BuilderExecutionPolicyError, match="native_http_node_drift"):
        c.producer.begin()
    assert not any(e[0] in {"input_ack", "install"} for e in c.events)


@pytest.fixture
def physical_http(concrete_case: ConcreteHttpCase, monkeypatch: pytest.MonkeyPatch) -> Generator[ConcreteHttpCase]:
    import httpx

    from core.helper import ssrf_proxy

    c = concrete_case
    c.node.bind_execution_id(c.uuid)
    sent = []
    c.reply = lambda request: httpx.Response(
        200, content=b'{"ok":true}', headers={"Content-Type": "application/json"}, request=request
    )

    def transport(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        assert c.reply is not None
        return c.reply(request)

    lower = httpx.Client(transport=httpx.MockTransport(transport))
    monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", lambda _verify: lower)
    monkeypatch.setattr(ssrf_proxy, "_inject_trace_headers", lambda headers: headers)
    # C02/C03 ports plus actual node/Executor/journal and offline MockTransport.
    c.prepared = []

    def on_prepared(*, binding: PreparedHttpBinding) -> None:
        c.prepared.append(binding)

    c.client = http_binding_module.DeferredNativeHttpClient(
        producer=c.producer,
        authorization=c.auth,
        calls_factory=NativeCallAdapter,
        on_prepared=on_prepared,
    )
    c.sent = sent
    yield c
    lower.close()


def invoke_native_executor(c: ConcreteHttpCase) -> Response:
    assert c.client is not None
    from graphon.nodes.http_request.executor import Executor

    return Executor(
        node_data=HttpRequestNodeData.model_validate(c.raw),
        timeout=http_binding_module.native_http_config().default_timeout(),
        variable_pool=c.association.runtime_state.variable_pool,
        http_request_config=http_binding_module.native_http_config(),
        max_retries=0,
        http_client=c.client,
        file_manager=http_binding_module.RefusingNativeHttpFiles(),
    ).invoke()


def test_real_deferred_native_scalar_http_complete_then_same_key_replay(physical_http: ConcreteHttpCase) -> None:
    c = physical_http
    first = invoke_native_executor(c)
    assert first.text == '{"ok":true}'
    intent = c.journal.snapshot(ref=c.association.ref)[0].intents[0]
    again = invoke_native_executor(c)
    assert again.text == first.text
    assert len(c.sent) == 1
    assert c.sent[0].content == b'{"secret":"SENTINEL","flag":true}'
    assert c.journal.snapshot(ref=c.association.ref)[0].intents[0] == intent
    assert c.auth.claimed == {0}
    assert len([e for e in c.events if e[0] == "claim"]) == 1


def test_real_deferred_native_wait_keeps_private_journal_and_zero_dispatch(physical_http: ConcreteHttpCase) -> None:
    from runtime_contracts.builder.native.contracts import ApprovalWait
    from services.dify_builder.native_testing.control import NativeApprovalWait

    c = physical_http
    c.auth.decisions[0] = ApprovalWait(pending_operation_id="pending")
    with pytest.raises(NativeApprovalWait):
        invoke_native_executor(c)
    assert c.sent == []
    journal = c.journal.snapshot(ref=c.association.ref)[0]
    assert len(journal.intents) == 1
    assert journal.result_refs == ()


def test_disclosure_only_validated_origin_typed_lengths_and_opaque_notice(concrete_case: ConcreteHttpCase) -> None:
    c = concrete_case
    c.node.bind_execution_id(c.uuid)
    c.producer.begin()
    from services.dify_builder.native_testing.http_adapter import NativeHttpClient

    args = http_binding_module.native_http_request(raw=c.raw, variable_pool=c.association.runtime_state.variable_pool)
    request = NativeHttpClient(
        ref=c.association.ref,
        calls=cast(NativeCallAdapter, object()),
        intents=cast(NativeHttpIntentPort, object()),
        max_redirect_hops=0,
        max_response_bytes=1048576,
    )._prepare("POST", args.pop("url"), args)
    intent = c.producer.prepare(request=request, hop=0, previous_response=None).intent
    target, summary = http_binding_module.http_disclosure_summary(
        intent=intent, descriptor=c.state.context.resource_manifest[0]
    )
    assert target == {"method": "POST", "origin": "https://example.com"}
    assert "SENTINEL" not in str((target, summary, http_binding_module.OPACITY_NOTICE))
    assert summary["request_digest"] == canonical_digest(request.material())
    assert summary["redacted_fields"] == ["path", "query", "body", "headers"]
    assert "internal actions are unknown" in http_binding_module.OPACITY_NOTICE


def test_current_classification_does_not_echo_stored_flags(
    concrete_case: ConcreteHttpCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = concrete_case
    from runtime_contracts.builder.native.contracts import OperationKey, operation_digest
    from services.dify_builder.native_testing.repository import NativeBinding

    key = OperationKey(invocation_id=c.association.ref.invocation_id, occurrence_path=(c.uuid,), cursor=0)
    desc = c.state.context.resource_manifest[0]
    frozen = http_binding_module._classified_binding(
        intent_digest="b" * 64, execution_id=c.uuid, descriptor=desc, manifest_digest="c" * 64
    )
    stored = frozen.model_copy(
        update={"isolated": True, "cost_units": 0, "destructive": True, "approval_scope": "batch"}
    )
    owned = replace(c.owned, ref=c.association.ref, bindings={operation_digest(key): stored.model_dump(mode="json")})
    monkeypatch.setattr(http_binding_module, "_current_metadata", lambda **_kw: (c.raw, desc, "c" * 64))
    current = http_binding_module.NativeHttpBindingResolver().resolve_binding(session=object(), owned=owned, key=key)
    assert current == frozen
    assert current != NativeBinding.model_validate(owned.bindings[operation_digest(key)])


def test_actual_wait_exports_one_call_proposal_from_scope_expiry(physical_http: ConcreteHttpCase) -> None:
    from datetime import UTC, datetime

    from runtime_contracts.builder.native.contracts import ApprovalWait
    from services.dify_builder.native_testing.control import NativeApprovalWait

    c = physical_http
    c.producer.loader.load = lambda **_kw: replace(c.owned, expires_at=datetime(2030, 1, 1, tzinfo=UTC))
    c.auth.decisions[0] = ApprovalWait(pending_operation_id="pending")
    with pytest.raises(NativeApprovalWait):
        invoke_native_executor(c)
    proposals = c.producer.approval_proposals()
    assert len(proposals) == 1
    assert proposals[0].key == c.journal.snapshot(ref=c.association.ref)[0].intents[0].key
    assert proposals[0].terms.model_dump(mode="json") == {
        "max_calls": 1,
        "max_dispatches": 1,
        "max_cost_units": 1,
        "expires_at": "2030-01-01T00:00:00+00:00",
    }


def test_current_registry_replacement_cannot_keep_pinned_http_qualification(monkeypatch: pytest.MonkeyPatch) -> None:

    monkeypatch.setattr(HttpRequestNode, "get_node_type_classes_mapping", lambda: {"http-request": {"1": object}})
    with pytest.raises(BuilderExecutionPolicyError, match="native_http_resource_unsupported"):
        http_binding_module.describe_http_resource(
            node_id="http", raw=data(), workflow_revision="a" * 64, app_id="app", workflow_id="workflow"
        )


def test_deferred_zero_redirect_cap_never_sends_second_destination(physical_http: ConcreteHttpCase) -> None:
    import httpx

    from services.dify_builder.native_testing.control import NativePolicyStop

    c = physical_http
    c.reply = lambda request: httpx.Response(
        307, headers={"Location": "https://other.example/SENTINEL"}, request=request
    )
    with pytest.raises(NativePolicyStop) as stopped:
        invoke_native_executor(c)
    assert stopped.value.reason_code == "native_http_redirect_limit"
    assert len(c.sent) == 1
    assert c.sent[0].url.host == "example.com"


def test_deferred_actual_response_cap_refuses_without_truncated_success(physical_http: ConcreteHttpCase) -> None:
    import httpx

    from services.dify_builder.native_testing.control import NativePolicyStop

    c = physical_http
    cap = http_binding_module.http_policy()["max_response_bytes"]
    c.reply = lambda request: httpx.Response(200, content=b"a" * (cap + 1), request=request)
    with pytest.raises(NativePolicyStop) as stopped:
        invoke_native_executor(c)
    assert stopped.value.reason_code == "outcome_unknown"
    assert len(c.sent) == 1
    assert c.auth.outcomes[0] == ("unknown", None)
    assert c.journal.snapshot(ref=c.association.ref)[0].result_refs == ()


@pytest.mark.parametrize(
    ("body", "content", "json_value"),
    [
        (None, None, None),
        ({"type": "none", "data": []}, "", None),
        ({"type": "raw-text", "data": [{"type": "text", "value": "SENTINEL"}]}, "SENTINEL", None),
        ({"type": "json", "data": [{"type": "text", "value": "true"}]}, None, True),
    ],
)
def test_literal_empty_text_and_scalar_json_keep_actual_native_semantics(
    body: dict[str, JsonValue], content: bytes | None, json_value: JsonValue
) -> None:
    m = http_binding_module
    from services.dify_builder.native_testing.http_adapter import NativeHttpClient

    raw = data(body=body)
    args = m.native_http_request(raw=raw, variable_pool=VariablePool())
    assert args["content"] == content
    assert args["json"] is json_value
    request = NativeHttpClient(
        ref=NativeTestContextRef(request_id="r", invocation_id="i", context_digest="a" * 64),
        calls=cast(NativeCallAdapter, object()),
        intents=cast(NativeHttpIntentPort, object()),
        max_redirect_hops=0,
        max_response_bytes=1048576,
    )._prepare("POST", args.pop("url"), args)
    m.attest_http_request(request=request, raw=raw, variable_pool=VariablePool())


def test_ignored_none_body_file_selector_is_still_outside_qualified_resource() -> None:
    with pytest.raises(BuilderExecutionPolicyError, match="native_http_resource_unsupported"):
        http_binding_module.describe_http_resource(
            node_id="http",
            raw=data(body={"type": "none", "data": [{"type": "file", "file": ["environment", "secret"]}]}),
            workflow_revision="a" * 64,
            app_id="app",
            workflow_id="workflow",
        )


def test_known_destructive_binding_retains_existing_hard_denial(concrete_case: ConcreteHttpCase) -> None:
    from services.dify_builder.native_testing.authorization import task_grant_allowed, validate_binding

    c = concrete_case
    c.node.bind_execution_id(c.uuid)
    c.producer.begin()
    from services.dify_builder.native_testing.http_adapter import NativeHttpClient

    arguments = http_binding_module.native_http_request(
        raw=c.raw, variable_pool=c.association.runtime_state.variable_pool
    )
    prepared = NativeHttpClient(
        ref=c.association.ref,
        calls=cast(NativeCallAdapter, object()),
        intents=cast(NativeHttpIntentPort, object()),
        max_redirect_hops=0,
        max_response_bytes=1048576,
    )._prepare("POST", arguments.pop("url"), arguments)
    intent = c.producer.prepare(request=prepared, hop=0, previous_response=None).intent
    binding = http_binding_module._classified_binding(
        intent_digest=canonical_digest(intent.model_dump(mode="json")),
        execution_id=c.uuid,
        descriptor=c.state.context.resource_manifest[0],
        manifest_digest=intent.capability_digest,
    )
    assert task_grant_allowed(binding, task_approved=True) is False
    prohibited = binding.model_copy(update={"destructive": True})
    with pytest.raises(BuilderExecutionPolicyError, match="destructive_effect_forbidden"):
        validate_binding(intent, prohibited)


def test_identical_graph_revision_in_another_workflow_is_a_different_qualification() -> None:
    m = http_binding_module
    first = m.describe_http_resource(
        node_id="http", raw=data(), workflow_revision="a" * 64, app_id="app", workflow_id="workflow"
    )
    child = m.describe_http_resource(
        node_id="http", raw=data(), workflow_revision="a" * 64, app_id="child-app", workflow_id="child-workflow"
    )
    assert first["workflow_id"] == "workflow"
    assert first["app_id"] == "app"
    assert canonical_digest(first) != canonical_digest(child)


def test_qualified_http_manifest_selects_operation_consent_and_rejects_legacy_projection(
    concrete_case: ConcreteHttpCase,
) -> None:
    from copy import deepcopy

    c = concrete_case
    descriptor = c.state.context.resource_manifest[0]
    policy = descriptor["policy"]
    assert isinstance(policy, dict)
    assert policy.get("approval_scope") == "operation"
    old_descriptor = deepcopy(descriptor)
    old_policy = old_descriptor["policy"]
    assert isinstance(old_policy, dict)
    old_policy.pop("approval_scope", None)
    assert canonical_digest(old_descriptor) != canonical_digest(descriptor)
    c.state.context = c.state.context.model_copy(update={"resource_manifest": (old_descriptor,)})
    c.node.bind_execution_id(c.uuid)
    with pytest.raises(BuilderExecutionPolicyError, match="native_http_manifest_unavailable"):
        c.producer.begin()


def test_identical_request_native_occurrences_have_independent_http_confirmation_scopes(
    concrete_case: ConcreteHttpCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from uuid import uuid4

    from graphon.runtime import InitParams, RuntimeState
    from services.dify_builder.native_testing.authorization import _scope_digest
    from services.dify_builder.native_testing.runtime_bridge import NativeNodePreparation

    c = concrete_case
    c.node.bind_execution_id(c.uuid)

    def intent_for(producer: NativeHttpBindingProducer) -> EffectIntent:
        producer.begin()
        arguments = http_binding_module.native_http_request(
            raw=c.raw, variable_pool=producer.association.runtime_state.variable_pool
        )
        from services.dify_builder.native_testing.http_adapter import NativeHttpClient

        request = NativeHttpClient(
            ref=c.association.ref,
            calls=cast(NativeCallAdapter, object()),
            intents=cast(NativeHttpIntentPort, object()),
            max_redirect_hops=0,
            max_response_bytes=1048576,
        )._prepare("POST", arguments.pop("url"), arguments)
        return producer.prepare(request=request, hop=0, previous_response=None).intent

    first = intent_for(c.producer)
    bridge = c.association._bridge
    runtime = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
    second = NativeNodePreparation(
        bridge=bridge, ref=c.association.ref, node_id="http", node_class=c.association.node_class, runtime_state=runtime
    )
    node = cast(Callable[..., HttpRequestNode], second.node_class)(
        native_control_owner=bridge._boundary_owner,
        native_control_sink=bridge._control_sink,
        node_id="http",
        data=HttpRequestNodeData.model_validate(c.raw),
        init_params=InitParams(
            workflow_id="workflow", graph_config=c.state.context.graph, run_context={}, call_depth=0
        ),
        runtime_state=runtime,
        http_request_config=http_binding_module.native_http_config(),
        http_client=object(),
        file_manager=http_binding_module.RefusingNativeHttpFiles(),
        tool_file_manager_factory=http_binding_module.RefusingNativeHttpFiles(),
        file_reference_factory=http_binding_module.RefusingNativeHttpFiles(),
    )
    second.attach(node)
    node.bind_execution_id(str(uuid4()))
    producer = http_binding_module.NativeHttpBindingProducer(
        association=second,
        loader=c.producer.loader,
        state_store=cast(NativeExecutionStateStore, c.state),
        journal=c.journal,
    )
    monkeypatch.setattr(producer, "_install", c.producer._install)
    repeated = intent_for(producer)
    assert first.parameters == repeated.parameters
    assert first.input_digest == repeated.input_digest
    assert first.key != repeated.key
    classified = [
        http_binding_module._classified_binding(
            intent_digest=canonical_digest(effect.model_dump(mode="json")),
            execution_id=effect.key.occurrence_path[0],
            descriptor=c.state.context.resource_manifest[0],
            manifest_digest=effect.capability_digest,
        )
        for effect in (first, repeated)
    ]
    assert _scope_digest(first, classified[0]) != _scope_digest(repeated, classified[1])
    assert classified[0].approval_scope == classified[1].approval_scope == "operation"


def test_host_seams_use_exact_factory_owners_and_actual_prepared_binding(
    physical_http: ConcreteHttpCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = physical_http
    created: list[dict[str, object]] = []
    produced: list[PreparedHttpBinding] = []
    observed: list[PreparedHttpBinding] = []
    called: list[tuple[NativeTestContextRef, EffectIntent]] = []
    prepare = c.producer.prepare

    def actual_prepare(
        *, request: PreparedHttpRequest, hop: int, previous_response: HttpResponse | None
    ) -> PreparedHttpBinding:
        binding = prepare(request=request, hop=hop, previous_response=previous_response)
        produced.append(binding)
        return binding

    monkeypatch.setattr(c.producer, "prepare", actual_prepare)

    @dataclass
    class Calls:
        adapter: NativeCallAdapter

        def call(
            self, *, ref: NativeTestContextRef, intent: EffectIntent, dispatch: Callable[[DispatchPermit], JsonValue]
        ) -> JsonValue:
            assert observed == [produced[0]]
            assert not any(e[0] in {"authorize", "claim"} for e in c.events)
            called.append((ref, intent))
            return self.adapter.call(ref=ref, intent=intent, dispatch=dispatch)

    def factory(
        *,
        state: NativeStatePort,
        authorization: ScalarAuthorizationPort,
        journal: NodeOperationJournal,
        max_result_bytes: int,
    ) -> Calls:
        created.append(
            {"state": state, "authorization": authorization, "journal": journal, "max_result_bytes": max_result_bytes}
        )
        return Calls(
            NativeCallAdapter(
                state=state, authorization=authorization, journal=journal, max_result_bytes=max_result_bytes
            )
        )

    def observe(*, binding: PreparedHttpBinding) -> None:
        assert binding is produced[0]
        assert not any(e[0] in {"authorize", "claim"} for e in c.events)
        assert c.sent == []
        observed.append(binding)

    c.client = http_binding_module.DeferredNativeHttpClient(
        producer=c.producer, authorization=c.auth, calls_factory=factory, on_prepared=observe
    )
    assert invoke_native_executor(c).text == '{"ok":true}'
    assert len(created) == len(produced) == len(observed) == len(called) == len(c.sent) == 1
    assert set(created[0]) == {"state", "authorization", "journal", "max_result_bytes"}
    assert created[0]["state"] is c.state
    assert created[0]["authorization"] is c.auth
    assert created[0]["journal"] is c.journal
    assert created[0]["max_result_bytes"] == 8388608
    assert called[0][0] == c.association.ref
    assert called[0][1] == observed[0].intent
    assert observed[0].request.content == c.sent[0].content
    assert observed[0].request.timeout == tuple(observed[0].request.arguments()["timeout"])
    assert all(value > 0 for value in observed[0].request.timeout)


@pytest.mark.parametrize("ack", [False, True, 0, "accepted", object()], ids=["false", "true", "zero", "text", "object"])
def test_host_seams_prepared_observer_requires_actual_none(physical_http: ConcreteHttpCase, ack: object) -> None:
    from services.dify_builder.native_testing.control import NativePolicyStop

    c = physical_http
    seen = []

    def observe(*, binding: PreparedHttpBinding) -> object:
        seen.append(binding)
        return ack

    c.client = http_binding_module.DeferredNativeHttpClient(
        producer=c.producer,
        authorization=c.auth,
        calls_factory=NativeCallAdapter,
        on_prepared=cast(NativeHttpPreparedObserver, observe),
    )
    with pytest.raises(NativePolicyStop) as stopped:
        invoke_native_executor(c)
    assert stopped.value.reason_code == "native_http_attestation_invalid"
    assert len(seen) == 1
    assert not any(e[0] in {"authorize", "claim"} for e in c.events)
    assert c.sent == []


def test_host_seams_observer_exception_refuses_before_scalar_authority(physical_http: ConcreteHttpCase) -> None:
    from services.dify_builder.native_testing.control import NativePolicyStop

    c = physical_http

    def observe(*, binding: PreparedHttpBinding) -> None:
        assert type(binding) is http_binding_module.PreparedHttpBinding
        raise RuntimeError("SENTINEL")

    c.client = http_binding_module.DeferredNativeHttpClient(
        producer=c.producer, authorization=c.auth, calls_factory=NativeCallAdapter, on_prepared=observe
    )
    with pytest.raises(NativePolicyStop) as stopped:
        invoke_native_executor(c)
    assert stopped.value.reason_code == "native_http_attestation_invalid"
    assert "SENTINEL" not in str(stopped.value)
    assert not any(e[0] in {"authorize", "claim"} for e in c.events)
    assert c.sent == []


@pytest.mark.parametrize("malformed", [None, object(), NonCallableHttpCalls()], ids=["none", "object", "no-call"])
def test_host_seams_invalid_factory_owner_has_no_fallback(physical_http: ConcreteHttpCase, malformed: object) -> None:
    from services.dify_builder.native_testing.control import NativePolicyStop

    c = physical_http
    c.client = http_binding_module.DeferredNativeHttpClient(
        producer=c.producer,
        authorization=c.auth,
        calls_factory=lambda **_kwargs: cast(ScalarCallPort, malformed),
        on_prepared=lambda **_kwargs: pytest.fail("invalid calls reached preparation"),
    )
    with pytest.raises(NativePolicyStop) as stopped:
        invoke_native_executor(c)
    assert stopped.value.reason_code == "native_http_calls_unavailable"
    assert not any(e[0] in {"input_ack", "authorize", "claim"} for e in c.events)
    assert c.sent == []


def test_host_seams_factory_exception_has_no_fallback(physical_http: ConcreteHttpCase) -> None:
    from services.dify_builder.native_testing.control import NativePolicyStop

    c = physical_http

    def factory(**_kwargs: object) -> NoReturn:
        raise RuntimeError("SENTINEL")

    c.client = http_binding_module.DeferredNativeHttpClient(
        producer=c.producer, authorization=c.auth, calls_factory=factory, on_prepared=lambda **_kwargs: None
    )
    with pytest.raises(NativePolicyStop) as stopped:
        invoke_native_executor(c)
    assert stopped.value.reason_code == "native_http_calls_unavailable"
    assert "SENTINEL" not in str(stopped.value)
    assert not any(e[0] in {"input_ack", "authorize", "claim"} for e in c.events)
    assert c.sent == []


@pytest.mark.parametrize("boundary", ["factory", "observer"])
@pytest.mark.parametrize("category", ["wait", "stop"])
def test_host_seams_preserve_typed_controls(physical_http: ConcreteHttpCase, boundary: str, category: str) -> None:
    from services.dify_builder.native_testing.control import NativeApprovalWait, NativePolicyStop

    c = physical_http
    control = (
        NativeApprovalWait(ref=c.association.ref, pending_operation_id="pending", wait_reason="approval")
        if category == "wait"
        else NativePolicyStop(ref=c.association.ref, reason_code="native_generation_conflict")
    )

    def refuse(**_kwargs: object) -> NoReturn:
        raise control

    c.client = http_binding_module.DeferredNativeHttpClient(
        producer=c.producer,
        authorization=c.auth,
        calls_factory=refuse if boundary == "factory" else NativeCallAdapter,
        on_prepared=refuse if boundary == "observer" else lambda **_kwargs: None,
    )
    with pytest.raises(type(control)) as stopped:
        invoke_native_executor(c)
    assert stopped.value is control
    assert not any(e[0] in {"authorize", "claim"} for e in c.events)
    assert c.sent == []


def test_host_seams_observer_refusal_blocks_actual_preparation_before_authority(
    concrete_case: ConcreteHttpCase,
) -> None:
    from services.dify_builder.native_testing.control import NativePolicyStop

    c = concrete_case
    c.node.bind_execution_id(c.uuid)
    observed = []

    def observe(*, binding: PreparedHttpBinding) -> None:
        observed.append(binding)
        raise RuntimeError("SENTINEL")

    c.client = http_binding_module.DeferredNativeHttpClient(
        producer=c.producer, authorization=c.auth, calls_factory=NativeCallAdapter, on_prepared=observe
    )
    with pytest.raises(NativePolicyStop) as stopped:
        invoke_native_executor(c)
    assert stopped.value.reason_code == "native_http_attestation_invalid"
    assert len(observed) == 1
    assert not any(e[0] in {"authorize", "claim"} for e in c.events)


@pytest.mark.parametrize("kind", ["root", "loop", "iteration"])
def test_official_container_id_normalization_preserves_http_snapshot_binding(
    concrete_case: ConcreteHttpCase, kind: str
) -> None:
    c = concrete_case
    c.node.bind_execution_id(c.uuid)
    raw = data(**({kind + "_id": "container"} if kind != "root" else {}))
    graph = {"nodes": [{"id": "http", "data": raw}]}
    if kind != "root":
        graph["nodes"].append({"id": "container", "data": {"type": kind}})
    descriptor = http_binding_module.describe_http_resource(
        node_id="http", raw=raw, workflow_revision="a" * 64, app_id="app", workflow_id="workflow"
    )
    context = c.state.context.model_copy(update={"graph": graph, "resource_manifest": (descriptor,)})
    # The real Graphon 0.8 Graph normalizer adds this canonical topology field.
    c.node._node_data = HttpRequestNodeData.model_validate(
        {**raw, "container_id": "" if kind == "root" else "container"}
    )
    assert c.producer._node_snapshot(context) == (raw, descriptor)


@pytest.mark.parametrize("kind", ["root", "loop", "iteration"])
def test_forged_runtime_container_id_is_http_node_drift(concrete_case: ConcreteHttpCase, kind: str) -> None:
    c = concrete_case
    c.node.bind_execution_id(c.uuid)
    raw = data(**({kind + "_id": "container"} if kind != "root" else {}))
    graph = {"nodes": [{"id": "http", "data": raw}]}
    if kind != "root":
        graph["nodes"].append({"id": "container", "data": {"type": kind}})
    context = c.state.context.model_copy(update={"graph": graph})
    c.node._node_data = HttpRequestNodeData.model_validate({**raw, "container_id": "foreign"})
    with pytest.raises(BuilderExecutionPolicyError, match="native_http_node_drift"):
        c.producer._node_snapshot(context)
    assert not any(e[0] in {"input_ack", "install"} for e in c.events)
