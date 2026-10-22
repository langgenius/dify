"""Adapt existing Builder actions to the durable native command owners.

No start implementation lives here: run_test keeps the ordinary input and
run_draft path. Browser payloads identify a disclosed operation, never authority.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.errors import BadRequestError, ConflictError
from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderConversationItem, DifyBuilderExecutionRequest, DifyBuilderSession
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, Digest
from runtime_contracts.builder.native.contracts import ID, Counter, FrozenDTO
from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt

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

    def execute(
        self, *, actor: Actor, session_id: str, test_input_id: str, command: TestCommand, idempotency_key: str
    ) -> NativeTestPublicReceipt: ...


class BuilderTestActions:
    """Only control the current saved-input attempt; GET never reconciles work."""

    def __init__(self, sessions: sessionmaker[Session], command_factory: Callable[..., Any]):
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

    def execute(
        self, *, actor: Actor, session_id: str, test_input_id: str, command: TestCommand, idempotency_key: str
    ) -> NativeTestPublicReceipt:
        if self._current_id(actor=actor, session_id=session_id, test_input_id=test_input_id) != command.request_id:
            raise ConflictError("test request is no longer current")
        try:
            commands = self.command_factory(actor=actor)
            return getattr(commands, command.method)(
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
