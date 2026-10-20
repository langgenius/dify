"""Current saved-input identity for Console; never a source of execution authority."""

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.input_schema import schema_hash, start_schema
from core.dify_builder.models import Actor
from core.dify_builder.state import PcState, is_working
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession, DifyBuilderSessionCommit
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from services.dify_builder.execution_policy_service import check_execution_permission, load_execution_owners
from services.dify_builder.native_testing.public_contracts import NativeTestInputBinding
from services.dify_builder.native_testing.repository import native_workflow_revision


def current_input_binding(*, session: Session, actor: Actor, session_id: str) -> NativeTestInputBinding:
    """Validate the exact current commit and complete local ownership chain.

    Callers recheck permissions outside SQL; admission repeats this read while
    holding its existing session lock. A retained input is never a current one.
    """
    builder = session.get(DifyBuilderSession, session_id)
    if builder is None:
        raise BuilderExecutionPolicyError("native_owner_mismatch")
    owner = load_execution_owners(session, actor=actor, app_id=builder.app_id, session_id=session_id)
    try:
        working = is_working(PcState(builder.current_state))
    except ValueError:
        raise BuilderExecutionPolicyError("native_session_busy") from None
    if working:
        raise BuilderExecutionPolicyError("native_session_busy")
    commit = session.scalar(
        select(DifyBuilderSessionCommit).where(
            DifyBuilderSessionCommit.session_id == session_id,
            DifyBuilderSessionCommit.version == builder.version,
        )
    )
    input_id = commit.context.get("test_input_ref") if commit is not None else None
    if not isinstance(input_id, str) or not input_id:
        raise BuilderExecutionPolicyError("native_current_input_unavailable")
    owner = load_execution_owners(
        session, actor=actor, app_id=builder.app_id, session_id=session_id, test_input_id=input_id
    )
    if (
        owner.test_input is None
        or owner.app.mode != "workflow"
        or owner.workflow.kind_or_standard != "standard"
        or owner.test_input.start_schema_hash
        != schema_hash(start_schema(dict(owner.workflow.graph_dict), owner.app.mode))
    ):
        raise BuilderExecutionPolicyError("native_revision_drift")
    active = session.scalar(
        select(DifyBuilderExecutionRequest.id)
        .where(
            DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
            DifyBuilderExecutionRequest.actor_id == actor.account_id,
            DifyBuilderExecutionRequest.session_id == session_id,
            DifyBuilderExecutionRequest.test_input_id == input_id,
            DifyBuilderExecutionRequest.state.in_(("prepared", "running", "waiting")),
        )
        .limit(1)
    )
    if active is not None:
        raise BuilderExecutionPolicyError("native_session_busy")
    return NativeTestInputBinding(
        test_input_id=input_id,
        expected_version=builder.version,
        workflow_id=owner.workflow.id,
        graph_revision=native_workflow_revision(owner.workflow),
    )


class NativeTestInputBindingService:
    def __init__(self, *, session_factory: sessionmaker[Session], actor: Actor):
        self.sessions, self.actor = session_factory, actor

    def get(self, *, session_id: str) -> NativeTestInputBinding:
        with self.sessions() as session:
            binding = current_input_binding(session=session, actor=self.actor, session_id=session_id)
            builder = session.get(DifyBuilderSession, session_id)
            assert builder is not None
            app_id = builder.app_id
        check_execution_permission(self.actor, app_id, self.sessions)
        return binding
