"""Adapt existing Builder actions to the durable native command owners.

No start implementation lives here: run_test keeps the ordinary input and
run_draft path. Browser payloads identify a disclosed operation, never authority.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal, Protocol
from uuid import NAMESPACE_URL, uuid5

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.errors import BadRequestError, ConflictError
from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderConversationItem, DifyBuilderExecutionRequest, DifyBuilderSession
from models.dify_builder_native_tests import (
    NativeInvocationState,
    NativePayloadObject,
    NativeTestInvocation,
    NativeTestScope,
)
from models.enums import CreatorUserRole
from models.workflow import WorkflowRun
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, Digest, canonical_digest
from runtime_contracts.builder.native.contracts import ID, Counter, FrozenDTO
from runtime_contracts.builder.native.observation import parse_native_model_failure
from services.dify_builder import trace_diagnostics
from services.dify_builder.execution_policy_service import load_execution_owners
from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt

if TYPE_CHECKING:
    from services.dify_builder.native_testing.confirmed_agent_commands import ProfiledNativeTestCommands

TEST_ACTIONS = frozenset({"confirm_test_operation", "deny_test_operation", "resume_test", "cancel_test"})


class TestOperationPayload(FrozenDTO):
    request_id: ID
    pending_operation_id: ID
    pending_version: Counter
    scope_digest: Digest


class TestResumePayload(FrozenDTO):
    request_id: ID
    expected_generation: Counter


class TestCancelPayload(FrozenDTO):
    request_id: ID


@dataclass(frozen=True)
class TestCommand:
    method: Literal["decide", "resume", "cancel"]
    request_id: str
    native_payload: dict[str, Any]


def parse_test_action(kind: str, payload: dict[str, Any]) -> TestCommand:
    if "option_id" in payload:
        if payload["option_id"] != kind:
            raise BadRequestError("test choice does not match the selected action")
        payload = {key: value for key, value in payload.items() if key != "option_id"}
    try:
        if kind in {"confirm_test_operation", "deny_test_operation"}:
            operation = TestOperationPayload.model_validate(payload)
            return TestCommand(
                "decide",
                operation.request_id,
                {
                    "pending_operation_id": operation.pending_operation_id,
                    "expected_version": operation.pending_version,
                    "scope_digest": operation.scope_digest,
                    "decision": "confirm" if kind == "confirm_test_operation" else "deny",
                },
            )
        if kind == "resume_test":
            resume = TestResumePayload.model_validate(payload)
            return TestCommand("resume", resume.request_id, {"expected_generation": resume.expected_generation})
        if kind == "cancel_test":
            cancel = TestCancelPayload.model_validate(payload)
            return TestCommand("cancel", cancel.request_id, {})
    except ValidationError:
        raise BadRequestError("invalid test action payload") from None
    raise BadRequestError("unsupported test action")


class TestActionPort(Protocol):
    def find_command(self, *, actor: Actor, session_id: str, command_id: str) -> dict[str, Any] | None: ...

    def settle(self, *, actor: Actor, session_id: str, request_id: str) -> None: ...

    def current(self, *, actor: Actor, session_id: str, test_input_id: str) -> NativeTestPublicReceipt | None: ...

    def observation_initializing(self, *, actor: Actor, session_id: str, test_input_id: str) -> bool: ...

    def current_diagnostics(
        self, *, actor: Actor, session_id: str, test_input_id: str, receipt: NativeTestPublicReceipt
    ) -> list[dict[str, Any]]: ...

    def execute(
        self, *, actor: Actor, session_id: str, test_input_id: str, command: TestCommand, idempotency_key: str
    ) -> NativeTestPublicReceipt: ...


class BuilderTestActions:
    """Only control the current saved-input attempt; GET never reconciles work."""

    def __init__(self, sessions: sessionmaker[Session], command_factory: Callable[..., "ProfiledNativeTestCommands"]):
        self.sessions = sessions
        self.command_factory = command_factory

    def find_command(self, *, actor: Actor, session_id: str, command_id: str) -> dict[str, Any] | None:
        with self.sessions() as sql:
            return sql.scalar(
                select(DifyBuilderConversationItem.payload)
                .join(DifyBuilderSession, DifyBuilderSession.id == DifyBuilderConversationItem.session_id)
                .where(
                    DifyBuilderSession.id == session_id,
                    DifyBuilderSession.tenant_id == actor.tenant_id,
                    DifyBuilderSession.owner_account_id == actor.account_id,
                    DifyBuilderConversationItem.kind == "decision",
                    DifyBuilderConversationItem.payload["test_command_id"].as_string() == command_id,
                )
                .limit(1)
            )

    def settle(self, *, actor: Actor, session_id: str, request_id: str) -> None:
        self.command_factory(actor=actor).settle_builder(actor=actor, session_id=session_id, request_id=request_id)

    def _current_id(self, *, actor: Actor, session_id: str, test_input_id: str) -> str | None:
        if not test_input_id:
            return None
        with self.sessions() as sql:
            return sql.scalar(
                select(DifyBuilderExecutionRequest.id)
                .where(
                    DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == actor.account_id,
                    DifyBuilderExecutionRequest.session_id == session_id,
                    DifyBuilderExecutionRequest.test_input_id == test_input_id,
                    DifyBuilderExecutionRequest.context["policy_version"].as_string() == "builder-native-test-v1",
                )
                .order_by(DifyBuilderExecutionRequest.created_at.desc(), DifyBuilderExecutionRequest.id.desc())
                .limit(1)
            )

    def current(self, *, actor: Actor, session_id: str, test_input_id: str) -> NativeTestPublicReceipt | None:
        request_id = self._current_id(actor=actor, session_id=session_id, test_input_id=test_input_id)
        if request_id is None:
            return None
        return self.command_factory(actor=actor).peek(actor=actor, session_id=session_id, request_id=request_id)

    def observation_initializing(self, *, actor: Actor, session_id: str, test_input_id: str) -> bool:
        """Defer SSE projection only before admission acknowledges its first context.

        This never substitutes a public receipt or authorizes a command. Context
        acknowledgement and root-state insertion share a transaction; a retained
        context therefore rules out treating a missing initialized root as startup.
        """
        request_id = self._current_id(actor=actor, session_id=session_id, test_input_id=test_input_id)
        if request_id is None:
            return False
        with self.sessions() as sql:
            request = sql.get(DifyBuilderExecutionRequest, request_id)
            builder = sql.get(DifyBuilderSession, session_id)
            scope = sql.get(NativeTestScope, request_id)
            if (
                request is None
                or builder is None
                or scope is None
                or (request.tenant_id, request.actor_id, request.session_id, request.test_input_id, request.app_id)
                != (actor.tenant_id, actor.account_id, session_id, test_input_id, builder.app_id)
                or (builder.tenant_id, builder.owner_account_id) != (actor.tenant_id, actor.account_id)
                or request.state != "running"
                or request.native_run_id is not None
                or scope.tenant_id != actor.tenant_id
                or scope.generation != 0
                or not scope.task_approved
                or scope.cancelled
                or (scope.expires_at.replace(tzinfo=UTC) if scope.expires_at.tzinfo is None else scope.expires_at)
                <= datetime.now(UTC)
                or canonical_digest(request.context) != request.context_digest
            ):
                return False
            # Ordinary confirmed Run admission has no command receipt yet; its
            # first context ACK and root state are written atomically by admission initialization.
            ordinary_initial = (
                request.observations == []
                and request.context.get("profile", {}).get("profile_id") == "builder-agent-confirmed-v1"
                and request.context.get("revision_basis") == "confirmed-canvas-v1"
            )
            if not ordinary_initial:
                if len(request.observations) != 1:
                    return False
                record = request.observations[0]
                if (
                    not isinstance(record, dict)
                    or not record.get("native_command_key")
                    or not record.get("body_digest")
                    or record.get("admission_launched") is not None
                ):
                    return False
                try:
                    receipt = NativeTestPublicReceipt.model_validate(record.get("receipt"))
                except ValidationError:
                    return False
                if (receipt.request_id, receipt.generation, receipt.version, receipt.status, receipt.native_run_id) != (
                    request_id,
                    0,
                    1,
                    "prepared",
                    None,
                ):
                    return False
                if (
                    receipt.wait_reason,
                    receipt.native_status,
                    receipt.pending,
                    receipt.outcome,
                    receipt.evidence_refs,
                    receipt.cancellation,
                    receipt.can_resume,
                ) != (None, None, (), None, (), None, False):
                    return False
            invocations = list(
                sql.scalars(select(NativeTestInvocation).where(NativeTestInvocation.request_id == request_id))
            )
            if len(invocations) != 1:
                return False
            invocation = invocations[0]
            if (
                invocation.tenant_id != actor.tenant_id
                or not invocation.active
                or invocation.bindings
                or invocation.invocation_id != request.context.get("invocation_id")
            ):
                return False
            return (
                sql.scalar(
                    select(NativeInvocationState.id).where(NativeInvocationState.request_id == request_id).limit(1)
                )
                is None
                and sql.scalar(
                    select(NativePayloadObject.id)
                    .where(NativePayloadObject.request_id == request_id, NativePayloadObject.kind == "context")
                    .limit(1)
                )
                is None
            )

    def current_diagnostics(
        self, *, actor: Actor, session_id: str, test_input_id: str, receipt: NativeTestPublicReceipt
    ) -> list[dict[str, Any]]:
        """Observe only the current owned parent; never reconcile or inspect child I/O."""
        try:
            with self.sessions() as sql:
                request = sql.scalar(
                    select(DifyBuilderExecutionRequest)
                    .where(
                        DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                        DifyBuilderExecutionRequest.actor_id == actor.account_id,
                        DifyBuilderExecutionRequest.session_id == session_id,
                        DifyBuilderExecutionRequest.test_input_id == test_input_id,
                        DifyBuilderExecutionRequest.context["policy_version"].as_string() == "builder-native-test-v1",
                    )
                    .order_by(DifyBuilderExecutionRequest.created_at.desc(), DifyBuilderExecutionRequest.id.desc())
                    .limit(1)
                )
                if request is None or request.id != receipt.request_id or not receipt.native_run_id:
                    return []
                load_execution_owners(
                    sql,
                    actor=actor,
                    app_id=request.app_id,
                    workflow_id=request.workflow_id,
                    session_id=session_id,
                    test_input_id=test_input_id,
                )
                context = request.context
                expected = {
                    "request_id": request.id,
                    "tenant_id": actor.tenant_id,
                    "actor_id": actor.account_id,
                    "app_id": request.app_id,
                    "workflow_id": request.workflow_id,
                    "session_id": session_id,
                    "test_input_id": test_input_id,
                    "native_run_id": receipt.native_run_id,
                }
                if (
                    canonical_digest(context) != request.context_digest
                    or any(context.get(key) != value for key, value in expected.items())
                    or request.native_run_id not in (None, receipt.native_run_id)
                ):
                    return []
                parent = sql.execute(
                    select(
                        WorkflowRun.id, func.substr(WorkflowRun.error, 1, 257).label("error"), WorkflowRun.finished_at
                    )
                    .where(
                        WorkflowRun.id == receipt.native_run_id,
                        WorkflowRun.tenant_id == actor.tenant_id,
                        WorkflowRun.app_id == request.app_id,
                        WorkflowRun.workflow_id == request.workflow_id,
                        WorkflowRun.created_by == actor.account_id,
                        WorkflowRun.created_by_role == CreatorUserRole.ACCOUNT,
                        WorkflowRun.status == "failed",
                    )
                    .limit(1)
                ).first()
                if parent is None or parent.finished_at is None or not isinstance(parent.error, str):
                    return []
                diagnostic = parse_native_model_failure(parent.error)
                legacy = parent.error == "NativeAgentModelDispatchFailed: Native Agent model invocation failed."
                if diagnostic is None and not legacy:
                    return []
                stage, category = (diagnostic.stage, diagnostic.category) if diagnostic else (None, None)
                at = parent.finished_at
                at = at.replace(tzinfo=UTC) if at.tzinfo is None else at.astimezone(UTC)
                record = trace_diagnostics.project(
                    {
                        "code": "native_model_invocation_failed",
                        "native_stage": stage,
                        "native_category": category,
                        "id": str(uuid5(NAMESPACE_URL, f"builder-native:{request.id}:{parent.id}:{stage}:{category}")),
                        "at": at.isoformat(),
                    }
                )
                record["session_id"] = session_id
                return [record]
        except Exception:
            # Optional observations must not prevent ordinary GET/reconnect.
            return []

    def execute(
        self, *, actor: Actor, session_id: str, test_input_id: str, command: TestCommand, idempotency_key: str
    ) -> NativeTestPublicReceipt:
        if self._current_id(actor=actor, session_id=session_id, test_input_id=test_input_id) != command.request_id:
            raise ConflictError("test request is no longer current")
        try:
            commands = self.command_factory(actor=actor)
            execute = {"decide": commands.decide, "resume": commands.resume, "cancel": commands.cancel}[command.method]
            return execute(
                actor=actor,
                session_id=session_id,
                request_id=command.request_id,
                idempotency_key=idempotency_key,
                **command.native_payload,
            )
        except BuilderExecutionPolicyError:
            # Preserve the typed reason for the transport's safe HTTP mapping.
            raise


def control_actions(receipt: NativeTestPublicReceipt):
    from core.dify_builder.contract import Action, ActionKind
    from runtime_contracts.builder.copy_ids import BuilderCopyId
    from runtime_contracts.builder.presentation import copy_text

    actions = []
    for pending in receipt.pending:
        if pending.wait_reason != "approval" or pending.decision_status != "awaiting_decision":
            continue
        payload = {
            "request_id": receipt.request_id,
            "pending_operation_id": pending.pending_operation_id,
            "pending_version": pending.version,
            "scope_digest": pending.scope_digest,
        }
        actions.extend(
            [
                Action(
                    "confirm_test_operation",
                    copy_text(BuilderCopyId.ACTIONS_SUBMIT),
                    ActionKind.PRIMARY,
                    payload=payload,
                ),
                Action(
                    "deny_test_operation",
                    copy_text(BuilderCopyId.ACTIONS_REJECT),
                    ActionKind.DESTRUCTIVE,
                    payload=payload,
                ),
            ]
        )
        break  # disclose/approve pending operations one at a time
    if receipt.can_resume:
        actions.append(
            Action(
                "resume_test",
                copy_text(BuilderCopyId.ACTIONS_CONTINUE),
                ActionKind.PRIMARY,
                payload={"request_id": receipt.request_id, "expected_generation": receipt.generation},
            )
        )
    if receipt.status != "terminal":
        actions.append(
            Action(
                "cancel_test",
                control_label("cancel_test"),
                ActionKind.DESTRUCTIVE,
                payload={"request_id": receipt.request_id},
            )
        )
    return actions


def control_label(kind: str):
    from runtime_contracts.builder.copy_ids import BuilderCopyId
    from runtime_contracts.builder.presentation import copy_text

    return copy_text(
        {
            "confirm_test_operation": BuilderCopyId.ACTIONS_CONFIRM_TEST_OPERATION,
            "deny_test_operation": BuilderCopyId.ACTIONS_REJECT,
            "resume_test": BuilderCopyId.ACTIONS_CONTINUE,
            "cancel_test": BuilderCopyId.ACTIONS_CANCEL_TEST,
        }[kind]
    )


def test_disclosure_text(receipt: NativeTestPublicReceipt):
    import json

    from runtime_contracts.builder.copy_ids import BuilderCopyId
    from runtime_contracts.builder.presentation import copy_text, text_parts

    # Only human-reviewable scope belongs in the choice description. Version,
    # digest and operation identities remain in the structured action payload.
    reviewed = [
        {
            "account": pending.account_label,
            "action": pending.action,
            "target": pending.target,
            "parameters": pending.parameters_summary,
            "risk": pending.risk_notice,
            "limits": pending.approval_limits.model_dump(mode="json") if pending.approval_limits else None,
            "decision": pending.decision,
        }
        for pending in receipt.pending
    ]
    return text_parts(
        copy_text(BuilderCopyId.DECISION_HOW_SHOULD_BUILDER_CONTINUE),
        "\n",
        json.dumps(reviewed, ensure_ascii=False, indent=2),
    )
