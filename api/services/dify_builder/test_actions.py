"""Read or stop historical Builder tests for the task lifecycle owner."""

from collections.abc import Callable
from typing import TYPE_CHECKING, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.errors import ConflictError
from core.dify_builder.models import Actor
from models.dify_builder import (
    DifyBuilderExecutionRequest,
    DifyBuilderSession,
    DifyBuilderSessionCommit,
)
from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt

if TYPE_CHECKING:
    from services.dify_builder.native_testing.confirmed_agent_commands import ProfiledNativeTestCommands

TEST_ACTIONS = frozenset({"confirm_test_operation", "deny_test_operation", "resume_test", "cancel_test"})
TEST_CONTROL_RECEIPT_KINDS = ("decision", "interaction_response")


class TestActionPort(Protocol):
    def current(self, *, actor: Actor, session_id: str, test_input_id: str) -> NativeTestPublicReceipt | None: ...

    def cancel(
        self, *, actor: Actor, session_id: str, test_input_id: str, request_id: str, idempotency_key: str
    ) -> NativeTestPublicReceipt: ...


class BuilderTestActions:
    """Only control the current saved-input attempt; GET never reconciles work."""

    def __init__(self, sessions: sessionmaker[Session], command_factory: Callable[..., "ProfiledNativeTestCommands"]):
        self.sessions = sessions
        self.command_factory = command_factory

    def _current_id(self, *, actor: Actor, session_id: str, test_input_id: str) -> str | None:
        if not test_input_id:
            return None
        with self.sessions() as sql:
            return sql.scalar(
                select(DifyBuilderExecutionRequest.id)
                .join(DifyBuilderSession, DifyBuilderSession.id == DifyBuilderExecutionRequest.session_id)
                .join(
                    DifyBuilderSessionCommit,
                    (DifyBuilderSessionCommit.session_id == DifyBuilderSession.id)
                    & (DifyBuilderSessionCommit.version == DifyBuilderSession.version),
                )
                .where(
                    DifyBuilderSessionCommit.context["task_control"]["conversation_clear"]["version"]
                    .as_integer()
                    .is_(None),
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

    def cancel(
        self, *, actor: Actor, session_id: str, test_input_id: str, request_id: str, idempotency_key: str
    ) -> NativeTestPublicReceipt:
        """Cancel the current owned historical test using the durable stop key."""
        if self._current_id(actor=actor, session_id=session_id, test_input_id=test_input_id) != request_id:
            raise ConflictError("test request is no longer current")
        return self.command_factory(actor=actor).cancel(
            actor=actor, session_id=session_id, request_id=request_id, idempotency_key=idempotency_key
        )
