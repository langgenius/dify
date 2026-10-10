"""Scoped ownership, immutable claims, receipts and authoritative native result sealing."""

import json
from copy import deepcopy
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.dify_builder.execution_policy import (
    MAX_OBSERVATIONS,
    BoundedID,
    BuilderExecutionContext,
    BuilderExecutionObservation,
    BuilderExecutionPolicyError,
    ExecutionEvidenceSummary,
    HttpFixtureSetV1,
    HttpResponseFixtureV1,
    RestrictedAdmissionSnapshot,
    TrustedExecutionCompletion,
    admit_raw_execution_metadata,
    admit_restricted_workflow,
    admitted_node_bindings,
    canonical_digest,
    context_digest,
    decode_http_fixture_set,
    fixture_digest,
    scalar_inputs_digest,
)
from core.dify_builder.input_schema import start_schema
from core.dify_builder.models import Actor, Inputs
from libs.datetime_utils import naive_utc_now
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession, DifyBuilderTestInput
from models.model import App
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowRun
from services.dify_builder.revision import executable_graph_revision, execution_revision

_ID_ADAPTER = TypeAdapter(BoundedID)


def _raw_object(raw: Any, reason: str, *, absent_allowed: bool = False) -> dict[str, Any]:
    if absent_allowed and raw in (None, ""):
        return {}
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(value, dict):
            raise ValueError("not an object")
        canonical_digest(value)
        return value
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise BuilderExecutionPolicyError(reason) from None


def restricted_admission_snapshot(workflow: Workflow, app: App) -> RestrictedAdmissionSnapshot:
    """Inspect serialized metadata without invoking variable/key/trace owners."""
    environment = _raw_object(workflow._environment_variables, "invalid_environment_metadata")
    conversation = _raw_object(workflow._conversation_variables, "invalid_conversation_metadata")
    if environment or conversation:
        raise BuilderExecutionPolicyError("unsupported_variables")
    tracing = _raw_object(app.tracing, "invalid_external_tracing_metadata", absent_allowed=True)
    if tracing and (tracing.get("enabled") is not False or set(tracing) - {"enabled", "tracing_provider"}):
        raise BuilderExecutionPolicyError("unsupported_external_tracing")
    graph = _raw_object(workflow.graph, "invalid_graph_metadata")
    # start_schema is an ordinary native input helper. Validate its minimal
    # structural preconditions before letting it inspect untrusted draft data.
    nodes = graph.get("nodes", [])
    if not isinstance(nodes, list) or len(nodes) > 128:
        raise BuilderExecutionPolicyError("invalid_graph_metadata")
    for node in nodes:
        if not isinstance(node, dict) or not isinstance(node.get("data"), dict):
            raise BuilderExecutionPolicyError("invalid_graph_metadata")
        data = node["data"]
        if data.get("type") == "start":
            variables = data.get("variables", [])
            if not isinstance(variables, list) or any(not isinstance(variable, dict) for variable in variables):
                raise BuilderExecutionPolicyError("invalid_graph_metadata")
    features = _raw_object(workflow.serialized_features, "invalid_feature_metadata", absent_allowed=True)
    try:
        kind = workflow.kind_or_standard
    except ValueError:
        raise BuilderExecutionPolicyError("unsupported_workflow") from None
    snapshot = RestrictedAdmissionSnapshot(
        app_mode=app.mode,
        workflow_kind=kind,
        graph=deepcopy(graph),
        input_schema=start_schema(graph),
        features=deepcopy(features),
        has_environment_variables=False,
        has_conversation_variables=False,
        has_external_tracing=tracing.get("enabled", False) is not False,
    )
    admit_raw_execution_metadata(snapshot)
    return snapshot


@dataclass(frozen=True)
class _OwnerSnapshot:
    app: App
    workflow: Workflow
    session: DifyBuilderSession | None
    test_input: DifyBuilderTestInput | None


def _owners(
    db: Session,
    *,
    app_id: str,
    actor: Actor,
    workflow_id: str | None = None,
    session_id: str | None = None,
    test_input_id: str | None = None,
) -> _OwnerSnapshot:
    account = db.get(Account, actor.account_id)
    workspace = db.get(Tenant, actor.tenant_id)
    membership = db.scalar(
        select(TenantAccountJoin).where(
            TenantAccountJoin.tenant_id == actor.tenant_id, TenantAccountJoin.account_id == actor.account_id
        )
    )
    app = db.scalar(select(App).where(App.id == app_id, App.tenant_id == actor.tenant_id, App.status == "normal"))
    if (
        account is None
        or account.status != AccountStatus.ACTIVE
        or membership is None
        or app is None
        or workspace is None
        or workspace.status != TenantStatus.NORMAL
    ):
        raise BuilderExecutionPolicyError("execution_owner_mismatch")
    if not dify_config.RBAC_ENABLED and not TenantAccountRole.is_editing_role(membership.role):
        raise BuilderExecutionPolicyError("execution_permission_denied")
    statement = select(Workflow).where(
        Workflow.app_id == app.id,
        Workflow.tenant_id == actor.tenant_id,
        Workflow.version == "draft",
        Workflow.type == "workflow",
    )
    if workflow_id is not None:
        statement = statement.where(Workflow.id == workflow_id)
    workflow = db.scalar(statement)
    if workflow is None:
        raise BuilderExecutionPolicyError("execution_owner_mismatch")
    builder_session = db.get(DifyBuilderSession, session_id) if session_id is not None else None
    test_input = db.get(DifyBuilderTestInput, test_input_id) if test_input_id is not None else None
    if session_id is not None and (
        builder_session is None
        or builder_session.app_id != app.id
        or builder_session.tenant_id != actor.tenant_id
        or builder_session.owner_account_id != actor.account_id
    ):
        raise BuilderExecutionPolicyError("execution_owner_mismatch")
    if test_input_id is not None and (test_input is None or test_input.session_id != session_id):
        raise BuilderExecutionPolicyError("execution_owner_mismatch")
    return _OwnerSnapshot(app=app, workflow=workflow, session=builder_session, test_input=test_input)


def _permission(actor: Actor, app_id: str, session_factory: sessionmaker[Session]) -> None:
    """Use native RBAC service owners with the PlainApp locator semantics.

    The transport helper gives OR semantics to a check list, so require each
    scene separately. Resource/maintainer reads close before permission RPC.
    """
    if not dify_config.RBAC_ENABLED:
        return
    from core.rbac import RBACPermission, RBACResourceScope
    from services.enterprise.rbac_service import RBACService
    from services.rbac_resource_service import RBACResourceService

    with session_factory() as db:
        binding = RBACResourceService.get_app_agent_binding(db, actor.tenant_id, app_id)
        maintainer = RBACResourceService.get_app_maintainer(db, actor.tenant_id, app_id)
    if binding is not None:
        raise BuilderExecutionPolicyError("unsupported_workflow")
    if maintainer == actor.account_id:
        return
    try:
        for scene in (RBACPermission.APP_EDIT, RBACPermission.APP_TEST_AND_RUN):
            if not RBACService.CheckAccess.check(
                actor.tenant_id, actor.account_id, scene=scene, resource_type=RBACResourceScope.APP, resource_id=app_id
            ):
                raise BuilderExecutionPolicyError("execution_permission_denied")
    except Exception:
        raise BuilderExecutionPolicyError("execution_permission_denied") from None


def _validate_context(context: BuilderExecutionContext) -> None:
    try:
        # Validate even a model_copy/model_construct crossing a trusted boundary.
        checked = BuilderExecutionContext.model_validate(context.model_dump(mode="json"))
    except (ValidationError, ValueError, TypeError):
        raise BuilderExecutionPolicyError("invalid_execution_context") from None
    if checked != context or context.context_digest != context_digest(context):
        raise BuilderExecutionPolicyError("context_digest_mismatch")


def _bound_request(db: Session, context: BuilderExecutionContext, *, lock: bool) -> DifyBuilderExecutionRequest:
    _validate_context(context)
    statement = select(DifyBuilderExecutionRequest).where(DifyBuilderExecutionRequest.id == context.request_id)
    if lock:
        statement = statement.with_for_update()
    row = db.scalar(statement)
    if row is None or row.context_digest != context.context_digest or row.context != context.model_dump(mode="json"):
        raise BuilderExecutionPolicyError("execution_request_mismatch")
    for name in ("tenant_id", "app_id", "workflow_id", "actor_id", "session_id", "test_input_id"):
        if getattr(row, name) != getattr(context, name):
            raise BuilderExecutionPolicyError("execution_owner_mismatch")
    return row


class BuilderExecutionPolicyService:
    def __init__(self, session_factory: sessionmaker[Session]):
        self._session_factory = session_factory

    def prepare(
        self,
        *,
        session_id: str,
        test_input_id: str,
        app_id: str,
        actor: Actor,
        workflow: Workflow,
        submitted_inputs: Inputs,
        effective_inputs: Inputs,
    ) -> BuilderExecutionContext:
        with self._session_factory() as db:
            owner = _owners(
                db,
                app_id=app_id,
                actor=actor,
                workflow_id=workflow.id,
                session_id=session_id,
                test_input_id=test_input_id,
            )
            assert owner.test_input is not None
            if (workflow.app_id, workflow.tenant_id) != (app_id, actor.tenant_id):
                raise BuilderExecutionPolicyError("execution_owner_mismatch")
            supplied = restricted_admission_snapshot(workflow, owner.app)
            snapshot = restricted_admission_snapshot(owner.workflow, owner.app)
            if supplied != snapshot:
                raise BuilderExecutionPolicyError("stale_execution_revision")
            submitted_digest = scalar_inputs_digest(submitted_inputs)
            effective_digest = scalar_inputs_digest(effective_inputs)
            if submitted_digest != scalar_inputs_digest(owner.test_input.inputs):
                raise BuilderExecutionPolicyError("test_input_binding_mismatch")
            revision = execution_revision(owner.workflow)
            fixtures = decode_http_fixture_set(owner.test_input.http_fixtures)
            if fixtures is not None and fixtures.execution_revision != revision:
                raise BuilderExecutionPolicyError("stale_http_fixtures")
            http_fixtures = fixtures.fixtures if fixtures is not None else ()
            values = {
                "request_id": str(uuid4()),
                "tenant_id": actor.tenant_id,
                "app_id": app_id,
                "workflow_id": owner.workflow.id,
                "actor_id": actor.account_id,
                "session_id": session_id,
                "test_input_id": test_input_id,
                "execution_revision": revision,
                "graph_revision": executable_graph_revision(snapshot.graph),
                "submitted_inputs_digest": submitted_digest,
                "effective_inputs_digest": effective_digest,
                "fixture_digest": fixture_digest(revision, http_fixtures),
                "mode": "mock" if http_fixtures else "restricted",
                "sandbox_profile": "disabled",
                "admitted_nodes": admitted_node_bindings(snapshot),
                "http_fixtures": http_fixtures,
            }
            initial = BuilderExecutionContext.model_validate({**values, "context_digest": "0" * 64})
            context = BuilderExecutionContext.model_validate({**values, "context_digest": context_digest(initial)})
            admit_restricted_workflow(context, snapshot)
        _permission(actor, app_id, self._session_factory)
        with self._session_factory.begin() as db:
            db.add(
                DifyBuilderExecutionRequest(
                    id=context.request_id,
                    tenant_id=context.tenant_id,
                    app_id=context.app_id,
                    workflow_id=context.workflow_id,
                    actor_id=context.actor_id,
                    session_id=context.session_id,
                    test_input_id=context.test_input_id,
                    context=context.model_dump(mode="json"),
                    context_digest=context.context_digest,
                    state="prepared",
                    observations=[],
                )
            )
        return context

    def stamp_http_fixtures(
        self, app_id: str, actor: Actor, *, base_app_revision: str, fixtures: tuple[HttpResponseFixtureV1, ...]
    ) -> HttpFixtureSetV1:
        _permission(actor, app_id, self._session_factory)
        with self._session_factory() as db:
            owner = _owners(db, app_id=app_id, actor=actor)
            snapshot = restricted_admission_snapshot(owner.workflow, owner.app)
            bindings = admitted_node_bindings(snapshot)
            revision = execution_revision(owner.workflow)
            if not base_app_revision or base_app_revision != revision:
                raise BuilderExecutionPolicyError("stale_http_fixtures")
            binding_by_id = {binding.node_id: binding for binding in bindings}
            for fixture in fixtures:
                binding = binding_by_id.get(fixture.node_id)
                if binding is None or (binding.implementation, binding.node_version) != (
                    fixture.implementation,
                    fixture.node_version,
                ):
                    raise BuilderExecutionPolicyError("unused_http_fixture")
            return HttpFixtureSetV1(execution_revision=revision, fixtures=fixtures)

    def claim_launch(self, *, context: BuilderExecutionContext, native_run_id: str, task_id: str) -> None:
        try:
            _ID_ADAPTER.validate_python(native_run_id)
            _ID_ADAPTER.validate_python(task_id)
        except ValidationError:
            raise BuilderExecutionPolicyError("invalid_launch_identity") from None
        with self._session_factory.begin() as db:
            row = _bound_request(db, context, lock=True)
            if row.state != "prepared" or row.native_run_id is not None or row.task_id is not None:
                raise BuilderExecutionPolicyError("execution_already_claimed")
            row.native_run_id, row.task_id, row.state = native_run_id, task_id, "running"

    def revalidate(
        self,
        *,
        context: BuilderExecutionContext,
        workflow: Workflow,
        app: App,
        actor_id: str,
        effective_inputs: Inputs,
        root_node_id: str,
        call_depth: int,
        transport: Literal["in_process", "celery"],
        resume: bool,
    ) -> None:
        _validate_context(context)
        if transport != "in_process" or resume or call_depth != 0:
            raise BuilderExecutionPolicyError("unsupported_execution_transport")
        if (app.id, app.tenant_id, workflow.id, workflow.app_id, workflow.tenant_id, actor_id) != (
            context.app_id,
            context.tenant_id,
            context.workflow_id,
            context.app_id,
            context.tenant_id,
            context.actor_id,
        ):
            raise BuilderExecutionPolicyError("execution_owner_mismatch")
        # Refuse raw changes before any revision function can resolve secrets.
        supplied = restricted_admission_snapshot(workflow, app)
        actor = Actor(account_id=context.actor_id, tenant_id=context.tenant_id)
        _permission(actor, context.app_id, self._session_factory)
        with self._session_factory() as db:
            row = _bound_request(db, context, lock=False)
            if row.state not in {"prepared", "running"}:
                raise BuilderExecutionPolicyError("execution_request_closed")
            owner = _owners(
                db,
                app_id=context.app_id,
                actor=actor,
                workflow_id=context.workflow_id,
                session_id=context.session_id,
                test_input_id=context.test_input_id,
            )
            snapshot = restricted_admission_snapshot(owner.workflow, owner.app)
            if (
                supplied != snapshot
                or context.execution_revision != execution_revision(owner.workflow)
                or context.graph_revision != executable_graph_revision(snapshot.graph)
            ):
                raise BuilderExecutionPolicyError("stale_execution_revision")
            assert owner.test_input is not None
            envelope = decode_http_fixture_set(owner.test_input.http_fixtures)
            fixtures = envelope.fixtures if envelope is not None else ()
            if envelope is not None and envelope.execution_revision != context.execution_revision:
                raise BuilderExecutionPolicyError("stale_http_fixtures")
            if (
                fixtures != context.http_fixtures
                or scalar_inputs_digest(owner.test_input.inputs) != context.submitted_inputs_digest
            ):
                raise BuilderExecutionPolicyError("test_input_binding_mismatch")
            if scalar_inputs_digest(effective_inputs) != context.effective_inputs_digest:
                raise BuilderExecutionPolicyError("effective_input_binding_mismatch")
            admit_restricted_workflow(context, snapshot)
            root = next(node["id"] for node in snapshot.graph["nodes"] if node["data"]["type"] == "start")
            if root_node_id != root:
                raise BuilderExecutionPolicyError("unsupported_execution_root")

    def record(
        self,
        *,
        context: BuilderExecutionContext,
        native_run_id: str,
        task_id: str,
        observation: BuilderExecutionObservation,
    ) -> None:
        try:
            observation = BuilderExecutionObservation.model_validate(observation.model_dump(mode="json"))
        except (ValidationError, ValueError, TypeError):
            raise BuilderExecutionPolicyError("invalid_execution_observation") from None
        with self._session_factory.begin() as db:
            row = _bound_request(db, context, lock=True)
            if row.state != "running" or row.native_run_id != native_run_id or row.task_id != task_id:
                raise BuilderExecutionPolicyError("execution_launch_mismatch")
            binding = next((b for b in context.admitted_nodes if b.node_id == observation.node_id), None)
            if (
                observation.request_id != context.request_id
                or binding is None
                or observation.implementation_version != f"{binding.implementation}:{binding.node_version}"
            ):
                raise BuilderExecutionPolicyError("observation_binding_mismatch")
            if observation.kind == "fixture_served":
                if (
                    not any(f.node_id == observation.node_id for f in context.http_fixtures)
                    or observation.fixture_digest != context.fixture_digest
                ):
                    raise BuilderExecutionPolicyError("observation_fixture_mismatch")
            elif observation.fixture_digest is not None:
                raise BuilderExecutionPolicyError("observation_fixture_mismatch")
            # No sandbox is admitted by this foundation; receipts need Task 5's typed deployment owner.
            if observation.kind.startswith("sandbox_") or observation.profile_digest is not None:
                raise BuilderExecutionPolicyError("sandbox_capability_unverified")
            observations = list(row.observations)
            if len(observations) >= MAX_OBSERVATIONS:
                raise BuilderExecutionPolicyError("observation_limit_exceeded")
            if any(o["observation_id"] == observation.observation_id for o in observations):
                raise BuilderExecutionPolicyError("duplicate_execution_observation")
            if any(o["invocation_id"] == observation.invocation_id for o in observations):
                raise BuilderExecutionPolicyError("duplicate_capability_invocation")
            row.observations = [*observations, observation.model_dump(mode="json")]

    def seal(self, *, request_id: str, completion: TrustedExecutionCompletion) -> ExecutionEvidenceSummary:
        """Freeze one owned canonical result; a later native write cannot upgrade it."""
        try:
            completion = TrustedExecutionCompletion.model_validate(completion.model_dump(mode="json"))
        except (ValidationError, ValueError, TypeError):
            raise BuilderExecutionPolicyError("invalid_execution_completion") from None
        context = completion.context
        if request_id != context.request_id:
            raise BuilderExecutionPolicyError("execution_request_mismatch")
        with self._session_factory.begin() as db:
            row = _bound_request(db, context, lock=True)
            _owners(
                db,
                app_id=context.app_id,
                actor=Actor(account_id=context.actor_id, tenant_id=context.tenant_id),
                workflow_id=context.workflow_id,
                session_id=context.session_id,
                test_input_id=context.test_input_id,
            )
            if (row.native_run_id, row.task_id) != (completion.native_run_id, completion.task_id):
                raise BuilderExecutionPolicyError("execution_launch_mismatch")
            native = db.get(WorkflowRun, row.native_run_id) if row.native_run_id else None
            nodes = (
                list(
                    db.scalars(
                        select(WorkflowNodeExecutionModel).where(
                            WorkflowNodeExecutionModel.workflow_run_id == row.native_run_id
                        )
                    )
                )
                if native is not None
                else []
            )
            if native is not None:
                if (
                    native.tenant_id,
                    native.app_id,
                    native.workflow_id,
                    native.created_by,
                    native.created_by_role,
                    native.triggered_from,
                    native.type,
                    native.version,
                ) != (
                    context.tenant_id,
                    context.app_id,
                    context.workflow_id,
                    context.actor_id,
                    "account",
                    "debugging",
                    "workflow",
                    "draft",
                ):
                    raise BuilderExecutionPolicyError("native_execution_owner_mismatch")
                for node in nodes:
                    if (
                        node.tenant_id,
                        node.app_id,
                        node.workflow_id,
                        node.created_by,
                        node.created_by_role,
                        node.triggered_from,
                    ) != (
                        context.tenant_id,
                        context.app_id,
                        context.workflow_id,
                        context.actor_id,
                        "account",
                        "workflow-run",
                    ):
                        raise BuilderExecutionPolicyError("native_execution_owner_mismatch")
            # Raw SQL projections avoid offloaded payload I/O under the short sidecar lock.
            run_fields = (
                "id",
                "tenant_id",
                "app_id",
                "workflow_id",
                "created_by",
                "created_by_role",
                "triggered_from",
                "type",
                "version",
                "graph",
                "inputs",
                "status",
                "outputs",
                "error",
                "finished_at",
                "total_steps",
                "exceptions_count",
            )
            node_fields = (
                "id",
                "node_execution_id",
                "node_id",
                "node_type",
                "index",
                "predecessor_node_id",
                "status",
                "finished_at",
                "process_data",
                "execution_metadata",
                "inputs",
                "outputs",
                "error",
            )

            def projection(value, fields):
                return {
                    key: (
                        getattr(value, key).isoformat()
                        if key == "finished_at" and getattr(value, key)
                        else getattr(value, key).value
                        if isinstance(getattr(value, key), Enum)
                        else getattr(value, key)
                    )
                    for key in fields
                }

            native_projection = projection(native, run_fields) if native is not None else None
            node_projection = [projection(n, node_fields) for n in sorted(nodes, key=lambda n: (n.index, n.id))]
            fingerprint = canonical_digest(
                {
                    "completion": completion.model_dump(mode="json"),
                    "native": native_projection,
                    "nodes": node_projection,
                    "observations": row.observations,
                }
            )
            if row.state == "sealed":
                if fingerprint != row.completion_fingerprint:
                    raise BuilderExecutionPolicyError("conflicting_execution_completion")
                return ExecutionEvidenceSummary.model_validate(row.completion_summary)
            if row.state not in {"prepared", "running"}:
                raise BuilderExecutionPolicyError("execution_request_closed")
            observations = []
            receipts_valid = True
            try:
                for raw_observation in row.observations:
                    try:
                        observations.append(BuilderExecutionObservation.model_validate(raw_observation))
                    except (ValidationError, ValueError, TypeError):
                        receipts_valid = False
                bindings = {b.node_id: b for b in context.admitted_nodes}
                if (
                    len(observations) > MAX_OBSERVATIONS
                    or len({o.invocation_id for o in observations}) != len(observations)
                    or len({o.observation_id for o in observations}) != len(observations)
                ):
                    receipts_valid = False
                for o in observations:
                    b = bindings.get(o.node_id)
                    if (
                        o.request_id != request_id
                        or b is None
                        or o.implementation_version != f"{b.implementation}:{b.node_version}"
                        or not b.implementation.endswith(".HttpRequestNode")
                        or o.profile_digest is not None
                        or o.kind not in {"fixture_served", "effect_blocked"}
                    ):
                        receipts_valid = False
                    if o.kind == "fixture_served":
                        if o.fixture_digest != context.fixture_digest or not any(
                            f.node_id == o.node_id for f in context.http_fixtures
                        ):
                            receipts_valid = False
                    elif o.fixture_digest is not None:
                        receipts_valid = False
            except (ValidationError, ValueError, TypeError):
                receipts_valid = False
            blocked = tuple(sorted({o.node_id for o in observations if o.kind == "effect_blocked"}))
            simulated = tuple(sorted({o.node_id for o in observations if o.kind == "fixture_served"}))
            complete = (
                completion.worker_finished
                and completion.response_completed
                and completion.recorder_healthy
                and completion.worker_exit in {"returned", "stopped", "failed"}
                and native is not None
                and receipts_valid
            )
            if complete:
                complete = self._native_proof(context, native, nodes, observations)
            outcome = "execution_evidence_unknown"
            # A typed pre-native refusal is the only exception to unknown-first.
            if (
                native is None
                and completion.refusal is not None
                and completion.response_completed
                and (
                    completion.preworker_refusal
                    or (completion.worker_finished and completion.worker_exit == "policy_refused")
                )
            ):
                outcome = "unsupported_safe_execution"
            elif complete and native is not None:
                if native.status != "succeeded":
                    outcome = "native_failed"
                elif blocked:
                    outcome = "execution_blocked"
                elif simulated:
                    outcome = "simulation_completed"
                elif context.mode == "restricted":
                    outcome = "restricted_execution_completed"
            summary = ExecutionEvidenceSummary(
                request_id=request_id,
                mode=context.mode,
                sealed=True,
                safety_outcome=outcome,
                simulated_node_ids=simulated,
                blocked_node_ids=blocked,
                sandbox_profile=context.sandbox_profile,
                fixture_digest=context.fixture_digest,
                native_run_id=native.id if native is not None else None,
            )
            row.state = "sealed"
            row.completion_fingerprint = fingerprint
            row.completion_summary = summary.model_dump(mode="json")
            row.sealed_at = naive_utc_now()
            return summary

    @staticmethod
    def _native_proof(
        context: BuilderExecutionContext,
        native: WorkflowRun,
        nodes: list[WorkflowNodeExecutionModel],
        observations: list[BuilderExecutionObservation],
    ) -> bool:
        """Check graph/index chain coverage and retries; optional predecessors must agree."""
        from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY, WorkflowNodeRetryAttempt

        try:
            graph = _raw_object(native.graph, "invalid_native_graph")
            snapshot = RestrictedAdmissionSnapshot(
                app_mode="workflow",
                workflow_kind="standard",
                graph=graph,
                input_schema=start_schema(graph),
                features={},
                has_environment_variables=False,
                has_conversation_variables=False,
                has_external_tracing=False,
            )
            if (
                admitted_node_bindings(snapshot) != context.admitted_nodes
                or executable_graph_revision(graph) != context.graph_revision
            ):
                return False
            inputs = _raw_object(native.inputs, "invalid_native_inputs")
            if (
                scalar_inputs_digest({k: v for k, v in inputs.items() if not k.startswith("sys.")})
                != context.effective_inputs_digest
            ):
                return False
            if (
                native.status not in {"succeeded", "failed", "stopped", "partial-succeeded"}
                or native.finished_at is None
            ):
                return False
            if not nodes or any(
                n.node_execution_id is None
                or n.finished_at is None
                or n.status not in {"succeeded", "failed", "exception"}
                for n in nodes
            ):
                return False
            if len({n.node_execution_id for n in nodes}) != len(nodes) or len({n.node_id for n in nodes}) != len(nodes):
                return False
            by_id = {n["id"]: n for n in graph["nodes"]}
            start = next(n["id"] for n in graph["nodes"] if n["data"]["type"] == "start")
            next_ids = {e["source"]: e["target"] for e in graph["edges"]}
            ordered = sorted(nodes, key=lambda n: n.index)
            expected, previous, attempts = start, None, 0
            for index, node in enumerate(ordered, 1):
                # Graphon leaves predecessor unset on ordinary start events. The
                # admitted graph and persisted indices prove order; a supplied
                # predecessor must corroborate it rather than replace that proof.
                if (
                    node.node_id != expected
                    or node.index != index
                    or node.predecessor_node_id not in ({None, ""} if previous is None else {None, previous})
                ):
                    return False
                if node.node_id not in by_id or node.node_type != by_id[node.node_id]["data"]["type"]:
                    return False
                process = _raw_object(node.process_data, "invalid_native_retries", absent_allowed=True)
                retries = [
                    WorkflowNodeRetryAttempt.model_validate(r) for r in process.get(RETRY_HISTORY_PROCESS_DATA_KEY, [])
                ]
                if [r.retry_index for r in retries] != list(range(1, len(retries) + 1)):
                    return False
                attempts += 1 + len(retries)
                receipts = [o for o in observations if o.node_id == node.node_id]
                if node.node_type == "http-request":
                    if len(receipts) != 1 + len(retries):
                        return False
                elif receipts:
                    return False
                previous, expected = node.node_id, next_ids.get(node.node_id)
            if any(o.node_id not in {n.node_id for n in nodes} for o in observations):
                return False
            if native.total_steps != attempts:
                return False
            if native.status in {"succeeded", "partial-succeeded"} and (
                expected is not None or len(nodes) != len(by_id)
            ):
                return False
            if native.status == "succeeded" and (
                native.exceptions_count != 0 or any(n.status != "succeeded" for n in nodes)
            ):
                return False
            return True
        except (BuilderExecutionPolicyError, ValidationError, ValueError, TypeError, KeyError, StopIteration):
            return False

    def recorder(
        self, *, context: BuilderExecutionContext, native_run_id: str, task_id: str
    ) -> "ServiceExecutionRecorder":
        return ServiceExecutionRecorder(self, context, native_run_id, task_id)


@dataclass(frozen=True)
class ServiceExecutionRecorder:
    """Immutable captured launch identity with a monotonic local failure latch."""

    _service: BuilderExecutionPolicyService
    _context: BuilderExecutionContext
    _native_run_id: str
    _task_id: str
    _failed: bool = field(default=False, init=False)

    @property
    def healthy(self) -> bool:
        return not self._failed

    def record(self, observation: BuilderExecutionObservation) -> None:
        if self._failed:
            raise BuilderExecutionPolicyError("execution_recorder_unhealthy")
        try:
            self._service.record(
                context=self._context, native_run_id=self._native_run_id, task_id=self._task_id, observation=observation
            )
        except Exception:
            object.__setattr__(self, "_failed", True)
            raise BuilderExecutionPolicyError("execution_recorder_failed") from None
