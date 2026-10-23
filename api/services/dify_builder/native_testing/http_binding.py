"""Opt-in concrete HTTP metadata, binding and disclosure for one opaque literal call.

The qualification is server policy, never an assertion of remote read-only behavior.
Exact request data lives only in existing encrypted input/journal owners. Native
Graphon request trace persistence still requires a separate privacy adaptation;
this module does not activate launch or change operational node outputs.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from importlib.metadata import version
from typing import TYPE_CHECKING, Any, Literal, NoReturn, Protocol

import httpx
from sqlalchemy import select

from configs import dify_config
from core.dify_builder.models import Actor
from graphon.graph.scoping import resolve_container_id
from graphon.nodes.http_request import HttpRequestNode, build_http_request_config
from graphon.nodes.http_request.entities import HttpRequestNodeData
from graphon.nodes.http_request.executor import Executor
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeEffectOperation,
    NativeInvocationState,
    NativePendingAction,
    NativeTestInvocation,
)
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest, canonical_json
from runtime_contracts.builder.native.approval_contracts import NativeApprovalProposal, NativeApprovalTerms
from runtime_contracts.builder.native.contracts import (
    EffectIntent,
    OperationKey,
    operation_digest,
)
from runtime_contracts.builder.native.runtime_contracts import NativeStatePort, ResolvedNativeTestContext
from services.dify_builder.execution_policy_service import check_execution_permission
from services.dify_builder.native_testing.call_adapter import ScalarAuthorizationPort
from services.dify_builder.native_testing.context_binding import NativeRuntimeProfile
from services.dify_builder.native_testing.http_adapter import (
    NativeHttpClient,
    PreparedHttpBinding,
    PreparedHttpRequest,
    ScalarCallPort,
)
from services.dify_builder.native_testing.operation_journal import NodeOperationJournal, OperationCursor
from services.dify_builder.native_testing.private_reads import (
    PrivateReadOwner,
    validate_invocation_workflow,
    validate_private_read,
)
from services.dify_builder.native_testing.public_contracts import PendingActionDisclosure
from services.dify_builder.native_testing.repository import NativeBinding, OwnedNativeTest, native_workflow_revision
from services.dify_builder.native_testing.transitions import require_ancestor_authority

if TYPE_CHECKING:
    from graphon.http import HttpResponse
    from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
    from services.dify_builder.native_testing.runtime_bridge import NativeNodePreparation
    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

PROFILE_ID = "builder-native-http-opaque-v1"
OPACITY_NOTICE = (
    "The remote service's internal actions are unknown. This approval covers one HTTP request with the bound input; "
    "it does not establish that the operation is read-only. Path, query, body and header values are redacted. "
    "One cost unit means one server operation accounting unit, not currency or endpoint fees."
)
_VERSIONS = {"graphon_version": version("graphon"), "httpx_version": version("httpx")}


def build_native_http_profile() -> NativeRuntimeProfile:
    return NativeRuntimeProfile(
        profile_id=PROFILE_ID,
        implementation_revision=PROFILE_ID,
        limits={"calls": 16, "dispatches": 16, "cost_units": 16},
    )


def validate_native_http_profile(profile: NativeRuntimeProfile) -> None:
    if profile != build_native_http_profile():
        raise BuilderExecutionPolicyError("native_http_profile_drift")


def native_http_config():
    """Same actual configuration owner as the ordinary native factory, no constructor defaults."""
    return build_http_request_config(
        max_connect_timeout=dify_config.HTTP_REQUEST_MAX_CONNECT_TIMEOUT,
        max_read_timeout=dify_config.HTTP_REQUEST_MAX_READ_TIMEOUT,
        max_write_timeout=dify_config.HTTP_REQUEST_MAX_WRITE_TIMEOUT,
        max_binary_size=dify_config.HTTP_REQUEST_NODE_MAX_BINARY_SIZE,
        max_text_size=dify_config.HTTP_REQUEST_NODE_MAX_TEXT_SIZE,
        ssl_verify=dify_config.HTTP_REQUEST_NODE_SSL_VERIFY,
        ssrf_default_max_retries=dify_config.SSRF_DEFAULT_MAX_RETRIES,
    )


def http_policy() -> dict:
    config = native_http_config()
    return {
        "isolated": False,
        "egress": True,
        "new_data": True,
        "destructive": False,
        "approval_scope": "operation",
        "destructive_meaning": "not identified as known prohibited destructive; remote internals opaque",
        "cost_units": 1,
        "accounting": "one server operation accounting unit per physical attempt; not currency",
        "additional_budget": {},
        "max_calls": 1,
        "max_dispatches": 1,
        "max_cost_units": 1,
        "max_redirect_hops": 0,
        "native_ssrf_retries": 0,
        "max_response_bytes": min(config.max_text_size, 1048576),
        "max_result_bytes": 8388608,
        "opacity_notice": OPACITY_NOTICE,
    }


def _supported(raw: dict) -> HttpRequestNodeData:
    """Reject secret/file/template selectors before invoking any native preparation."""
    try:
        if (
            raw.get("type") != "http-request"
            or raw.get("version", "1") != "1"
            or raw.get("authorization") != {"type": "no-auth"}
            or raw.get("headers") != ""
            or raw.get("timeout") is not None
            or "{{" in json.dumps(raw, ensure_ascii=False)
        ):
            raise ValueError
        node = HttpRequestNodeData.model_validate(raw, strict=True)
        if node.method.lower() not in {"get", "post", "put", "patch", "delete", "head"}:
            raise ValueError
        parsed = httpx.URL(node.url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.host
            or parsed.username
            or parsed.password
            or parsed.fragment
            or node.ssl_verify not in (None, native_http_config().ssl_verify)
        ):
            raise ValueError
        if node.body is not None:
            if node.body.type not in {"none", "raw-text", "json"}:
                raise ValueError
            if node.body.type == "none" and node.body.data:
                raise ValueError
            if node.body.type != "none" and (
                len(node.body.data) != 1 or any(item.type != "text" or item.file for item in node.body.data)
            ):
                raise ValueError
        if HttpRequestNode.get_node_type_classes_mapping().get("http-request", {}).get("1") is not HttpRequestNode:
            raise ValueError
        if _VERSIONS != {"graphon_version": "0.8.0", "httpx_version": "0.28.1"}:
            raise ValueError
        return node
    except Exception:
        raise BuilderExecutionPolicyError("native_http_resource_unsupported") from None


def _config_projection() -> dict:
    # Proxy strings may contain credentials. Qualify their exact value by digest;
    # never place a raw proxy URL in the manifest or a public notice.
    settings = {
        "SSRF_PROXY_ALL_URL": dify_config.SSRF_PROXY_ALL_URL,
        "SSRF_PROXY_HTTP_URL": dify_config.SSRF_PROXY_HTTP_URL,
        "SSRF_PROXY_HTTPS_URL": dify_config.SSRF_PROXY_HTTPS_URL,
        "SSRF_DEFAULT_TIME_OUT": dify_config.SSRF_DEFAULT_TIME_OUT,
        "SSRF_DEFAULT_CONNECT_TIME_OUT": dify_config.SSRF_DEFAULT_CONNECT_TIME_OUT,
        "SSRF_DEFAULT_READ_TIME_OUT": dify_config.SSRF_DEFAULT_READ_TIME_OUT,
        "SSRF_DEFAULT_WRITE_TIME_OUT": dify_config.SSRF_DEFAULT_WRITE_TIME_OUT,
        "SSRF_POOL_MAX_CONNECTIONS": dify_config.SSRF_POOL_MAX_CONNECTIONS,
        "SSRF_POOL_MAX_KEEPALIVE_CONNECTIONS": dify_config.SSRF_POOL_MAX_KEEPALIVE_CONNECTIONS,
        "SSRF_POOL_KEEPALIVE_EXPIRY": dify_config.SSRF_POOL_KEEPALIVE_EXPIRY,
    }
    return {
        "native": asdict(native_http_config()),
        "ssrf_settings_digest": canonical_digest(settings),
    }


def describe_http_resource(*, node_id: str, raw: dict, workflow_revision: str, app_id: str, workflow_id: str) -> dict:
    _supported(raw)
    if not node_id or not app_id or not workflow_id or len(workflow_revision) != 64:
        raise BuilderExecutionPolicyError("native_http_resource_unsupported")
    return {
        "kind": "http",
        "app_id": app_id,
        "workflow_id": workflow_id,
        "node_id": node_id,
        "native_class": "graphon.nodes.http_request.node.HttpRequestNode",
        "native_type": "http-request",
        "native_version": HttpRequestNode.version(),
        "node_config_digest": canonical_digest(raw),
        "workflow_revision": workflow_revision,
        "implementation_revision": PROFILE_ID,
        **_VERSIONS,
        "policy": http_policy(),
        "http_config": _config_projection(),
    }


def _node(graph: dict, node_id: str) -> dict:
    matches = [node["data"] for node in graph.get("nodes", []) if node.get("id") == node_id]
    if len(matches) != 1:
        raise BuilderExecutionPolicyError("native_http_resource_unsupported")
    return matches[0]


class NativeHttpResourceSnapshot:
    """Compiler HTTP metadata from the actual tenant-owned invocation Workflow.

    An empty tuple means the graph declares no HTTP resources. Native node
    capability checks remain the delivery bridge's responsibility.
    """

    def __init__(self, *, session_factory):
        self._sessions = session_factory

    def __call__(
        self, *, actor: Actor, app_id: str, workflow_id: str, graph: dict, profile: NativeRuntimeProfile
    ) -> tuple[dict, ...]:
        validate_native_http_profile(profile)
        check_execution_permission(actor, app_id, self._sessions)
        with self._sessions() as session:
            workflow = validate_invocation_workflow(
                session, tenant_id=actor.tenant_id, app_id=app_id, workflow_id=workflow_id
            )
            if json.loads(workflow.graph) != graph:
                raise BuilderExecutionPolicyError("native_revision_drift")
            revision = native_workflow_revision(workflow)
            entries = tuple(
                describe_http_resource(
                    node_id=node["id"],
                    raw=node["data"],
                    workflow_revision=revision,
                    app_id=workflow.app_id,
                    workflow_id=workflow.id,
                )
                for node in graph.get("nodes", [])
                if node.get("data", {}).get("type") == "http-request"
            )
        if len({entry["node_id"] for entry in entries}) != len(entries):
            raise BuilderExecutionPolicyError("native_http_manifest_unavailable")
        return entries


class RefusingNativeHttpFiles:
    """Explicit no-IO collaborators. A real file response refuses instead of returning empty files."""

    def download(self, *_args, **_kwargs):
        raise BuilderExecutionPolicyError("native_http_files_unsupported")

    def create_file_by_raw(self, *_args, **_kwargs):
        raise BuilderExecutionPolicyError("native_http_files_unsupported")

    def __call__(self, *_args, **_kwargs):
        raise BuilderExecutionPolicyError("native_http_files_unsupported")


class _OfflineHttpClient:
    """Executor construction may never dispatch, even after a dependency upgrade."""

    request_error = RuntimeError
    max_retries_exceeded_error = RuntimeError

    def get(self, *_args, **_kwargs) -> NoReturn:
        raise BuilderExecutionPolicyError("native_http_offline_io_forbidden")

    head = post = put = delete = patch = get


def native_http_request(*, raw: dict, variable_pool: Any) -> dict:
    node = _supported(raw)
    config = native_http_config()
    try:
        executor = Executor(
            node_data=node,
            timeout=config.default_timeout(),
            variable_pool=variable_pool,
            http_request_config=config,
            max_retries=0,
            ssl_verify=node.ssl_verify,
            http_client=_OfflineHttpClient(),
            file_manager=RefusingNativeHttpFiles(),
        )
        return {
            "url": executor.url,
            "headers": {**executor.build_headers(), "Cookie": ""},
            "params": executor.params,
            "data": executor.data,
            "files": executor.files,
            "json": executor.json,
            "content": executor.content,
            "timeout": (executor.timeout.connect, executor.timeout.read, executor.timeout.write),
            "ssl_verify": executor.ssl_verify,
            "follow_redirects": True,
        }
    except Exception:
        raise BuilderExecutionPolicyError("native_http_resource_unsupported") from None


def attest_http_request(*, request: PreparedHttpRequest, raw: dict, variable_pool: Any) -> None:
    expected = native_http_request(raw=raw, variable_pool=variable_pool)
    try:
        if (
            type(request) is not PreparedHttpRequest
            or request.method != raw["method"].upper()
            or canonical_digest(request.arguments()) != canonical_digest(expected)
            or request.timeout != tuple(expected["timeout"])
            or request.ssl_verify is not expected["ssl_verify"]
            or request.follow_redirects is not True
        ):
            raise ValueError
        wire = httpx.Request(
            request.method,
            expected["url"],
            **{k: expected[k] for k in ("headers", "params", "data", "files", "json", "content")},
        )
        if (request.url, request.headers, request.content) != (str(wire.url), tuple(wire.headers.raw), wire.read()):
            raise ValueError
    except Exception:
        raise BuilderExecutionPolicyError("native_http_request_mismatch") from None


def _current_metadata(*, session, owned: OwnedNativeTest, node_id: str) -> tuple[dict, dict, str]:
    """Local SQL/config projection only, safe inside C02's existing root lock.

    The first compiler qualifies HTTP entries in its actual admitted root graph.
    A child must have its own matching admitted descriptor; no root descriptor is
    silently reinterpreted as child authority. Broader compiler composition is gated.
    """
    state = session.scalar(
        select(NativeInvocationState).where(
            NativeInvocationState.tenant_id == owned.tenant_id,
            NativeInvocationState.request_id == owned.ref.request_id,
            NativeInvocationState.invocation_id == owned.ref.invocation_id,
        )
    )
    if state is None or not state.app_id or not state.workflow_id:
        raise BuilderExecutionPolicyError("native_owner_mismatch")
    require_ancestor_authority(session, owned.ref, owned.tenant_id)
    workflow = validate_invocation_workflow(
        session, tenant_id=owned.tenant_id, app_id=state.app_id, workflow_id=state.workflow_id
    )
    request = session.get(DifyBuilderExecutionRequest, owned.ref.request_id)
    if request is None:
        raise BuilderExecutionPolicyError("native_owner_mismatch")
    validate_native_http_profile(NativeRuntimeProfile.model_validate(request.context.get("profile")))
    graph, revision = json.loads(workflow.graph), native_workflow_revision(workflow)
    entries = [
        describe_http_resource(
            node_id=node["id"],
            raw=node["data"],
            workflow_revision=revision,
            app_id=workflow.app_id,
            workflow_id=workflow.id,
        )
        for node in graph.get("nodes", [])
        if node.get("data", {}).get("type") == "http-request"
    ]
    if not entries or len({entry["node_id"] for entry in entries}) != len(entries):
        raise BuilderExecutionPolicyError("native_http_manifest_unavailable")
    manifest_digest = canonical_digest(entries)
    if manifest_digest != request.context.get("resource_manifest_digest"):
        reason = (
            "native_http_child_qualification_unavailable"
            if state.parent_invocation_id
            else "native_http_manifest_drift"
        )
        raise BuilderExecutionPolicyError(reason)
    raw = _node(graph, node_id)
    descriptor = describe_http_resource(
        node_id=node_id, raw=raw, workflow_revision=revision, app_id=workflow.app_id, workflow_id=workflow.id
    )
    if descriptor not in entries:
        raise BuilderExecutionPolicyError("native_http_manifest_unavailable")
    return raw, descriptor, manifest_digest


def _classified_binding(
    *, intent_digest: str, execution_id: str, descriptor: dict, manifest_digest: str
) -> NativeBinding:
    policy = descriptor["policy"]
    # False means no known prohibited destructive operation was identified under
    # this opaque policy. It is never an assertion of safety or read-only semantics.
    return NativeBinding(
        intent_digest=intent_digest,
        kind="http",
        resource_ref=descriptor["node_id"],
        implementation_revision=descriptor["implementation_revision"],
        account_ref=None,
        capability_digest=manifest_digest,
        resource_version=descriptor["workflow_revision"],
        credential_version=None,
        isolated=policy["isolated"],
        egress=policy["egress"],
        new_data=policy["new_data"],
        destructive=policy["destructive"],
        approval_scope=policy["approval_scope"],
        cost_units=policy["cost_units"],
        budget=policy["additional_budget"],
        execution_id=execution_id,
        invocation_digest=intent_digest,
    )


class NativeHttpBindingResolver:
    """Reclassify actual current SQL graph/config; stored correlation grants no flags."""

    def resolve_binding(self, *, session, owned: OwnedNativeTest, key: OperationKey) -> NativeBinding:
        if key.invocation_id != owned.ref.invocation_id:
            raise BuilderExecutionPolicyError("native_binding_mismatch")
        frozen = NativeBinding.model_validate(owned.bindings.get(operation_digest(key)))
        if frozen.kind != "http" or key.occurrence_path != (frozen.execution_id,):
            raise BuilderExecutionPolicyError("native_binding_mismatch")
        _, descriptor, digest = _current_metadata(session=session, owned=owned, node_id=frozen.resource_ref)
        return _classified_binding(
            intent_digest=frozen.intent_digest,
            execution_id=frozen.execution_id,
            descriptor=descriptor,
            manifest_digest=digest,
        )

    def resolve_pending(self, *, session, owned, category: Literal["configuration", "interaction"], reference: str):
        raise BuilderExecutionPolicyError("native_pending_requires_resolution")


class NativeHttpBindingProducer:
    """Per-native-occurrence producer; no client binding/classification arguments.

    begin/finish bracket a complete existing NativeHttpClient call. A wait or stop
    preserves the real open journal, and retry reopens that occurrence at zero.
    """

    def __init__(
        self,
        *,
        association: NativeNodePreparation,
        loader: OwnedNativeTestLoader,
        state_store: NativeExecutionStateStore,
        journal: NodeOperationJournal,
    ):
        self.association, self.loader, self.store, self.journal = association, loader, state_store, journal
        self._context: ResolvedNativeTestContext | None = None
        self._authority: PrivateReadOwner | None = None
        self._cursor: OperationCursor | None = None

    def _node_snapshot(self, context: ResolvedNativeTestContext):
        from services.dify_builder.native_testing.control import marked_native_node_class

        node = self.association.bound_node
        if type(node) is not marked_native_node_class(HttpRequestNode, marked=True):
            raise BuilderExecutionPolicyError("native_http_node_unsupported")
        raw = _node(context.graph, self.association.node_id)
        expected = _supported(raw)
        raw_nodes = context.graph.get("nodes")
        if not isinstance(raw_nodes, list):
            raise BuilderExecutionPolicyError("native_http_node_drift")
        nodes_by_id: dict[str, dict] = {}
        for item in raw_nodes:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                raise BuilderExecutionPolicyError("native_http_node_drift")
            nodes_by_id[item["id"]] = item
        owned_config = nodes_by_id[self.association.node_id]

        def normalized(data: dict) -> dict:
            # Graphon 0.8 adds its canonical direct owner while materializing
            # nodes. Apply that same official rule to both snapshots, using
            # trusted persisted topology for legacy/nested container links.
            # Every other runtime field/extra remains in the strict comparison.
            try:
                container_id = resolve_container_id({**owned_config, "data": data}, nodes_by_id=nodes_by_id)
            except (TypeError, ValueError):
                raise BuilderExecutionPolicyError("native_http_node_drift") from None
            return {**data, "container_id": container_id}

        if canonical_digest(normalized(node.node_data.model_dump(mode="json"))) != canonical_digest(
            normalized(expected.model_dump(mode="json"))
        ):
            raise BuilderExecutionPolicyError("native_http_node_drift")
        descriptor = describe_http_resource(
            node_id=self.association.node_id,
            raw=raw,
            workflow_revision=context.graph_revision,
            app_id=context.app_id,
            workflow_id=context.workflow_id,
        )
        if not context.resource_manifest or context.resource_manifest.count(descriptor) != 1:
            reason = (
                "native_http_child_qualification_unavailable"
                if context.parent_invocation_id
                else "native_http_manifest_unavailable"
            )
            raise BuilderExecutionPolicyError(reason)
        return raw, descriptor

    def begin(self) -> None:
        # resolve checks attachment and the public canonical UUID before private IO.
        context = self.association.resolve()
        self._context = self._authority = self._cursor = None
        self._node_snapshot(context)
        self.loader.load(ref=context.ref)
        authority = validate_private_read(self.loader, context.ref)
        if authority.generation != context.generation:
            raise BuilderExecutionPolicyError("native_generation_conflict")
        self._context, self._authority = context, authority

    def prepare(self, *, request: PreparedHttpRequest, hop: int, previous_response) -> PreparedHttpBinding:
        context, authority = self._context, self._authority
        if context is None or authority is None or type(hop) is not int or hop != 0 or previous_response is not None:
            raise BuilderExecutionPolicyError("native_http_delivery_unavailable")
        current = self.association.resolve()
        if current != context:
            raise BuilderExecutionPolicyError("native_generation_conflict")
        raw, descriptor = self._node_snapshot(current)
        attest_http_request(request=request, raw=raw, variable_pool=self.association.runtime_state.variable_pool)
        material = request.material()
        input_ref = self.store.store_node_inputs(
            ref=context.ref,
            generation=context.generation,
            native_execution_id=self.association.execution_id,
            inputs=material,
        )
        # A successful C03 return is not a substitute for exact typed readback.
        if canonical_digest(self.store.load_result(ref=context.ref, result_ref=input_ref)) != canonical_digest(
            material
        ):
            raise BuilderExecutionPolicyError("native_journal_input_mismatch")
        if self._cursor is not None:
            raise BuilderExecutionPolicyError("native_http_delivery_conflict")
        cursor = self.journal.open(ref=context.ref, occurrence_path=self.association.occurrence_path)
        cursor.bind_input(input_result_ref=input_ref, inputs=material)
        self._cursor = cursor
        intent = EffectIntent(
            key=cursor.next_key(),
            kind="http",
            resource_ref=self.association.node_id,
            implementation_revision=PROFILE_ID,
            account_ref=None,
            target=request.url,
            parameters=material,
            input_digest=canonical_digest(material),
            capability_digest=canonical_digest(list(context.resource_manifest)),
        )
        # Current full private/RBAC reads and encrypted payload access precede lock.
        self.loader.load(ref=context.ref)
        fresh_authority = validate_private_read(self.loader, context.ref)
        if fresh_authority != authority or self.association.resolve() != context:
            raise BuilderExecutionPolicyError("native_generation_conflict")
        self._install(context=context, authority=authority, descriptor=descriptor, intent=intent)
        return PreparedHttpBinding(request=request, intent=intent)

    def _install(self, *, context, authority, descriptor, intent: EffectIntent) -> None:
        from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

        with self.loader.locked(ref=context.ref) as (session, owned, scope):
            NativeExecutionStateStore._validate_node_inputs_owner(
                session, owned, scope, context, authority, context.generation
            )
            _, current, digest = _current_metadata(session=session, owned=owned, node_id=self.association.node_id)
            if current != descriptor or digest != intent.capability_digest:
                raise BuilderExecutionPolicyError("native_http_manifest_drift")
            if self.association.execution_id != intent.key.occurrence_path[0]:
                raise BuilderExecutionPolicyError("native_run_mismatch")
            binding = _classified_binding(
                intent_digest=canonical_digest(intent.model_dump(mode="json")),
                execution_id=self.association.execution_id,
                descriptor=current,
                manifest_digest=digest,
            )
            invocation = session.scalar(
                select(NativeTestInvocation).where(
                    NativeTestInvocation.tenant_id == owned.tenant_id,
                    NativeTestInvocation.request_id == context.ref.request_id,
                    NativeTestInvocation.invocation_id == context.ref.invocation_id,
                    NativeTestInvocation.active.is_(True),
                )
            )
            if invocation is None:
                raise BuilderExecutionPolicyError("native_invocation_mismatch")
            identity = operation_digest(intent.key)
            original = invocation.bindings.get(identity)
            if original is not None and NativeBinding.model_validate(original) != binding:
                raise BuilderExecutionPolicyError("native_binding_conflict")
            if original is None:
                invocation.bindings = {**invocation.bindings, identity: binding.model_dump(mode="json")}
        # Context manager commits before the attested request can reach scalar C02.

    def approval_proposals(self) -> tuple[NativeApprovalProposal, ...]:
        """Host checkpoint owner collects these real proposals after a native wait.

        This exports no authority: public decisions still require the encrypted
        committed proposal and the existing current pending-decision guard.
        """
        if self._context is None or self._cursor is None:
            raise BuilderExecutionPolicyError("native_http_delivery_unavailable")
        if self.association.resolve() != self._context:
            raise BuilderExecutionPolicyError("native_generation_conflict")
        owned = self.loader.load(ref=self._context.ref)
        saved = self._cursor.snapshot()
        return tuple(
            NativeApprovalProposal(
                key=intent.key,
                terms=NativeApprovalTerms(
                    max_calls=1, max_dispatches=1, max_cost_units=1, expires_at=owned.expires_at.isoformat()
                ),
            )
            for intent in saved.intents
        )

    def finish(self) -> None:
        if self._cursor is None:
            raise BuilderExecutionPolicyError("native_http_delivery_unavailable")
        self._cursor.finish()


class NativeHttpCallsFactory(Protocol):
    """Trusted server composition of the scalar owner; no added authority."""

    def __call__(
        self,
        *,
        state: NativeStatePort,
        authorization: ScalarAuthorizationPort,
        journal: NodeOperationJournal,
        max_result_bytes: int,
    ) -> ScalarCallPort: ...


class NativeHttpPreparedObserver(Protocol):
    """Acknowledge the exact prepared binding before scalar authorization."""

    def __call__(self, *, binding: PreparedHttpBinding) -> None: ...


class _ObservedHttpIntents:
    """Observe the actual producer result once without taking preparation ownership."""

    def __init__(self, *, producer: NativeHttpBindingProducer, on_prepared: NativeHttpPreparedObserver) -> None:
        self._producer, self._on_prepared = producer, on_prepared

    def prepare(
        self, *, request: PreparedHttpRequest, hop: int, previous_response: HttpResponse | None
    ) -> PreparedHttpBinding:
        binding = self._producer.prepare(request=request, hop=hop, previous_response=previous_response)
        if self._on_prepared(binding=binding) is not None:
            raise ValueError("native_http_preparation_not_acknowledged")
        return binding


class DeferredNativeHttpClient:
    """Defer private work until native entry, using required trusted host seams.

    The factory and preparation observer are internal server composition. The
    observer closes over the delivery ref when registering the exact binding
    with its host; neither collaborator is client-provided approval authority.
    """

    def __init__(
        self,
        *,
        producer: NativeHttpBindingProducer,
        authorization: ScalarAuthorizationPort,
        calls_factory: NativeHttpCallsFactory,
        on_prepared: NativeHttpPreparedObserver,
    ) -> None:
        self._producer, self._authorization = producer, authorization
        self._calls_factory, self._on_prepared = calls_factory, on_prepared

    @property
    def request_error(self):
        from core.helper import ssrf_proxy

        return ssrf_proxy.request_error

    @property
    def max_retries_exceeded_error(self):
        from core.helper import ssrf_proxy

        return ssrf_proxy.max_retries_exceeded_error

    def _call(self, method: str, url: str, max_retries: int, kwargs: dict):
        self._producer.begin()
        policy = http_policy()
        try:
            calls = self._calls_factory(
                state=self._producer.store,
                authorization=self._authorization,
                journal=self._producer.journal,
                max_result_bytes=policy["max_result_bytes"],
            )
            if not callable(calls.call):
                raise ValueError("native_http_calls_invalid")
        except Exception:
            from services.dify_builder.native_testing.control import NativePolicyStop

            raise NativePolicyStop(
                ref=self._producer.association.ref, reason_code="native_http_calls_unavailable"
            ) from None
        client = NativeHttpClient(
            ref=self._producer.association.ref,
            calls=calls,
            intents=_ObservedHttpIntents(producer=self._producer, on_prepared=self._on_prepared),
            max_redirect_hops=policy["max_redirect_hops"],
            max_response_bytes=policy["max_response_bytes"],
        )
        methods = {
            "get": client.get,
            "head": client.head,
            "post": client.post,
            "put": client.put,
            "patch": client.patch,
            "delete": client.delete,
        }
        result = methods[method](url, max_retries=max_retries, **kwargs)
        self._producer.finish()
        return result

    def get(self, url: str, max_retries: int = 0, **kwargs):
        return self._call("get", url, max_retries, kwargs)

    def head(self, url: str, max_retries: int = 0, **kwargs):
        return self._call("head", url, max_retries, kwargs)

    def post(self, url: str, max_retries: int = 0, **kwargs):
        return self._call("post", url, max_retries, kwargs)

    def put(self, url: str, max_retries: int = 0, **kwargs):
        return self._call("put", url, max_retries, kwargs)

    def delete(self, url: str, max_retries: int = 0, **kwargs):
        return self._call("delete", url, max_retries, kwargs)

    def patch(self, url: str, max_retries: int = 0, **kwargs):
        return self._call("patch", url, max_retries, kwargs)


def _redacted_shape(value: Any, depth: int = 0) -> dict:
    """Typed counts/lengths only; even user-controlled JSON keys remain private."""
    if isinstance(value, dict):
        shaped: dict[str, Any] = {"type": "object", "fields": len(value)}
        if depth < 3:
            shaped["values"] = [_redacted_shape(item, depth + 1) for item in list(value.values())[:8]]
        return shaped
    if isinstance(value, (tuple, list)):
        result: dict[str, Any] = {"type": type(value).__name__, "length": len(value)}
        if depth < 3:
            result["items"] = [_redacted_shape(item, depth + 1) for item in value[:8]]
        return result
    if isinstance(value, (str, bytes)):
        return {"type": type(value).__name__, "length": len(value)}
    return {"type": type(value).__name__}


def http_disclosure_summary(*, intent: EffectIntent, descriptor: dict) -> tuple[dict, dict]:
    if not isinstance(intent.target, str) or not isinstance(intent.parameters, dict):
        raise BuilderExecutionPolicyError("native_http_disclosure_unavailable")
    parsed = httpx.URL(intent.target)
    # A validated ASCII origin is the minimum meaningful destination. Raw
    # path/query/fragment/userinfo values never cross this public boundary.
    host = parsed.host
    if (
        parsed.scheme not in {"http", "https"}
        or not host
        or parsed.username
        or parsed.password
        or not host.isascii()
        or len(host) > 253
        or any(char not in "abcdefghijklmnopqrstuvwxyz0123456789.-:" for char in host.lower())
    ):
        raise BuilderExecutionPolicyError("native_http_disclosure_unavailable")
    origin = str(parsed.copy_with(path="", query=None, fragment=None))
    return (
        {"method": intent.parameters["method"], "origin": origin},
        {
            "request_digest": canonical_digest(intent.parameters),
            "typed_material_bytes": len(canonical_json(intent.parameters)),
            "source_workflow_revision": descriptor["workflow_revision"],
            "redacted_fields": ["path", "query", "body", "headers"],
            "typed_shape": _redacted_shape(intent.parameters),
            "network_scope": "one outbound HTTP request; zero redirects",
            "new_remote_data": True,
        },
    )


class NativeHttpDisclosure:
    """Actual protected pending intent, current classification and bounded public notice."""

    def __init__(self, *, loader, state_store):
        from services.dify_builder.native_testing.pending_intents import ProtectedPendingIntentReader

        self.loader = loader
        self.reader = ProtectedPendingIntentReader(loader=loader, state_store=state_store)

    def describe(self, *, actor: Actor, resolved) -> PendingActionDisclosure:
        if actor != self.loader.actor or resolved.intent.kind != "http":
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        proposed = self.reader.load_terms(resolved=resolved, for_projection=True)  # Actual protected proposal.
        owned = self.loader.load(ref=resolved.ref)
        terms = NativeApprovalTerms(
            max_calls=1, max_dispatches=1, max_cost_units=1, expires_at=owned.expires_at.isoformat()
        )
        if proposed != terms:
            raise BuilderExecutionPolicyError("native_approval_proposal_unavailable")
        with self.loader.session_factory() as session:
            binding = NativeHttpBindingResolver().resolve_binding(session=session, owned=owned, key=resolved.intent.key)
            if (
                binding.intent_digest != canonical_digest(resolved.intent.model_dump(mode="json"))
                or binding.destructive
                or binding != NativeBinding.model_validate(owned.bindings.get(operation_digest(resolved.intent.key)))
            ):
                raise BuilderExecutionPolicyError("native_binding_drift")
            _, descriptor, _ = _current_metadata(session=session, owned=owned, node_id=binding.resource_ref)
            pending = session.scalar(
                select(NativePendingAction)
                .join(NativeEffectOperation, NativeEffectOperation.id == NativePendingAction.operation_id)
                .where(
                    NativeEffectOperation.tenant_id == owned.tenant_id,
                    NativeEffectOperation.request_id == resolved.ref.request_id,
                    NativeEffectOperation.invocation_id == resolved.ref.invocation_id,
                    NativeEffectOperation.operation_digest == operation_digest(resolved.intent.key),
                    NativeEffectOperation.intent_digest == binding.intent_digest,
                    NativePendingAction.tenant_id == owned.tenant_id,
                    NativePendingAction.request_id == resolved.ref.request_id,
                    NativePendingAction.invocation_id == resolved.ref.invocation_id,
                    NativePendingAction.category == "approval",
                    NativePendingAction.owner_version == self._scope(resolved.intent, binding),
                )
            )
            if pending is None or pending.generation != resolved.generation:
                raise BuilderExecutionPolicyError("native_pending_conflict")
            pending_id, scope_digest = pending.id, pending.owner_version
        target, summary = http_disclosure_summary(intent=resolved.intent, descriptor=descriptor)
        return PendingActionDisclosure(
            pending_operation_id=pending_id,
            wait_reason="approval",
            version=resolved.generation + 1,
            scope_digest=scope_digest,
            account_label=None,
            action="Send one opaque HTTP request",
            target=target,
            parameters_summary=summary,
            risk_notice=OPACITY_NOTICE,
            required_configuration=(),
            native_form_ref=None,
            approval_limits=terms,
        )

    @staticmethod
    def _scope(intent, binding):
        # Reuse C02's canonical scope recipe; prose never defines grant authority.
        from services.dify_builder.native_testing.authorization import _scope_digest

        return _scope_digest(intent, binding)
