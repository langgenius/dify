"""Dify's per-delivery composition around the existing native generator.

SQL claims, Graphon execution, opaque observation and physical cleanup retain
separate existing owners. A delivery captures its immutable dispatch identity;
queue messages never supply actors, checkpoint payloads or cleanup authority.
"""

from __future__ import annotations

from dataclasses import dataclass
from threading import RLock
from typing import TYPE_CHECKING

from sqlalchemy import select

from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import NativeContinuation, NativeDispatch, NativePayloadObject
from models.enums import CreatorUserRole
from models.workflow import WorkflowRun
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.contracts import CheckpointRef
from services.dify_builder.native_testing.http_binding import build_native_http_profile
from services.dify_builder.native_testing.lifecycle import NativeDispatchRef, NativeTestLifecycleService
from services.dify_builder.native_testing.observation_repository import bind_native_repository_observation
from services.dify_builder.native_testing.state_store import invocation_state, owner_query

if TYPE_CHECKING:
    from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
    from graphon.engine.filter import ResponseStreamFilter
    from services.dify_builder.native_testing.context_runtime import NativeGraphRuntimeState
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch
    from services.dify_builder.native_testing.host_lifetime import NativeHostLifetimeRegistry


def _profile_matches(raw, qualification):
    from services.dify_builder.native_testing.context_binding import (
        NativeRuntimeProfile,
    )
    from services.dify_builder.native_testing.sandbox.qualification import (
        NativeCodeQualification,
    )

    if raw == build_native_http_profile().model_dump(mode="json"):
        return True
    if type(qualification) is not NativeCodeQualification:
        return False
    qualification.validate_profile(NativeRuntimeProfile.model_validate(raw))
    return True


def _profile_resolver(raw, qualification):
    from services.dify_builder.native_testing.http_binding import (
        NativeHttpBindingResolver,
    )
    from services.dify_builder.native_testing.sandbox.qualification import (
        NativeCodeBindingResolver,
    )

    if raw == build_native_http_profile().model_dump(mode="json"):
        return NativeHttpBindingResolver()
    if not _profile_matches(raw, qualification):
        raise BuilderExecutionPolicyError("native_code_qualification_unavailable")
    return NativeCodeBindingResolver(qualification=qualification)


class DifyNativeResumeSettlement:
    """Bounded SQL-only check in C03's existing resume writer.

    A committed wait is visible before the acquisition's cleanup and dispatch
    finalization. Neither the wait nor an absent process handle proves those
    acknowledgements. Inspect the source local generation, not scope generation.
    """

    def __init__(self, *, code_qualification=None):
        # Existing HTTP callers have no Code qualification owner.
        self.code_qualification = code_qualification

    def validate(self, *, session, owned, state, checkpoint: CheckpointRef) -> None:
        dispatches = session.scalars(
            owner_query(NativeDispatch, owned.ref, owned.tenant_id).where(NativeDispatch.generation == state.generation)
        ).all()
        if state.cleanup_complete is not True or len(dispatches) != 1 or dispatches[0].state != "completed":
            raise BuilderExecutionPolicyError("native_resume_unsettled")
        request = session.scalar(
            select(DifyBuilderExecutionRequest).where(
                DifyBuilderExecutionRequest.id == owned.ref.request_id,
                DifyBuilderExecutionRequest.tenant_id == owned.tenant_id,
                DifyBuilderExecutionRequest.actor_id == owned.actor_id,
            )
        )
        saved = session.scalar(
            owner_query(NativeContinuation, owned.ref, owned.tenant_id).where(
                NativeContinuation.generation == state.generation,
                NativeContinuation.checkpoint_id == checkpoint.checkpoint_id,
                NativeContinuation.payload_digest == checkpoint.payload_digest,
            )
        )
        payload = session.scalar(
            owner_query(NativePayloadObject, owned.ref, owned.tenant_id).where(
                NativePayloadObject.id == checkpoint.checkpoint_id, NativePayloadObject.kind == "checkpoint"
            )
        )
        if (
            request is None
            or not _profile_matches(request.context.get("profile"), self.code_qualification)
            or canonical_digest(request.context) != owned.ref.context_digest
            or saved is None
            or payload is None
            or state.checkpoint_id != checkpoint.checkpoint_id
        ):
            raise BuilderExecutionPolicyError("native_resume_unsettled")
        run = session.scalar(
            select(WorkflowRun).where(
                WorkflowRun.id == request.context.get("native_run_id"),
                WorkflowRun.tenant_id == owned.tenant_id,
                WorkflowRun.app_id == state.app_id,
                WorkflowRun.workflow_id == state.workflow_id,
                WorkflowRun.created_by == owned.actor_id,
                WorkflowRun.created_by_role == CreatorUserRole.ACCOUNT,
                WorkflowRun.status == "paused",
            )
        )
        if run is None:
            raise BuilderExecutionPolicyError("native_resume_unsettled")


@dataclass(frozen=True)
class NativeHostResumeBindings:
    """Private exact objects reconstructed only from an authentic claimed C03."""

    entity: WorkflowAppGenerateEntity
    runtime_state: NativeGraphRuntimeState
    response_filter: ResponseStreamFilter
    checkpoint: CheckpointRef
    payload_digest: str


def restore_claimed_host(*, host: NativeHostLaunch, lifecycle: NativeTestLifecycleService, expected_payload):
    from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
    from graphon.engine.filter import ResponseStreamFilter
    from services.dify_builder.native_testing.context_runtime import NativeGraphRuntimeState

    context = host.lifetime.context
    journal = host._journal
    if (
        type(lifecycle) is not NativeTestLifecycleService
        or journal is None
        or lifecycle.store is not journal._state
        or context.generation <= 0
        or type(lifecycle.resume_settlement) is not DifyNativeResumeSettlement
    ):
        raise BuilderExecutionPolicyError("native_resume_owner_mismatch")
    checkpoint = lifecycle.claimed_resume_checkpoint(
        ref=context.ref, generation=context.generation, dispatch_id=host.lifetime.dispatch_id
    )
    actual = lifecycle.store.read_checkpoint(ref=context.ref, checkpoint=checkpoint)
    if actual != expected_payload or actual.native_run_id != context.native_run_id:
        raise BuilderExecutionPolicyError("native_journal_payload_mismatch")
    journal.restore_claimed(
        ref=context.ref,
        generation=context.generation,
        dispatch_id=host.lifetime.dispatch_id,
        lifecycle=lifecycle,
        expected_payload=actual,
    )
    with host.observation_scope():
        entity = WorkflowAppGenerateEntity.model_validate_json(actual.generate_entity_json)
        runtime = NativeGraphRuntimeState.from_snapshot(actual.graph_runtime_state_json)
        response_filter = ResponseStreamFilter()
        response_filter.loads(actual.response_stream_filter_json)
        if (
            type(runtime) is not NativeGraphRuntimeState
            or entity.native_test_required is not True
            or entity.native_test_ref != context.ref
            or entity.workflow_execution_id != context.native_run_id
            or entity.user_id != context.actor_id
            or (entity.app_config.tenant_id, entity.app_config.app_id, entity.app_config.workflow_id)
            != (context.tenant_id, context.app_id, context.workflow_id)
            or entity.trace_manager is not None
            or entity.builder_execution is not None
            or not entity.stream
        ):
            raise BuilderExecutionPolicyError("native_resume_identity_mismatch")
        if (
            lifecycle.store.load_context(ref=context.ref) != context
            or lifecycle.claimed_resume_checkpoint(
                ref=context.ref, generation=context.generation, dispatch_id=host.lifetime.dispatch_id
            )
            != checkpoint
        ):
            raise BuilderExecutionPolicyError("native_generation_conflict")
    return NativeHostResumeBindings(entity, runtime, response_filter, checkpoint, checkpoint.payload_digest)


class DifyNativeRuntime:
    """One actual acquisition, built inactive before C03 claims its delivery."""

    def __init__(
        self, *, delivery: NativeDispatchRef, lifecycle, registry: NativeHostLifetimeRegistry, code_owner_factory=None
    ):
        from services.dify_builder.native_testing.authorization import EffectAuthorizationService
        from services.dify_builder.native_testing.checkpoint_bridge import NativeCheckpointBridge
        from services.dify_builder.native_testing.host_capacity import NativeHostCapacity
        from services.dify_builder.native_testing.host_execution import NativeHostLaunch
        from services.dify_builder.native_testing.host_lifetime import NativeHostLifetime
        from services.dify_builder.native_testing.http_binding import native_http_config
        from services.dify_builder.native_testing.operation_journal import NodeOperationJournal

        if (
            type(delivery) is not NativeDispatchRef
            or type(lifecycle.resume_settlement) is not DifyNativeResumeSettlement
        ):
            raise BuilderExecutionPolicyError("native_runtime_composition_mismatch")
        context = lifecycle.store.load_context(ref=delivery.ref)
        if context.generation != delivery.generation:
            raise BuilderExecutionPolicyError("native_generation_conflict")
        if lifecycle._dispatch_ref is not None:
            raise BuilderExecutionPolicyError("native_runtime_composition_mismatch")
        lifecycle._dispatch_ref = delivery
        self.delivery, self.lifecycle, self.registry = delivery, lifecycle, registry
        self.context = context
        self.authorization = EffectAuthorizationService(lifecycle.loader)
        journal = NodeOperationJournal(state=lifecycle.store, authorization=self.authorization)
        checkpoints = NativeCheckpointBridge(state=lifecycle.store, lifecycle=lifecycle)
        lifetime = NativeHostLifetime(context=context, dispatch_id=delivery.dispatch_id)
        timeout = native_http_config().default_timeout()
        if timeout.connect is None or timeout.read is None or timeout.write is None:
            raise BuilderExecutionPolicyError("native_http_profile_drift")
        self.host = NativeHostLaunch(
            context=context,
            dispatch_id=delivery.dispatch_id,
            lifetime=lifetime,
            journal=journal,
            checkpoints=checkpoints,
            fence_pending=lifecycle.fence_pending,
            stop_sealer=lifecycle,
            authorization=self.authorization,
            http_baseline=(timeout.connect, timeout.read, timeout.write),
        )
        self.host.bind_cancellation_fence(fence=DifyNativeCancellationFence(lifecycle=lifecycle, delivery=delivery))
        # Existing API delivery remains HTTP-profile-bound. No caller installs
        # Code; its table is queried only for an explicitly composed owner.
        from services.dify_builder.native_testing.sandbox.qualification import (
            NativeCodeBindingResolver,
        )

        self.code_qualification = (
            lifecycle.loader.resolver.qualification
            if type(lifecycle.loader.resolver) is NativeCodeBindingResolver
            else None
        )
        if self.code_qualification is not None:
            from services.dify_builder.native_testing.sandbox.host import (
                NativeCodeHostOwner,
            )

            self.code_qualification.check()
            if code_owner_factory is not None:
                raise BuilderExecutionPolicyError("native_code_host_composition_mismatch")
            code_owner_factory = NativeCodeHostOwner
        self.code_owner = None
        if code_owner_factory is not None:
            from services.dify_builder.native_testing.sandbox.host import (
                NativeCodeHostOwner,
            )

            self.code_owner = code_owner_factory(host=self.host, loader=lifecycle.loader)
            if type(self.code_owner) is not NativeCodeHostOwner or self.code_owner.host is not self.host:
                raise BuilderExecutionPolicyError("native_code_host_composition_mismatch")
        self.capacity = NativeHostCapacity(lifecycle, cleanup_verifier=lifetime, code_cleanup=self.code_owner)
        self._journal, self._checkpoints = journal, checkpoints
        self.host.bind_observation()
        self._started = False
        self._lock = RLock()

    def _start(self, context):
        from services.dify_builder.native_testing.native_execution import DifyNativeWorkflowOwner
        from services.dify_builder.native_testing.stream_runtime import DifyNativeStreamOwner

        with self._lock:
            if self._started or context != self.context:
                raise BuilderExecutionPolicyError("native_delivery_replayed")
            # SQL claim ACK preceded entry through lifecycle.execute_dispatch.
            # Re-read the exact claimed row before transferring physical ownership.
            with self.lifecycle.loader.session_factory() as session:
                dispatch = session.scalar(
                    owner_query(NativeDispatch, context.ref, context.tenant_id).where(
                        NativeDispatch.id == self.delivery.dispatch_id,
                        NativeDispatch.generation == self.delivery.generation,
                        NativeDispatch.state == "claimed",
                    )
                )
                if dispatch is None:
                    raise BuilderExecutionPolicyError("native_dispatch_conflict")
            self.registry.activate(lifetime=self.host.lifetime)
            self._started = True
        self.host.bind_observation()
        bridge = build_delivery_bridge(runtime=self)
        stream = DifyNativeStreamOwner(
            host=self.host,
            capacity=self.capacity,
            session_factory=self.lifecycle.loader.session_factory,
            state=self.lifecycle.store,
            authorization=self.authorization,
            journal=self._journal,
            checkpoints=self._checkpoints,
        )
        return DifyNativeWorkflowOwner(
            session_factory=self.lifecycle.loader.session_factory,
            runtime=bridge,
            stream_owner=stream,
            native_host=self.host,
        )

    def _failed_start(self):
        if not self._started or self.host.lifetime._consumed:
            return
        try:
            self.host.request_close(reason="failed")
            # This actual zero-activity predicate rejects any source/reader,
            # attempted worker, native activity, controls or child history.
            self.host.confirm_never_started()
            self.capacity.record_cleanup(
                ref=self.delivery.ref, generation=self.delivery.generation, dispatch_id=self.delivery.dispatch_id
            )
            self.host.retire()
        except BaseException:
            self.host.mark_unknown()

    def run_initial(self, *, context):
        if self.delivery.generation != 0:
            raise BuilderExecutionPolicyError("native_generation_conflict")
        try:
            return self._start(context).run(context=context, on_event=lambda event: None)
        except BaseException:
            self._failed_start()
            raise

    def resume(self, *, context, checkpoint, resolutions):
        try:
            owner = self._start(context)
            self.host.restore_claimed_resume(lifecycle=self.lifecycle, expected_payload=checkpoint)
            return owner.resume_claimed(context=context)
        except BaseException:
            self._failed_start()
            raise

    def cancel(self, *, refs):
        return ()  # Request-wide coordinator owns retained acquisitions, never a replacement verifier.

    def recovery_evidence(self, *, context, dispatch_id):
        return "unknown"


class _UnavailableCollaborator:
    def __call__(self, *args, **kwargs):
        raise BuilderExecutionPolicyError("native_capability_unavailable")

    def __getattr__(self, name):
        raise BuilderExecutionPolicyError("native_capability_unavailable")


def build_delivery_bridge(*, runtime: DifyNativeRuntime):
    from graphon.nodes.http_request.node import HttpRequestNode
    from services.dify_builder.native_testing.http_binding import (
        DeferredNativeHttpClient,
        NativeHttpBindingProducer,
        RefusingNativeHttpFiles,
        native_http_config,
    )
    from services.dify_builder.native_testing.private_reads import validate_invocation_workflow
    from services.dify_builder.native_testing.repository import native_workflow_revision
    from services.dify_builder.native_testing.runtime_bridge import (
        NativeCollaborators,
        NativePreparedInputs,
        NativeRuntimeBridge,
    )

    host, lifecycle = runtime.host, runtime.lifecycle
    denied = _UnavailableCollaborator()

    def collaborators(*, association):
        from core.workflow.template_rendering import CodeExecutorJinja2TemplateRenderer
        from graphon.nodes.code.code_node import CodeNode
        from graphon.nodes.template_transform.template_transform_node import (
            TemplateTransformNode,
        )
        from services.dify_builder.native_testing.call_adapter import NativeCallAdapter
        from services.dify_builder.native_testing.host_execution import (
            HostBoundCodeCalls,
        )
        from services.dify_builder.native_testing.sandbox.executor import (
            NativeCodeExecutor,
        )
        from services.dify_builder.native_testing.sandbox.qualification import (
            BOUNDS,
            NativeCodeBindingProducer,
        )

        if runtime.code_qualification is not None and issubclass(
            association.node_class, (CodeNode, TemplateTransformNode)
        ):
            producer = NativeCodeBindingProducer(
                association=association,
                loader=lifecycle.loader,
                state_store=lifecycle.store,
                journal=runtime._journal,
                qualification=runtime.code_qualification,
            )
            calls = HostBoundCodeCalls(
                host=host,
                adapter=NativeCallAdapter(
                    state=lifecycle.store,
                    authorization=runtime.authorization,
                    journal=runtime._journal,
                    max_result_bytes=BOUNDS["result_bytes"],
                ),
                allowance=26,
            )
            executor = NativeCodeExecutor(
                producer=producer,
                calls=calls,
                owner=runtime.code_owner,
                on_prepared=lambda: host.register_proposals(producer=producer),
            )
            return NativeCollaborators(
                denied,
                denied,
                denied,
                denied,
                denied,
                executor,
                CodeExecutorJinja2TemplateRenderer(executor=executor),
                denied,
                denied,
                denied,
            )
        if runtime.code_qualification is not None:
            return NativeCollaborators(*(denied for _ in range(10)))
        if not issubclass(association.node_class, HttpRequestNode):
            return NativeCollaborators(*(denied for _ in range(10)))
        producer = NativeHttpBindingProducer(
            association=association,
            loader=lifecycle.loader,
            state_store=lifecycle.store,
            journal=runtime._journal,
        )

        def prepared(*, binding):
            host.register_proposals(producer=producer)
            host.register_http_request(ref=association.ref, binding=binding)

        client = DeferredNativeHttpClient(
            producer=producer,
            authorization=runtime.authorization,
            calls_factory=host.make_calls,
            on_prepared=prepared,
        )
        return NativeCollaborators(client, *(denied for _ in range(9)))

    def arguments(*, node_id, node_data, node_class, collaborators):
        from graphon.nodes.code.code_node import CodeNode
        from graphon.nodes.template_transform.template_transform_node import (
            TemplateTransformNode,
        )
        from services.dify_builder.native_testing.sandbox.qualification import (
            code_limits,
            template_limit,
        )

        kind = node_data.type
        if runtime.code_qualification is not None:
            if kind == "code" and node_class is CodeNode:
                return {
                    "code_executor": collaborators.code,
                    "code_limits": code_limits(),
                }
            if kind == "template-transform" and node_class is TemplateTransformNode:
                return {
                    "jinja2_template_renderer": collaborators.jinja,
                    "max_output_length": template_limit(),
                }
            if kind == "http-request":
                raise BuilderExecutionPolicyError("native_capability_unavailable")
        if kind == "http-request" and node_class is HttpRequestNode:
            files = RefusingNativeHttpFiles()
            return {
                "http_request_config": native_http_config(),
                "http_client": collaborators.http,
                "tool_file_manager_factory": files,
                "file_manager": files,
                "file_reference_factory": denied,
            }
        if kind in {"start", "end", "if-else", "loop", "loop-start", "loop-end", "iteration", "iteration-start"}:
            return {}
        raise BuilderExecutionPolicyError("native_capability_unavailable")

    def inputs(context):
        if lifecycle.store.load_context(ref=context.ref) != context:
            raise BuilderExecutionPolicyError("native_context_mismatch")
        with lifecycle.loader.session_factory() as session:
            workflow = validate_invocation_workflow(
                session,
                tenant_id=context.tenant_id,
                app_id=context.app_id,
                workflow_id=context.workflow_id,
            )
            if native_workflow_revision(workflow) != context.graph_revision:
                raise BuilderExecutionPolicyError("native_revision_drift")
            # The qualified literal HTTP lane has no environmental secrets.
            # Refuse before their decryption/materialization in ordinary preparation.
            if workflow._environment_variables not in (None, "[]", "{}", ""):
                raise BuilderExecutionPolicyError("native_capability_unavailable")
        return NativePreparedInputs(inputs=context.inputs, files=(), environment_variables=())

    return NativeRuntimeBridge(
        state=lifecycle.store,
        collaborators=collaborators,
        node_arguments=arguments,
        prepare_inputs=inputs,
        boundary_owner=host.boundary_owner,
        control_sink=host.control_sink,
    )


class DifyNativeCancellationSettlement:
    """Exact lifecycle's existing App-first SQL proof, without a fabricated host."""

    def __init__(self, *, lifecycle):
        self.lifecycle = lifecycle

    def finish_unacquired(self, *, ref):
        from services.dify_builder.native_testing.host_capacity import finish_unacquired_cancellation

        if self.lifecycle.cancellation_settlement is not self:
            raise BuilderExecutionPolicyError("native_runtime_composition_mismatch")
        finish_unacquired_cancellation(self.lifecycle, ref=ref)


class DifyNativeRuntimeOwner:
    """Bounded application-scoped current acquisitions, never cleanup by ID alone."""

    def __init__(self, *, code_capability=None):
        from services.dify_builder.native_testing.sandbox.qualification import (
            NativeCodeQualification,
        )

        if code_capability is not None:
            if type(code_capability) is not NativeCodeQualification:
                raise BuilderExecutionPolicyError("native_code_qualification_unavailable")
            code_capability.check()
        self.code_qualification = code_capability
        self._lock = RLock()
        self._requests = {}
        self._current = {}

    def delivery(self, *, sessions, delivery: NativeDispatchRef, actor_hint: Actor | None = None):
        from services.dify_builder.native_testing.api_service import (
            NativeTestApiService,
        )
        from services.dify_builder.native_testing.host_lifetime import (
            NativeHostLifetimeRegistry,
        )

        with sessions() as session:
            request = session.scalar(
                select(DifyBuilderExecutionRequest).where(
                    DifyBuilderExecutionRequest.id == delivery.ref.request_id,
                    DifyBuilderExecutionRequest.context_digest == delivery.ref.context_digest,
                )
            )
            if request is None:
                raise BuilderExecutionPolicyError("native_owner_mismatch")
            actor = Actor(account_id=request.actor_id, tenant_id=request.tenant_id)
            profile_data = request.context.get("profile")
        if actor_hint is not None and actor_hint != actor:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        service = NativeTestApiService(
            session_factory=sessions,
            actor=actor,
            resolver=_profile_resolver(profile_data, self.code_qualification),
            admission=None,
            resolution=None,
            runtime=self,
            disclosure=None,
        )
        lifecycle = service.lifecycle
        lifecycle.resume_settlement = DifyNativeResumeSettlement(code_qualification=self.code_qualification)
        lifecycle.cancellation_settlement = DifyNativeCancellationSettlement(lifecycle=lifecycle)
        # The persisted full chain is checked even for a harmless late duplicate.
        # Settlement reads can inspect a sealed source; they grant no new IO.
        from services.dify_builder.execution_policy_service import check_execution_permission

        with sessions() as session:
            owned, _ = lifecycle.loader._load(session, ref=delivery.ref, lock=False, settlement=True)
        check_execution_permission(actor, owned.app_id, sessions)
        key = (actor.tenant_id, actor.account_id, delivery.ref.request_id)
        identity = (key, delivery.ref.invocation_id)
        with self._lock:
            prior = self._current.get(identity)
            if prior is not None and prior.delivery == delivery:
                return prior.lifecycle
            if prior is not None and not prior.host.lifetime._consumed:
                raise BuilderExecutionPolicyError("native_capacity_busy")
        # This same delivery process owns these registries. A separate Beat
        # process cannot retire them. Reap only durable closed + actually
        # consumed owners before admitting another acquisition; exact retained
        # duplicate delivery above remains a harmless reuse of its verifier.
        self.retire_closed(sessions=sessions)
        with sessions() as session:
            dispatch = session.scalar(
                owner_query(NativeDispatch, delivery.ref, actor.tenant_id).where(
                    NativeDispatch.id == delivery.dispatch_id,
                    NativeDispatch.generation == delivery.generation,
                )
            )
            if dispatch is None:
                raise BuilderExecutionPolicyError("native_dispatch_conflict")
            if dispatch.state not in {"queued", "published"}:
                # A foreign-process acquisition cannot be replaced with a new
                # physical verifier. C03's nonqueued claim simply refuses it.
                return lifecycle
        with self._lock:
            registry = self._requests.get(key)
            if registry is None:
                if len(self._requests) >= 128:
                    raise BuilderExecutionPolicyError("native_runtime_capacity_busy")
                registry = NativeHostLifetimeRegistry()
                self._requests[key] = registry
        # Current context/profile/object IO stays outside the registry lock.
        runtime = DifyNativeRuntime(delivery=delivery, lifecycle=lifecycle, registry=registry)
        with self._lock:
            current = self._current.get(identity)
            if current is not prior or self._requests.get(key) is not registry:
                if current is not None and current.delivery == delivery:
                    return current.lifecycle
                raise BuilderExecutionPolicyError("native_capacity_busy")
            self._current[identity] = runtime
            lifecycle.runtime = runtime
        return lifecycle

    def run_initial(self, *, context):
        raise BuilderExecutionPolicyError("native_dispatch_identity_required")

    def resume(self, *, context, checkpoint, resolutions):
        raise BuilderExecutionPolicyError("native_dispatch_identity_required")

    def cancel(self, *, refs):
        with self._lock:
            retained = tuple(self._current.items())
        for ref in refs:
            selected = next(((key, r) for key, r in retained if r.delivery.ref == ref), None)
            if selected is None:
                continue  # Foreign-process/absent handles grant no physical proof.
            identity, current = selected
            host, delivery = current.host, current.delivery
            if host.lifetime._consumed:
                continue  # Consumption of an older generation never acknowledges a newer one.
            try:
                # Durable cancellation precedes this read. Select the exact local
                # generation and acquired dispatch; ref alone survives resumes.
                with current.lifecycle.loader.session_factory() as session:
                    owned, scope = current.lifecycle.loader._load(session, ref=ref, lock=False, settlement=True)
                    state = invocation_state(session, ref, owned.tenant_id)
                    acquired = current.capacity._latest_acquired(session, ref, owned.tenant_id)
                    if (
                        not scope.cancelled
                        or state.generation != delivery.generation
                        or state.cleanup_complete
                        or acquired is None
                        or (acquired.id, acquired.generation) != (delivery.dispatch_id, delivery.generation)
                    ):
                        continue
                with self._lock:
                    if self._current.get(identity) is not current:
                        continue
                host.request_close(reason="cancel")
                host.lifetime.settle()  # Original deadline; unknown stays unknown.
                host.release_dead_dispatcher_logs()
                with self._lock:
                    replaced = self._current.get(identity) is not current
                if replaced:
                    host.mark_unknown()
                    continue
                # Original immutable verifier consumes outside the writer, then
                # capacity reselects the full SQL identity under App→request.
                current.capacity.record_cleanup(
                    ref=ref, generation=delivery.generation, dispatch_id=delivery.dispatch_id
                )
                host.retire()
            except BaseException:
                host.mark_unknown()
        return ()  # SQL ACK is authority; invocation IDs are never cleanup receipts.

    def recovery_evidence(self, *, context, dispatch_id):
        with self._lock:
            retained = tuple(self._current.values())
        for current in retained:
            if (current.delivery.ref, current.delivery.generation, current.delivery.dispatch_id) == (
                context.ref,
                context.generation,
                dispatch_id,
            ):
                return "stopped" if current.host.lifetime._consumed else "unknown"
        return "unknown"

    def retire_closed(self, *, sessions):
        from services.dify_builder.native_testing.host_capacity import finish_unacquired_cancellation

        # Durable closure precedes disposal. A retained inactive generation-zero
        # candidate additionally needs the existing complete SQL never-acquired
        # proof; missing handles or inactivity alone never grant retirement.
        with self._lock:
            registries = tuple(self._requests.items())
        for key, registry in registries:
            with sessions() as session:
                request = session.scalar(
                    select(DifyBuilderExecutionRequest).where(
                        DifyBuilderExecutionRequest.tenant_id == key[0],
                        DifyBuilderExecutionRequest.actor_id == key[1],
                        DifyBuilderExecutionRequest.id == key[2],
                    )
                )
                closed = request is not None and request.state in {"sealed", "cancelled", "failed", "expired"}
            if not closed:
                continue
            with self._lock:
                if self._requests.get(key) is not registry:
                    continue
                entries = tuple((k, v) for k, v in self._current.items() if k[0] == key)
            eligible = True
            for _, current in entries:
                if current.host.lifetime._consumed:
                    continue
                if (
                    current.registry is not registry
                    or current.delivery.generation != 0
                    or current.host.lifetime._registry is not None
                    or current.host.lifetime.unknown
                ):
                    eligible = False
                    break
                try:
                    # SQL only, outside owner/host locks. This preserves the
                    # complete scoped initial outbox/no-effects/context proof.
                    if not finish_unacquired_cancellation(current.lifecycle, ref=current.delivery.ref):
                        eligible = False
                        break
                except Exception:
                    eligible = False
                    break
            if not eligible:
                continue
            with self._lock:
                if self._requests.get(key) is not registry or entries != tuple(
                    (k, v) for k, v in self._current.items() if k[0] == key
                ):
                    continue  # Actual retained owner changed during unlocked SQL.
                try:
                    # Atomic with registry.activate: an activated unconsumed
                    # lifetime refuses disposal; a disposed registry fences any
                    # future activation. Never mark an inactive lifetime consumed.
                    registry.dispose()
                except ValueError:
                    continue
                for identity, _ in entries:
                    del self._current[identity]
                del self._requests[key]


class DifyNativeInitialLaunch:
    def __init__(self, *, lifecycle, publish):
        if (
            type(lifecycle.resume_settlement) is not DifyNativeResumeSettlement
            or type(lifecycle.cancellation_settlement) is not DifyNativeCancellationSettlement
            or lifecycle.cancellation_settlement.lifecycle is not lifecycle
        ):
            raise BuilderExecutionPolicyError("native_runtime_composition_mismatch")
        self._lifecycle, self._publish = lifecycle, publish

    def launch(self, *, ref):
        self._lifecycle.enqueue_initial_dispatch(ref=ref)
        self._lifecycle.publish_pending(publish=self._publish)


def build_native_api(*, sessions, actor, owner: DifyNativeRuntimeOwner, publish):
    from services.dify_builder.native_testing.api_service import (
        NativeAdmissionDependencies,
        NativeTestApiService,
    )
    from services.dify_builder.native_testing.context_binding import (
        NativeAdmissionCompiler,
    )
    from services.dify_builder.native_testing.http_binding import (
        NativeHttpDisclosure,
        NativeHttpResourceSnapshot,
    )

    if type(owner) is not DifyNativeRuntimeOwner:
        raise BuilderExecutionPolicyError("native_runtime_composition_mismatch")
    qualification = owner.code_qualification
    profile = build_native_http_profile() if qualification is None else qualification.profile()
    service = NativeTestApiService(
        session_factory=sessions,
        actor=actor,
        resolver=_profile_resolver(profile.model_dump(mode="json"), qualification),
        admission=None,
        resolution=None,
        runtime=owner,
        disclosure=None,
    )
    service.lifecycle.resume_settlement = DifyNativeResumeSettlement(code_qualification=qualification)
    service.lifecycle.cancellation_settlement = DifyNativeCancellationSettlement(lifecycle=service.lifecycle)
    from services.dify_builder.native_testing.sandbox.qualification import (
        NativeCodeDisclosure,
        NativeCodeResourceSnapshot,
    )

    resources = (
        NativeHttpResourceSnapshot(session_factory=sessions)
        if qualification is None
        else NativeCodeResourceSnapshot(session_factory=sessions, qualification=qualification)
    )
    service.admission = NativeAdmissionDependencies(
        compiler=NativeAdmissionCompiler(session_factory=sessions, resources=resources),
        profile=profile,
        launch=DifyNativeInitialLaunch(lifecycle=service.lifecycle, publish=publish),
    )
    service.disclosure = (
        NativeHttpDisclosure(loader=service.loader, state_store=service.store)
        if qualification is None
        else NativeCodeDisclosure(
            loader=service.loader,
            state_store=service.store,
            qualification=qualification,
        )
    )
    return service


def validate_projection_host(*, host, guard, entity=None, queue=None, task_id=None, user_id=None):
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch

    if type(host) is not NativeHostLaunch or host.native_observation is not guard:
        raise BuilderExecutionPolicyError("native_resume_owner_mismatch")
    host._require_live()
    guard.require_healthy()
    context = host.lifetime.context
    if user_id is not None and user_id != context.actor_id:
        raise BuilderExecutionPolicyError("native_resume_identity_mismatch")
    if entity is not None or queue is not None:
        generation = host.generation_bindings
        if (
            entity is not generation.entity
            or queue is not generation.queue
            or getattr(queue, "native_host", None) is not host
            or getattr(queue, "native_observation", None) is not guard
        ):
            raise BuilderExecutionPolicyError("native_resume_identity_mismatch")
    if context.generation > 0:
        restored = host.resume_bindings
        host.require_resume_projection_bindings(
            entity=restored.entity, runtime_state=restored.runtime_state, response_filter=restored.response_filter
        )
        if task_id is not None and task_id != restored.entity.task_id:
            raise BuilderExecutionPolicyError("native_resume_identity_mismatch")


def require_resume_projection(*, host, guard, queue, entity=None, workflow_run_id=None):
    with guard.persistence_scope():
        validate_projection_host(host=host, guard=guard)
        host.require_resume_projection(guard=guard, queue=queue, entity=entity, workflow_run_id=workflow_run_id)


def load_resume_history(*, host, workflow_repository, node_repository):
    from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
    from core.repositories.sqlalchemy_workflow_node_execution_repository import (
        SQLAlchemyWorkflowNodeExecutionRepository,
    )
    from graphon.enums import WorkflowExecutionStatus

    validate_projection_host(host=host, guard=host.native_observation)
    restored = host.resume_bindings
    host.require_resume_bindings(
        entity=restored.entity, runtime_state=restored.runtime_state, response_filter=restored.response_filter
    )
    if (
        type(workflow_repository) is not SQLAlchemyWorkflowExecutionRepository
        or type(node_repository) is not SQLAlchemyWorkflowNodeExecutionRepository
    ):
        raise BuilderExecutionPolicyError("native_resume_history_unavailable")
    context, guard = host.lifetime.context, host.native_observation
    bind_native_repository_observation(repository=workflow_repository, context=context, guard=guard)
    bind_native_repository_observation(repository=node_repository, context=context, guard=guard)
    execution = workflow_repository.get_native_observation_run(workflow_run_id=context.native_run_id)
    if execution.id_ != context.native_run_id or execution.status is not WorkflowExecutionStatus.PAUSED:
        raise BuilderExecutionPolicyError("native_resume_history_unavailable")
    nodes = node_repository.get_by_workflow_execution(context.native_run_id)
    if len({node.id for node in nodes}) != len(nodes):
        raise BuilderExecutionPolicyError("native_resume_history_unavailable")
    host.require_resume_bindings(
        entity=restored.entity, runtime_state=restored.runtime_state, response_filter=restored.response_filter
    )
    return workflow_repository, node_repository, execution, nodes


def read_claimed_history(*, host, entity, workflow_repository, node_repository):
    """Read bound owned content before persistence installs or mutates history."""
    from graphon.enums import WorkflowExecutionStatus
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch

    if type(host) is not NativeHostLaunch:
        raise BuilderExecutionPolicyError("native_resume_owner_mismatch")
    restored = host.resume_bindings
    generation = host.generation_bindings
    host.require_resume_bindings(
        entity=entity, runtime_state=restored.runtime_state, response_filter=restored.response_filter
    )
    if (
        generation.entity is not entity
        or generation.workflow_repository is not workflow_repository
        or generation.node_repository is not node_repository
        or host.engine_bindings.runtime_state is not restored.runtime_state
    ):
        raise BuilderExecutionPolicyError("native_resume_identity_mismatch")
    history = host._resume_history
    if history is None or history[0] is not workflow_repository or history[1] is not node_repository:
        raise BuilderExecutionPolicyError("native_resume_history_unavailable")
    context = host.lifetime.context
    guard = host.native_observation
    # Repository binding is an exact retained association, never a redacted
    # row's self-asserted provenance. These real reads validate all offloads.
    bind_native_repository_observation(repository=workflow_repository, context=context, guard=guard)
    bind_native_repository_observation(repository=node_repository, context=context, guard=guard)
    execution = workflow_repository.get_native_observation_run(workflow_run_id=context.native_run_id)
    if execution.id_ != context.native_run_id or execution.status is not WorkflowExecutionStatus.PAUSED:
        raise BuilderExecutionPolicyError("native_resume_history_unavailable")
    nodes = node_repository.get_by_workflow_execution(context.native_run_id)
    if len({node.id for node in nodes}) != len(nodes):
        raise BuilderExecutionPolicyError("native_resume_history_unavailable")
    host.require_resume_bindings(
        entity=entity, runtime_state=restored.runtime_state, response_filter=restored.response_filter
    )
    return execution, nodes


def resume_native_generator(*, app_model, workflow, user, runtime, native_host, sessions):
    from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
    from core.repositories.sqlalchemy_workflow_node_execution_repository import (
        SQLAlchemyWorkflowNodeExecutionRepository,
    )
    from models.enums import WorkflowRunTriggeredFrom
    from models.workflow import WorkflowNodeExecutionTriggeredFrom
    from services.dify_builder.native_testing.generation_wiring import (
        HostOwnedNativeGeneratorStream,
        preflight_native_observation,
        validate_native_host,
    )
    from services.workflow_run_agg import WorkflowRunAgg
    from services.workflow_runtime.workflow_generator import WorkflowAppGenerator

    context = native_host.lifetime.context
    validate_native_host(required=True, ref=context.ref, runtime=runtime, host=native_host)
    bindings = native_host.resume_bindings
    native_host.require_resume_bindings(
        entity=bindings.entity, runtime_state=bindings.runtime_state, response_filter=bindings.response_filter
    )
    preflight_native_observation(host=native_host, entity=bindings.entity, workflow=workflow)
    workflow_repo = SQLAlchemyWorkflowExecutionRepository(
        sessions,
        context.tenant_id,
        user,
        context.app_id,
        WorkflowRunTriggeredFrom.DEBUGGING,
    )
    node_repo = SQLAlchemyWorkflowNodeExecutionRepository(
        sessions,
        context.tenant_id,
        user,
        context.app_id,
        WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )
    with native_host.observation_scope():
        native_host.bind_resume_history(workflow_repository=workflow_repo, node_repository=node_repo)
        source = WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run).resume(
            app_model=app_model,
            workflow=workflow,
            user=user,
            application_generate_entity=bindings.entity,
            graph_runtime_state=bindings.runtime_state,
            response_stream_filter=bindings.response_filter,
            workflow_execution_repository=workflow_repo,
            workflow_node_execution_repository=node_repo,
            native_runtime=runtime,
            native_host=native_host,
        )
    from collections.abc import Generator

    if not isinstance(source, Generator):
        raise BuilderExecutionPolicyError("native_stream_unavailable")
    return HostOwnedNativeGeneratorStream(source=source, host=native_host)


class DifyNativeCancellationFence:
    def __init__(self, *, lifecycle, delivery):
        self.lifecycle, self.delivery = lifecycle, delivery

    def poll(self):
        from services.dify_builder.native_testing.state_store import invocation_state

        with self.lifecycle.loader.session_factory() as session:
            owned, scope = self.lifecycle.loader._load(session, ref=self.delivery.ref, lock=False, settlement=True)
            state = invocation_state(session, self.delivery.ref, owned.tenant_id)
            dispatch = session.scalar(
                owner_query(NativeDispatch, self.delivery.ref, owned.tenant_id).where(
                    NativeDispatch.id == self.delivery.dispatch_id,
                    NativeDispatch.generation == self.delivery.generation,
                )
            )
            if dispatch is None or state.generation != self.delivery.generation:
                raise BuilderExecutionPolicyError("native_dispatch_conflict")
            return scope.cancelled or state.cancellation_key is not None
