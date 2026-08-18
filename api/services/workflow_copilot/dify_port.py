"""The real ``DifyPort`` adapter -- direct in-process calls into Dify's own services.

Port of dify-enterprise/server/pkg/enterprise/data/copilot_dify.go, minus the
token-forwarding (the P1 port plan's Global Constraints / ADR drop
``ForwardAuth`` entirely -- see ``core.workflow_copilot.ports.DifyPort``).

``WorkflowServiceDifyPort`` wires the pure P1 domain (``core.workflow_copilot``)
and the pure Task 1-3 helpers in this package (``graph_ops``, ``run_mapping``,
``identity``) to ``WorkflowService`` / ``AppGenerateService`` / the node-
execution repository. It satisfies ``DifyPort`` structurally (the Protocol is
``@runtime_checkable``) -- there is no explicit inheritance, matching
``PlaceholderAgent``'s relationship to ``CopilotAgent``.

Each method opens its own ``Session`` via
``sessionmaker(bind=db.engine, expire_on_commit=False)`` and resolves
account/app through the Task 3 helpers. The OSS gotchas baked in here (see
the P2 plan's Global Constraints):

- ``sync_draft_workflow`` has no server-side patch primitive -- ``apply_repair``
  reads the whole draft graph, mutates it client-side via
  ``graph_ops.apply_set_node_config``, and writes the whole mutated graph
  back with ``graph_only=True``/``sync_agent_bindings=False`` so only the
  graph changes, nothing else. A ``WorkflowHashNotEqualError`` (the draft
  changed since it was read) is re-mapped to the domain ``HashMismatchError``.
- ``run_draft`` invokes ``AppGenerateService.generate`` with
  ``invoke_from=InvokeFrom.DEBUGGER`` (runs the *draft*, not the published
  workflow) and ``streaming=False`` (blocks in-process -- safe to call from a
  worker/Celery task, no SSE plumbing needed).
- ``publish`` MUST update ``app.workflow_id`` in the same transaction as
  ``publish_workflow``: ``publish_workflow`` only creates the new published
  ``Workflow`` row: it does not repoint the app at it. Skipping that update
  makes publish a silent no-op. The agent-retirement tail
  (``WorkflowAgentRetirementService.retire_unowned`` /
  ``enqueue_agent_resource_collection``) is intentionally skipped -- it only
  matters for Agent-node workflows and is not part of this port's contract.
"""

from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow_copilot.models import (
    Actor,
    ApplyResult,
    Graph,
    Inputs,
    MutationIntent,
    NodeEvent,
    NodeOutput,
    Run,
)
from extensions.ext_database import db
from models.model import App
from models.workflow import Workflow
from repositories.factory import DifyAPIRepositoryFactory
from services.app_generate_service import AppGenerateService
from services.errors.app import WorkflowHashNotEqualError
from services.workflow_copilot.errors import HashMismatchError, WorkflowNotInitializedError
from services.workflow_copilot.graph_ops import apply_set_node_config
from services.workflow_copilot.identity import load_app, resolve_account
from services.workflow_copilot.run_mapping import map_run_result, to_node_event
from services.workflow_service import WorkflowService

__all__ = ["WorkflowServiceDifyPort"]


def _session_factory() -> sessionmaker[Session]:
    """One session per adapter call -- never shared/held across calls."""
    return sessionmaker(bind=db.engine, expire_on_commit=False)


def _unwrap_status(status: Any) -> Any:
    """Unwrap a ``graphon`` ``StrEnum``'s ``.value`` if present, else pass through.

    Mirrors ``run_mapping._status_value`` locally so this module doesn't reach
    into another module's private helper.
    """
    return getattr(status, "value", status)


def _load_draft_workflow_or_raise(app: App, *, session: Session) -> Workflow:
    workflow = WorkflowService().get_draft_workflow(app, session=session)
    if workflow is None:
        raise WorkflowNotInitializedError(f"app has no draft workflow: {app.id}")
    return workflow


class WorkflowServiceDifyPort:
    """``DifyPort`` implementation backed directly by Dify's own services."""

    def read_graph(self, app_id: str, actor: Actor) -> tuple[Graph, str]:
        with _session_factory()() as session:
            app = load_app(session, app_id, actor)
            workflow = _load_draft_workflow_or_raise(app, session=session)
            return dict(workflow.graph_dict), workflow.unique_hash

    def node_outputs(self, app_id: str, actor: Actor, run_id: str) -> list[NodeOutput]:
        with _session_factory()() as session:
            app = load_app(session, app_id, actor)
            tenant_id = app.tenant_id

        node_execs = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            sessionmaker(bind=db.engine)
        ).get_executions_by_workflow_run(tenant_id, app_id, run_id)

        return [
            NodeOutput(
                node_id=node_exec.node_id,
                title=node_exec.title,
                status=_unwrap_status(node_exec.status),
                error=node_exec.error or "",
                inputs=node_exec.inputs_dict or {},
                outputs=node_exec.outputs_dict or {},
            )
            for node_exec in node_execs
        ]

    def apply_repair(self, app_id: str, actor: Actor, intents: list[MutationIntent]) -> ApplyResult:
        with _session_factory()() as session:
            account = resolve_account(session, actor)
            app = load_app(session, app_id, actor)
            workflow = _load_draft_workflow_or_raise(app, session=session)

            graph: Graph = dict(workflow.graph_dict)
            unique_hash = workflow.unique_hash
            changed_nodes: list[str] = []
            for intent in intents:
                if intent.op != "set_node_config":
                    continue
                graph, changed = apply_set_node_config(
                    graph, intent.args["node_id"], intent.args["path"], intent.args["value"]
                )
                changed_nodes.extend(changed)

            try:
                updated = WorkflowService().sync_draft_workflow(
                    app_model=app,
                    graph=graph,
                    features=dict(workflow.features_dict),
                    unique_hash=unique_hash,
                    account=account,
                    environment_variables=[],
                    conversation_variables=workflow.conversation_variables,
                    session=session,
                    graph_only=True,
                    sync_agent_bindings=False,
                    commit=True,
                    preserve_environment_variables=True,
                )
            except WorkflowHashNotEqualError as exc:
                raise HashMismatchError(f"draft workflow changed since read: {app_id}") from exc

            return ApplyResult(changed_nodes=changed_nodes, new_hash=updated.unique_hash)

    def run_draft(self, app_id: str, actor: Actor, inputs: Inputs, on_event: Callable[[NodeEvent], None]) -> Run:
        with _session_factory()() as session:
            account = resolve_account(session, actor)
            app = load_app(session, app_id, actor)
            tenant_id = app.tenant_id

            response = AppGenerateService.generate(
                app_model=app,
                user=account,
                args={"inputs": inputs},
                invoke_from=InvokeFrom.DEBUGGER,
                session=session,
                streaming=False,
            )

        data = response["data"]
        run_id = data["id"]

        node_execs = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            sessionmaker(bind=db.engine)
        ).get_executions_by_workflow_run(tenant_id, app_id, run_id)

        for node_exec in node_execs:
            on_event(to_node_event(node_exec))

        return map_run_result(data, node_execs)

    def publish(self, app_id: str, actor: Actor) -> None:
        with _session_factory()() as session:
            account = resolve_account(session, actor)
            app = load_app(session, app_id, actor)

            workflow, _retirement_candidates = WorkflowService().publish_workflow(
                session=session,
                app_model=app,
                account=account,
            )

            app_in_session = session.get(App, app_id)
            assert app_in_session is not None, f"app disappeared mid-transaction: {app_id}"
            app_in_session.workflow_id = workflow.id

            session.commit()
