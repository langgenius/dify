"""Scoped ownership, immutable claims, receipts and authoritative native result sealing."""

import json
import re
from collections.abc import Sequence
from copy import deepcopy
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.app_config.workflow_ui_based_app.variables.manager import WorkflowVariablesConfigManager
from core.app.apps.base_app_generator import BaseAppGenerator
from core.dify_builder import gmail_read_policy
from core.dify_builder.execution_policy import (
    MAX_OBSERVATIONS,
    BoundedID,
    BuilderExecutionContext,
    BuilderExecutionObservation,
    BuilderExecutionPolicyError,
    ConfirmedToolExecutionContext,
    ExecutionEvidenceSummary,
    HttpFixtureSetV1,
    HttpResponseFixtureV1,
    JsonToolExecutionContext,
    QualifiedJsonToolBinding,
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
    validate_execution_context,
)
from core.dify_builder.input_schema import start_schema
from core.dify_builder.models import Actor, Inputs
from core.rbac import RBACPermission, RBACResourceScope
from libs.datetime_utils import naive_utc_now
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.dify_builder import (
    DifyBuilderExecutionRequest,
    DifyBuilderRealCallConsent,
    DifyBuilderSession,
    DifyBuilderTestInput,
)
from models.model import App
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowRun
from services.dify_builder.json_tool_execution import admit_json_workflow, resolve_json_parameters
from services.dify_builder.json_tool_metadata import (
    InstalledJsonParse,
    require_same_json_installation,
    resolve_installed_json_parse,
)
from services.dify_builder.json_tool_runtime import JsonRuntimeBinding, JsonToolRuntimeIssuer
from services.dify_builder.revision import executable_graph_revision, execution_revision, normalize_execution_graph
from services.rbac.resource_queries import ResourceQueryService

_ID_ADAPTER = TypeAdapter(BoundedID)
_REASON_CODE = re.compile(r"[a-z][a-z0-9_]{0,127}\Z")


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


def _execution_snapshot(snapshot: RestrictedAdmissionSnapshot) -> RestrictedAdmissionSnapshot:
    """Compare executable state after raw metadata inspection, without canvas presentation."""
    return snapshot.model_copy(update={"graph": normalize_execution_graph(snapshot.graph)})


@dataclass(frozen=True)
class ExecutionOwnerSnapshot:
    app: App
    workflow: Workflow
    session: DifyBuilderSession | None
    test_input: DifyBuilderTestInput | None


def load_execution_owners(
    db: Session,
    *,
    app_id: str,
    actor: Actor,
    workflow_id: str | None = None,
    session_id: str | None = None,
    test_input_id: str | None = None,
) -> ExecutionOwnerSnapshot:
    """Read the full local owner chain in the caller's session; the shared Builder owner check."""
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
    return ExecutionOwnerSnapshot(app=app, workflow=workflow, session=builder_session, test_input=test_input)


def check_execution_permission(actor: Actor, app_id: str, session_factory: sessionmaker[Session]) -> None:
    """Require edit and test/run access using the caller's database owner."""
    if not dify_config.RBAC_ENABLED:
        return
    from extensions.application_services.rbac import build_rbac_resource_queries

    check_app_permissions(
        actor,
        app_id,
        queries=build_rbac_resource_queries(database_client=session_factory),
        permissions=(RBACPermission.APP_EDIT, RBACPermission.APP_TEST_AND_RUN),
    )


def check_app_permissions(
    actor: Actor,
    app_id: str,
    *,
    queries: ResourceQueryService,
    permissions: Sequence[RBACPermission],
) -> None:
    """Require every Builder permission with native PlainApp ownership semantics.

    Resource and maintainer reads close before permission RPC. An agent-backed
    app is ineligible, and the app maintainer already owns its permissions.
    """
    if not dify_config.RBAC_ENABLED:
        return
    from services.enterprise.rbac_service import RBACService

    binding = queries.get_app_agent_binding(actor.tenant_id, app_id)
    if binding is not None:
        raise BuilderExecutionPolicyError("unsupported_workflow")
    maintainer = queries.get_app_maintainer(actor.tenant_id, app_id)
    if maintainer == actor.account_id:
        return
    try:
        for scene in permissions:
            if not RBACService.CheckAccess.check(
                actor.tenant_id, actor.account_id, scene=scene, resource_type=RBACResourceScope.APP, resource_id=app_id
            ):
                raise BuilderExecutionPolicyError("execution_permission_denied")
    except Exception:
        raise BuilderExecutionPolicyError("execution_permission_denied") from None


ExecutionContext = BuilderExecutionContext | ConfirmedToolExecutionContext | JsonToolExecutionContext


def _validate_context(context: ExecutionContext) -> None:
    if not isinstance(context, (BuilderExecutionContext, ConfirmedToolExecutionContext, JsonToolExecutionContext)):
        raise BuilderExecutionPolicyError("invalid_execution_context")
    try:
        # Validate even a model_copy/model_construct crossing a trusted boundary;
        # the decoder raises its own invalid/digest reason codes.
        checked = validate_execution_context(context.model_dump(mode="json"))
    except (ValidationError, ValueError, TypeError) as error:
        if isinstance(error, BuilderExecutionPolicyError):
            raise
        raise BuilderExecutionPolicyError("invalid_execution_context") from None
    if type(checked) is not type(context) or checked != context:
        raise BuilderExecutionPolicyError("context_digest_mismatch")


def admit_confirmed_workflow(context: ConfirmedToolExecutionContext, snapshot: RestrictedAdmissionSnapshot) -> None:
    """The exact Start → Gmail get_message → End graph the reservation admitted, nothing else."""
    if not isinstance(context, ConfirmedToolExecutionContext):
        raise BuilderExecutionPolicyError("unsupported_execution_policy")
    _validate_context(context)
    if context.mode != "confirmed_tool" or context.sandbox_profile != "disabled":
        raise BuilderExecutionPolicyError("execution_mode_mismatch")
    if gmail_read_policy.admit_get_message_workflow(snapshot).nodes != context.admitted_nodes:
        raise BuilderExecutionPolicyError("node_binding_mismatch")


def admit_execution_workflow(context: ExecutionContext, snapshot: RestrictedAdmissionSnapshot) -> None:
    """Exhaustive raw-graph admission over the context union; no variant falls through."""
    match context:
        case ConfirmedToolExecutionContext():
            admit_confirmed_workflow(context, snapshot)
        case BuilderExecutionContext():
            admit_restricted_workflow(context, snapshot)
        case JsonToolExecutionContext():
            _validate_context(context)
            if admit_json_workflow(snapshot).nodes != context.admitted_nodes:
                raise BuilderExecutionPolicyError("node_binding_mismatch")
        case _:
            raise BuilderExecutionPolicyError("unsupported_execution_policy")


def _bound_request(db: Session, context: ExecutionContext, *, lock: bool) -> DifyBuilderExecutionRequest:
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


def _is_json_parse_candidate(snapshot: RestrictedAdmissionSnapshot) -> bool:
    """Select this one action from its raw identity before policy-specific admission."""
    nodes = snapshot.graph.get("nodes")
    return isinstance(nodes, list) and any(
        isinstance(node, dict)
        and isinstance(node.get("data"), dict)
        and node["data"].get("type") == "tool"
        and node["data"].get("provider_id") == "langgenius/json_process/json_process"
        and node["data"].get("tool_name") == "parse"
        for node in nodes
    )


def _owned_effective_inputs(owner: ExecutionOwnerSnapshot) -> dict[str, Any]:
    """Run the existing native input preparation on saved, owned test input."""
    assert owner.test_input is not None
    try:
        return dict(
            BaseAppGenerator()._prepare_user_inputs(
                user_inputs=owner.test_input.inputs,
                variables=WorkflowVariablesConfigManager.convert(owner.workflow),
                tenant_id=owner.app.tenant_id,
            )
        )
    except (ValueError, TypeError):
        raise BuilderExecutionPolicyError("unsupported_input_value") from None


def _json_owner_state(owner: ExecutionOwnerSnapshot, snapshot: RestrictedAdmissionSnapshot) -> str:
    """Bind owners, execution configuration and inputs across daemon I/O.

    Canvas presentation and the editor's full graph hash are excluded, just
    as in preparation and native admission.
    """
    assert owner.session is not None
    assert owner.test_input is not None
    return canonical_digest(
        {
            "app": {
                "id": owner.app.id,
                "tenant_id": owner.app.tenant_id,
                "status": owner.app.status.value,
                "mode": owner.app.mode.value,
                "tracing": owner.app.tracing,
                "workflow_id": owner.app.workflow_id,
            },
            "workflow": {
                "id": owner.workflow.id,
                "app_id": owner.workflow.app_id,
                "tenant_id": owner.workflow.tenant_id,
                "version": owner.workflow.version,
                "type": owner.workflow.type.value,
                "kind": owner.workflow.kind.value if owner.workflow.kind is not None else None,
                "graph": normalize_execution_graph(snapshot.graph),
                "features": snapshot.features,
                "environment": owner.workflow._environment_variables,
                "conversation": owner.workflow._conversation_variables,
                "revision": execution_revision(owner.workflow),
            },
            "session": {
                "id": owner.session.id,
                "app_id": owner.session.app_id,
                "tenant_id": owner.session.tenant_id,
                "actor_id": owner.session.owner_account_id,
                "state": owner.session.current_state,
                "version": owner.session.version,
                "entry_mode": owner.session.entry_mode,
            },
            "test_input": {
                "id": owner.test_input.id,
                "session_id": owner.test_input.session_id,
                "inputs": owner.test_input.inputs,
                "fixtures": owner.test_input.http_fixtures,
                "source": owner.test_input.source,
                "start_schema_hash": owner.test_input.start_schema_hash,
            },
        }
    )


def _json_binding_digest(context: JsonToolExecutionContext) -> str:
    return InstalledJsonParse(
        **{field: getattr(context.qualified_tool, field) for field in InstalledJsonParse.__dataclass_fields__}
    ).binding_digest


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
    ) -> BuilderExecutionContext | JsonToolExecutionContext:
        json_values: dict[str, Any] | None = None
        json_state: str | None = None
        # JSON admission waits for qualified metadata; only the restricted
        # branch constructs its context inside the initial owner read.
        context: BuilderExecutionContext | None = None
        with self._session_factory() as db:
            owner = load_execution_owners(
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
            if _execution_snapshot(supplied) != _execution_snapshot(snapshot):
                raise BuilderExecutionPolicyError("stale_execution_revision")
            submitted_digest = scalar_inputs_digest(submitted_inputs)
            effective_digest = scalar_inputs_digest(effective_inputs)
            if submitted_digest != scalar_inputs_digest(owner.test_input.inputs):
                raise BuilderExecutionPolicyError("test_input_binding_mismatch")
            json_candidate = _is_json_parse_candidate(snapshot)
            admission = admit_json_workflow(snapshot) if json_candidate else None
            revision = execution_revision(owner.workflow)
            fixtures = decode_http_fixture_set(owner.test_input.http_fixtures)
            if fixtures is not None and fixtures.execution_revision != revision:
                raise BuilderExecutionPolicyError("stale_http_fixtures")
            if admission is not None:
                if fixtures is not None or owner.test_input.http_fixtures is not None:
                    raise BuilderExecutionPolicyError("unsupported_json_tool_configuration")
                owned_effective = _owned_effective_inputs(owner)
                if scalar_inputs_digest(owned_effective) != effective_digest:
                    raise BuilderExecutionPolicyError("effective_input_binding_mismatch")
                parameters = resolve_json_parameters(snapshot, owned_effective)
                json_state = _json_owner_state(owner, snapshot)
                json_values = {
                    "policy_version": "builder-json-parse-v1",
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
                    "mode": "restricted",
                    "sandbox_profile": "disabled",
                    "admitted_nodes": admission.nodes,
                    "final_parameters_digest": canonical_digest(parameters),
                }
            if json_values is None:
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
        check_execution_permission(actor, app_id, self._session_factory)
        if json_values is not None:
            assert json_state is not None
            installed = resolve_installed_json_parse(tenant_id=actor.tenant_id)
            check_execution_permission(actor, app_id, self._session_factory)
            qualified = QualifiedJsonToolBinding(
                node_id=json_values["admitted_nodes"][1].node_id,
                **{name: getattr(installed, name) for name in installed.__dataclass_fields__},
                final_parameters_digest=json_values.pop("final_parameters_digest"),
            )
            json_values["qualified_tool"] = qualified
            initial_json = JsonToolExecutionContext.model_validate({**json_values, "context_digest": "0" * 64})
            json_context = initial_json.model_copy(update={"context_digest": context_digest(initial_json)})
            with self._session_factory.begin() as db:
                owner = load_execution_owners(
                    db,
                    app_id=app_id,
                    actor=actor,
                    workflow_id=workflow.id,
                    session_id=session_id,
                    test_input_id=test_input_id,
                )
                current = restricted_admission_snapshot(owner.workflow, owner.app)
                if _json_owner_state(owner, current) != json_state:
                    raise BuilderExecutionPolicyError("stale_execution_revision")
                if scalar_inputs_digest(_owned_effective_inputs(owner)) != effective_digest:
                    raise BuilderExecutionPolicyError("effective_input_binding_mismatch")
                admit_execution_workflow(json_context, current)
                db.add(
                    DifyBuilderExecutionRequest(
                        id=json_context.request_id,
                        tenant_id=json_context.tenant_id,
                        app_id=json_context.app_id,
                        workflow_id=json_context.workflow_id,
                        actor_id=json_context.actor_id,
                        session_id=json_context.session_id,
                        test_input_id=json_context.test_input_id,
                        context=json_context.model_dump(mode="json"),
                        context_digest=json_context.context_digest,
                        state="prepared",
                        observations=[],
                    )
                )
            return json_context
        assert context is not None
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
        check_execution_permission(actor, app_id, self._session_factory)
        with self._session_factory() as db:
            owner = load_execution_owners(db, app_id=app_id, actor=actor)
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

    def prepare_confirmed(self, context: ConfirmedToolExecutionContext) -> ConfirmedToolExecutionContext:
        """Validate and reuse the consent owner's reserved sidecar; never allocates an ID.

        The context must be byte-identical to the stored, still-unlaunched
        sidecar, and the current owner chain, raw graph, revisions and saved
        test input must still match it. Grant/command authority stays with the
        consent owner (``reserved_launch``/``claim_tool``); this only refuses a
        sidecar that no longer describes the draft about to run.
        """
        if not isinstance(context, ConfirmedToolExecutionContext):
            raise BuilderExecutionPolicyError("unsupported_execution_policy")
        _validate_context(context)
        actor = Actor(account_id=context.actor_id, tenant_id=context.tenant_id)
        check_execution_permission(actor, context.app_id, self._session_factory)
        with self._session_factory() as db:
            row = _bound_request(db, context, lock=False)
            if row.state != "prepared" or row.native_run_id is not None or row.task_id is not None:
                raise BuilderExecutionPolicyError("execution_already_launched")
            owner = load_execution_owners(
                db,
                app_id=context.app_id,
                actor=actor,
                workflow_id=context.workflow_id,
                session_id=context.session_id,
                test_input_id=context.test_input_id,
            )
            snapshot = restricted_admission_snapshot(owner.workflow, owner.app)
            self._require_current_confirmed(context, owner, snapshot)
        return context

    @staticmethod
    def _require_current_confirmed(
        context: ConfirmedToolExecutionContext, owner: ExecutionOwnerSnapshot, snapshot: RestrictedAdmissionSnapshot
    ) -> None:
        if context.execution_revision != execution_revision(owner.workflow) or context.graph_revision != (
            executable_graph_revision(snapshot.graph)
        ):
            raise BuilderExecutionPolicyError("stale_execution_revision")
        test_input = owner.test_input
        if (
            test_input is None
            or test_input.http_fixtures is not None
            or scalar_inputs_digest(test_input.inputs) != context.submitted_inputs_digest
        ):
            raise BuilderExecutionPolicyError("test_input_binding_mismatch")
        admit_confirmed_workflow(context, snapshot)

    def claim_launch(self, *, context: ExecutionContext, native_run_id: str, task_id: str) -> None:
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
        context: ExecutionContext,
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
        if isinstance(context, JsonToolExecutionContext):
            admit_execution_workflow(context, supplied)
        actor = Actor(account_id=context.actor_id, tenant_id=context.tenant_id)
        check_execution_permission(actor, context.app_id, self._session_factory)
        json_state: str | None = None
        with self._session_factory() as db:
            row = _bound_request(db, context, lock=False)
            if row.state not in {"prepared", "running"}:
                raise BuilderExecutionPolicyError("execution_request_closed")
            owner = load_execution_owners(
                db,
                app_id=context.app_id,
                actor=actor,
                workflow_id=context.workflow_id,
                session_id=context.session_id,
                test_input_id=context.test_input_id,
            )
            snapshot = restricted_admission_snapshot(owner.workflow, owner.app)
            if isinstance(context, JsonToolExecutionContext):
                admit_execution_workflow(context, snapshot)
            if (
                _execution_snapshot(supplied) != _execution_snapshot(snapshot)
                or context.execution_revision != execution_revision(owner.workflow)
                or context.graph_revision != executable_graph_revision(snapshot.graph)
            ):
                raise BuilderExecutionPolicyError("stale_execution_revision")
            if isinstance(context, ConfirmedToolExecutionContext):
                self._require_current_confirmed(context, owner, snapshot)
                if scalar_inputs_digest(effective_inputs) != context.effective_inputs_digest:
                    raise BuilderExecutionPolicyError("effective_input_binding_mismatch")
                self._require_start_root(snapshot, root_node_id)
                return
            assert owner.test_input is not None
            if isinstance(context, JsonToolExecutionContext):
                if owner.test_input.http_fixtures is not None:
                    raise BuilderExecutionPolicyError("test_input_binding_mismatch")
                owned_effective = _owned_effective_inputs(owner)
                if (
                    scalar_inputs_digest(owner.test_input.inputs) != context.submitted_inputs_digest
                    or scalar_inputs_digest(owned_effective) != context.effective_inputs_digest
                    or scalar_inputs_digest(effective_inputs) != context.effective_inputs_digest
                ):
                    raise BuilderExecutionPolicyError("effective_input_binding_mismatch")
                expected = resolve_json_parameters(snapshot, owned_effective)
                if canonical_digest(expected) != context.qualified_tool.final_parameters_digest:
                    raise BuilderExecutionPolicyError("json_tool_parameters_changed")
                admit_execution_workflow(context, snapshot)
                self._require_start_root(snapshot, root_node_id)
                json_state = _json_owner_state(owner, snapshot)
            else:
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
                self._require_start_root(snapshot, root_node_id)
        if isinstance(context, JsonToolExecutionContext):
            assert json_state is not None
            installed = resolve_installed_json_parse(tenant_id=context.tenant_id)
            require_same_json_installation(context.qualified_tool, installed)
            check_execution_permission(actor, context.app_id, self._session_factory)
            with self._session_factory() as db:
                row = _bound_request(db, context, lock=False)
                if row.state not in {"prepared", "running"}:
                    raise BuilderExecutionPolicyError("execution_request_closed")
                owner = load_execution_owners(
                    db,
                    app_id=context.app_id,
                    actor=actor,
                    workflow_id=context.workflow_id,
                    session_id=context.session_id,
                    test_input_id=context.test_input_id,
                )
                current = restricted_admission_snapshot(owner.workflow, owner.app)
                if _json_owner_state(owner, current) != json_state:
                    raise BuilderExecutionPolicyError("stale_execution_revision")

    @staticmethod
    def _require_start_root(snapshot: RestrictedAdmissionSnapshot, root_node_id: str) -> None:
        root = next(node["id"] for node in snapshot.graph["nodes"] if node["data"]["type"] == "start")
        if root_node_id != root:
            raise BuilderExecutionPolicyError("unsupported_execution_root")

    def record(
        self,
        *,
        context: ExecutionContext,
        native_run_id: str,
        task_id: str,
        observation: BuilderExecutionObservation,
    ) -> None:
        try:
            observation = BuilderExecutionObservation.model_validate(observation.model_dump(mode="json"))
        except (ValidationError, ValueError, TypeError):
            raise BuilderExecutionPolicyError("invalid_execution_observation") from None
        if isinstance(context, ConfirmedToolExecutionContext):
            # A confirmed run serves no fixtures and blocks no effects: no observation is admissible.
            raise BuilderExecutionPolicyError("observation_binding_mismatch")
        if isinstance(context, JsonToolExecutionContext):
            binding_digest = _json_binding_digest(context)
            if (
                observation.kind != "qualified_json_completed"
                or observation.node_id != context.qualified_tool.node_id
                or observation.reason_code != "completed"
                or observation.native_node_execution_id != observation.observation_id
                or observation.invocation_id != observation.observation_id
                or observation.qualification_digest != context.qualified_tool.qualification_digest
                or observation.final_parameters_digest != context.qualified_tool.final_parameters_digest
                or observation.installed_binding_digest != binding_digest
                or observation.pre_binding_digest != binding_digest
                or observation.post_binding_digest != binding_digest
            ):
                raise BuilderExecutionPolicyError("observation_binding_mismatch")
        elif observation.kind == "qualified_json_completed":
            raise BuilderExecutionPolicyError("observation_binding_mismatch")
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
            if isinstance(context, BuilderExecutionContext) and observation.kind == "fixture_served":
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
            if isinstance(context, JsonToolExecutionContext) and observations:
                raise BuilderExecutionPolicyError("duplicate_execution_observation")
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
        json_installation_valid = False
        if isinstance(context, JsonToolExecutionContext):
            try:
                check_execution_permission(
                    Actor(account_id=context.actor_id, tenant_id=context.tenant_id),
                    context.app_id,
                    self._session_factory,
                )
                installed = resolve_installed_json_parse(tenant_id=context.tenant_id)
                require_same_json_installation(context.qualified_tool, installed)
                check_execution_permission(
                    Actor(account_id=context.actor_id, tenant_id=context.tenant_id),
                    context.app_id,
                    self._session_factory,
                )
                json_installation_valid = True
            except BuilderExecutionPolicyError:
                # A native Run may exist, but changed/unavailable metadata cannot seal it.
                pass
        with self._session_factory.begin() as db:
            row = _bound_request(db, context, lock=True)
            owner = load_execution_owners(
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
            if isinstance(context, ConfirmedToolExecutionContext):
                # The grant's recorded facts are read, never written, here; the consent
                # owner settles its own state from this sealed summary afterwards. They
                # are not fingerprinted: the first seal freezes the summary.
                summary = self._confirmed_summary(db, context, completion, row, native, nodes)
            elif isinstance(context, JsonToolExecutionContext):
                summary = self._json_summary(
                    request_id, context, completion, row, native, nodes, owner, json_installation_valid
                )
            else:
                summary = self._restricted_summary(request_id, context, completion, row, native, nodes)
            row.state = "sealed"
            row.completion_fingerprint = fingerprint
            row.completion_summary = summary.model_dump(mode="json")
            row.sealed_at = naive_utc_now()
            return summary

    def _json_summary(
        self,
        request_id: str,
        context: JsonToolExecutionContext,
        completion: TrustedExecutionCompletion,
        row: DifyBuilderExecutionRequest,
        native: WorkflowRun | None,
        nodes: list[WorkflowNodeExecutionModel],
        owner: ExecutionOwnerSnapshot,
        installation_valid: bool,
    ) -> ExecutionEvidenceSummary:
        """Seal only composed SQL/native evidence with its one in-process receipt."""
        outcome = "execution_evidence_unknown"
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
        elif (
            installation_valid
            and completion.worker_finished
            and completion.worker_exit == "returned"
            and completion.response_completed
            and completion.recorder_healthy
            and native is not None
            and self._json_native_proof(context, row, native, nodes, owner)
        ):
            outcome = "restricted_execution_completed"
        return ExecutionEvidenceSummary(
            request_id=request_id,
            policy_version=context.policy_version,
            mode="restricted",
            sealed=True,
            safety_outcome=outcome,
            sandbox_profile="disabled",
            native_run_id=native.id if native is not None else None,
        )

    @staticmethod
    def _json_native_proof(
        context: JsonToolExecutionContext,
        row: DifyBuilderExecutionRequest,
        native: WorkflowRun,
        nodes: list[WorkflowNodeExecutionModel],
        owner: ExecutionOwnerSnapshot,
    ) -> bool:
        """Require the exact Start/Tool/End SQL chain and Tool TEXT receipt."""
        from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY

        try:
            snapshot = restricted_admission_snapshot(owner.workflow, owner.app)
            admission = admit_json_workflow(snapshot)
            if (
                execution_revision(owner.workflow) != context.execution_revision
                or executable_graph_revision(snapshot.graph) != context.graph_revision
                or admission.nodes != context.admitted_nodes
                or owner.test_input is None
                or owner.test_input.http_fixtures is not None
                or scalar_inputs_digest(owner.test_input.inputs) != context.submitted_inputs_digest
            ):
                return False
            owned_effective = _owned_effective_inputs(owner)
            if (
                scalar_inputs_digest(owned_effective) != context.effective_inputs_digest
                or canonical_digest(resolve_json_parameters(snapshot, owned_effective))
                != context.qualified_tool.final_parameters_digest
            ):
                return False
            graph = _raw_object(native.graph, "invalid_native_graph")
            native_snapshot = RestrictedAdmissionSnapshot(
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
                admit_json_workflow(native_snapshot).nodes != context.admitted_nodes
                or executable_graph_revision(graph) != context.graph_revision
            ):
                return False
            inputs = _raw_object(native.inputs, "invalid_native_inputs")
            if scalar_inputs_digest({k: v for k, v in inputs.items() if not k.startswith("sys.")}) != (
                context.effective_inputs_digest
            ):
                return False
            if (
                native.status != "succeeded"
                or native.finished_at is None
                or native.error
                or native.total_steps != 3
                or native.exceptions_count != 0
                or len(nodes) != 3
                or len(row.observations) != 1
            ):
                return False
            receipt = BuilderExecutionObservation.model_validate(row.observations[0])
            if (
                receipt.kind != "qualified_json_completed"
                or receipt.reason_code != "completed"
                or receipt.request_id != context.request_id
                or receipt.node_id != context.qualified_tool.node_id
                or receipt.qualification_digest != context.qualified_tool.qualification_digest
                or receipt.final_parameters_digest != context.qualified_tool.final_parameters_digest
                or receipt.installed_binding_digest != _json_binding_digest(context)
                or receipt.pre_binding_digest != receipt.installed_binding_digest
                or receipt.post_binding_digest != receipt.installed_binding_digest
                or receipt.observation_id != receipt.invocation_id
                or receipt.observation_id != receipt.native_node_execution_id
                or receipt.implementation_version
                != f"{context.admitted_nodes[1].implementation}:{context.admitted_nodes[1].node_version}"
            ):
                return False
            ordered = sorted(nodes, key=lambda node: node.index)
            ids = [binding.node_id for binding in context.admitted_nodes]
            if (
                [node.node_id for node in ordered] != ids
                or [node.index for node in ordered] != [1, 2, 3]
                or len({node.node_execution_id for node in ordered}) != 3
                or any(node.node_execution_id is None for node in ordered)
                or [node.node_type for node in ordered] != ["start", "tool", "end"]
                or any(node.status != "succeeded" or node.finished_at is None or node.error for node in ordered)
                or ordered[0].predecessor_node_id not in {None, ""}
                or ordered[1].predecessor_node_id not in {None, ids[0]}
                or ordered[2].predecessor_node_id not in {None, ids[1]}
                or receipt.native_node_execution_id != ordered[1].node_execution_id
            ):
                return False
            for node in ordered:
                process = _raw_object(node.process_data, "invalid_native_retries", absent_allowed=True)
                if process.get(RETRY_HISTORY_PROCESS_DATA_KEY):
                    return False
            tool_outputs = _raw_object(ordered[1].outputs, "invalid_native_outputs")
            text = tool_outputs.get("text")
            if type(text) is not str or receipt.native_text_output_digest != canonical_digest(text):
                return False
            if receipt.text_bytes != len(text.encode("utf-8")):
                return False
            end_outputs = _raw_object(ordered[2].outputs, "invalid_native_outputs")
            run_outputs = _raw_object(native.outputs, "invalid_native_outputs")
            end_data = next(node["data"] for node in graph["nodes"] if node["id"] == ids[2])
            expected_outputs: dict[str, Any] = {}
            for output in end_data["outputs"]:
                selector = output["value_selector"]
                expected_outputs[output["variable"]] = (
                    text if selector == [ids[1], "text"] else owned_effective[selector[1]]
                )
            return end_outputs == expected_outputs and run_outputs == expected_outputs
        except (
            BuilderExecutionPolicyError,
            ValidationError,
            ValueError,
            TypeError,
            KeyError,
            StopIteration,
            UnicodeError,
        ):
            return False

    def _confirmed_summary(
        self,
        db: Session,
        context: ConfirmedToolExecutionContext,
        completion: TrustedExecutionCompletion,
        row: DifyBuilderExecutionRequest,
        native: WorkflowRun | None,
        nodes: list[WorkflowNodeExecutionModel],
    ) -> ExecutionEvidenceSummary:
        """Completed only with matching native rows, a healthy recorder and a completed action.

        Unknown first: native success with an unknown or unrecorded action, a
        stranded claim without a known pre-phase denial, or any mismatch stays
        ``execution_evidence_unknown``. Native failure is reported only when the
        grant never spent a phase or recorded a known failure.
        """
        consent = db.scalar(
            select(DifyBuilderRealCallConsent).where(
                DifyBuilderRealCallConsent.id == context.consent_id,
                DifyBuilderRealCallConsent.tenant_id == context.tenant_id,
                DifyBuilderRealCallConsent.actor_id == context.actor_id,
                DifyBuilderRealCallConsent.session_id == context.session_id,
                DifyBuilderRealCallConsent.command_id == context.command_id,
                DifyBuilderRealCallConsent.execution_request_id == context.request_id,
            )
        )
        if consent is None:
            raise BuilderExecutionPolicyError("execution_request_mismatch")
        action_state = consent.outcome_state if consent.outcome_state in {"completed", "failed", "unknown"} else None
        if consent.state == "unknown":
            action_state = "unknown"
        reason = consent.reason_code if action_state is not None else None
        if reason is not None and not _REASON_CODE.fullmatch(reason):
            reason = "invalid_outcome_input"
        spent = consent.refresh_claimed_at is not None or consent.business_claimed_at is not None
        claimed = consent.claimed_at is not None
        outcome = "execution_evidence_unknown"
        if (
            native is None
            and not claimed
            and completion.refusal is not None
            and completion.response_completed
            and (
                completion.preworker_refusal
                or (completion.worker_finished and completion.worker_exit == "policy_refused")
            )
        ):
            outcome = "unsupported_safe_execution"
        elif (
            native is not None
            and completion.worker_finished
            and completion.response_completed
            and completion.recorder_healthy
            and completion.worker_exit in {"returned", "stopped", "failed"}
            and not row.observations
            and self._confirmed_native_proof(context, native, nodes, consent)
        ):
            uncertain = action_state == "unknown" or (spent and action_state is None)
            if uncertain:
                outcome = "execution_evidence_unknown"
            elif native.status == "succeeded":
                if action_state == "completed" and consent.state == "claimed":
                    outcome = "confirmed_tool_completed"
            elif action_state != "completed" and (
                not claimed or action_state == "failed" or (consent.state == "failed" and not spent)
            ):
                outcome = "native_failed"
        return ExecutionEvidenceSummary(
            request_id=context.request_id,
            policy_version=context.policy_version,
            mode=context.mode,
            sealed=True,
            safety_outcome=outcome,
            sandbox_profile=context.sandbox_profile,
            native_run_id=native.id if native is not None else None,
            consent_id=context.consent_id,
            action_state=action_state,
            action_reason_code=reason,
        )

    @staticmethod
    def _confirmed_native_proof(
        context: ConfirmedToolExecutionContext,
        native: WorkflowRun,
        nodes: list[WorkflowNodeExecutionModel],
        consent: DifyBuilderRealCallConsent,
    ) -> bool:
        """Exact admitted graph, inputs, ordered Start/Tool/End rows and the claimed Tool row."""
        from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY

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
            admission = gmail_read_policy.admit_get_message_workflow(snapshot)
            if admission.nodes != context.admitted_nodes or executable_graph_revision(graph) != context.graph_revision:
                return False
            inputs = _raw_object(native.inputs, "invalid_native_inputs")
            if (
                scalar_inputs_digest({k: v for k, v in inputs.items() if not k.startswith("sys.")})
                != context.effective_inputs_digest
            ):
                return False
            if native.status not in {"succeeded", "failed", "stopped", "partial-succeeded"} or not native.finished_at:
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
            expected = [binding.node_id for binding in context.admitted_nodes]
            types = {n["id"]: n["data"]["type"] for n in graph["nodes"]}
            ordered = sorted(nodes, key=lambda n: n.index)
            previous: str | None = None
            for index, node in enumerate(ordered, 1):
                if (
                    node.node_id != expected[index - 1]
                    or node.index != index
                    or node.node_type != types[node.node_id]
                    or node.predecessor_node_id not in ({None, ""} if previous is None else {None, previous})
                ):
                    return False
                process = _raw_object(node.process_data, "invalid_native_retries", absent_allowed=True)
                if process.get(RETRY_HISTORY_PROCESS_DATA_KEY):
                    return False
                previous = node.node_id
            if native.total_steps != len(nodes):
                return False
            tool = next((n for n in nodes if n.node_id == admission.tool_node_id), None)
            if consent.claimed_at is not None and (
                consent.native_run_id != native.id
                or tool is None
                or consent.native_node_execution_id != tool.node_execution_id
            ):
                return False
            if native.status == "succeeded" and (
                len(nodes) != len(expected)
                or native.exceptions_count != 0
                or any(n.status != "succeeded" for n in nodes)
            ):
                return False
            return True
        except (BuilderExecutionPolicyError, ValidationError, ValueError, TypeError, KeyError, IndexError):
            return False

    def _restricted_summary(
        self,
        request_id: str,
        context: BuilderExecutionContext,
        completion: TrustedExecutionCompletion,
        row: DifyBuilderExecutionRequest,
        native: WorkflowRun | None,
        nodes: list[WorkflowNodeExecutionModel],
    ) -> ExecutionEvidenceSummary:
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
        if complete and native is not None:
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
        return ExecutionEvidenceSummary(
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
        self, *, context: ExecutionContext, native_run_id: str, task_id: str
    ) -> "ServiceExecutionRecorder | JsonLaunchRecorder":
        delegate = ServiceExecutionRecorder(self, context, native_run_id, task_id)
        if isinstance(context, JsonToolExecutionContext):
            return JsonLaunchRecorder(self, delegate, context, native_run_id, task_id)
        return delegate

    def issue_json_runtime_binding(
        self,
        *,
        context: JsonToolExecutionContext,
        native_run_id: str,
        task_id: str,
        native_node_execution_id: str,
        node_id: str,
        recorder: "JsonLaunchRecorder",
    ) -> JsonRuntimeBinding:
        """Bind Graphon's actual node execution ID to the persisted launch owner."""
        if node_id != context.qualified_tool.node_id or not recorder.healthy:
            raise BuilderExecutionPolicyError("execution_launch_mismatch")
        _ID_ADAPTER.validate_python(native_node_execution_id)
        actor = Actor(account_id=context.actor_id, tenant_id=context.tenant_id)
        with self._session_factory() as db:
            row = _bound_request(db, context, lock=False)
            if (row.state, row.native_run_id, row.task_id, row.observations) != (
                "running",
                native_run_id,
                task_id,
                [],
            ):
                raise BuilderExecutionPolicyError("execution_launch_mismatch")
            owner = load_execution_owners(
                db,
                app_id=context.app_id,
                actor=actor,
                workflow_id=context.workflow_id,
                session_id=context.session_id,
                test_input_id=context.test_input_id,
            )
            snapshot = restricted_admission_snapshot(owner.workflow, owner.app)
            admit_execution_workflow(context, snapshot)
            if (
                context.execution_revision != execution_revision(owner.workflow)
                or context.graph_revision != executable_graph_revision(snapshot.graph)
                or owner.test_input is None
                or owner.test_input.http_fixtures is not None
                or scalar_inputs_digest(owner.test_input.inputs) != context.submitted_inputs_digest
            ):
                raise BuilderExecutionPolicyError("stale_execution_revision")
            owned_effective = _owned_effective_inputs(owner)
            if scalar_inputs_digest(owned_effective) != context.effective_inputs_digest:
                raise BuilderExecutionPolicyError("effective_input_binding_mismatch")
            admit_execution_workflow(context, snapshot)
            expected = resolve_json_parameters(snapshot, owned_effective)
            if canonical_digest(expected) != context.qualified_tool.final_parameters_digest:
                raise BuilderExecutionPolicyError("json_tool_parameters_changed")
        return JsonRuntimeBinding(
            context=context,
            native_run_id=native_run_id,
            native_task_id=task_id,
            native_node_execution_id=native_node_execution_id,
            expected_parameters=expected,
            recorder=recorder,
        )


@dataclass(frozen=True)
class ServiceExecutionRecorder:
    """Immutable captured launch identity with a monotonic local failure latch."""

    _service: BuilderExecutionPolicyService
    _context: ExecutionContext
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


@dataclass(frozen=True)
class JsonLaunchRecorder(JsonToolRuntimeIssuer):
    """In-process authority for exactly one persisted JSON launch and native node."""

    _service: BuilderExecutionPolicyService
    _delegate: ServiceExecutionRecorder
    _context: JsonToolExecutionContext
    _native_run_id: str
    _task_id: str
    _issued: bool = field(default=False, init=False)

    @property
    def healthy(self) -> bool:
        return self._delegate.healthy

    @property
    def native_task_id(self) -> str:
        return self._task_id

    def record(self, observation: BuilderExecutionObservation) -> None:
        self._delegate.record(observation)

    def json_runtime_binding(
        self, *, node_id: str, native_run_id: str, native_node_execution_id: str
    ) -> JsonRuntimeBinding:
        if self._issued or native_run_id != self._native_run_id:
            raise BuilderExecutionPolicyError("execution_launch_mismatch")
        object.__setattr__(self, "_issued", True)
        return self._service.issue_json_runtime_binding(
            context=self._context,
            native_run_id=native_run_id,
            task_id=self._task_id,
            native_node_execution_id=native_node_execution_id,
            node_id=node_id,
            recorder=self,
        )
