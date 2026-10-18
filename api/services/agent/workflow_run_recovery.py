"""Durable child-create identities for an owned Workflow Agent execution.

Only a newly committed intent permits its caller's first POST. Existing intents
are observation-only even if no child ACK was saved: recovery may look up the
retained backend record, but cannot recreate an expired or unknown child. The
record lives in the existing caller row and contains no executable config.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Protocol

from dify_agent.protocol import CreateRunRequest, CreateRunResponse
from dify_agent.protocol.run_recovery import LookupRunRequest, create_run_fingerprint
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from clients.agent_backend.errors import (
    AgentBackendError,
    AgentBackendHTTPError,
    AgentBackendTransportError,
    AgentBackendValidationError,
)
from models.workflow import WorkflowNodeExecutionModel

_INTENTS_KEY = "agent_create_attempts"
# The native declared-output contract permits at most ten intentional retries.
_MAX_ATTEMPT = 10


class AgentCreateIntentConflict(ValueError):  # noqa: N818 - node adapter control outcome
    """The original create intent cannot be established under this owner."""


class AgentCreateAcknowledgementUnknown(AgentBackendTransportError):  # noqa: N818 - typed recovery control outcome
    """A create may have happened; retained identity could not be read back."""

    error_code = "agent_create_ack_unknown"


class AgentCreateRecoveryClient(Protocol):
    def create_run(self, request: CreateRunRequest) -> CreateRunResponse: ...

    def lookup_run(self, request: LookupRunRequest) -> CreateRunResponse: ...


@dataclass(frozen=True, slots=True)
class AgentCreateScope:
    tenant_id: str
    app_id: str
    workflow_id: str
    workflow_run_id: str
    node_id: str
    execution_id: str
    workflow_binding_id: str


class AgentCreateIntent(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    attempt: Annotated[int, Field(strict=True, ge=0, le=_MAX_ATTEMPT)]
    key: Annotated[str, Field(strict=True, min_length=1, max_length=256)]
    digest: Annotated[str, Field(strict=True, pattern=r"^[0-9a-f]{64}$")]
    child_run_id: Annotated[str, Field(strict=True, min_length=1, max_length=256)] | None = None


class WorkflowAgentRunRecovery:
    def __init__(self, sessions: sessionmaker[Session]):
        self.sessions = sessions

    @staticmethod
    def _caller(session: Session, scope: AgentCreateScope, *, lock: bool) -> WorkflowNodeExecutionModel:
        stmt = select(WorkflowNodeExecutionModel).where(
            WorkflowNodeExecutionModel.id == scope.execution_id,
            WorkflowNodeExecutionModel.tenant_id == scope.tenant_id,
            WorkflowNodeExecutionModel.app_id == scope.app_id,
            WorkflowNodeExecutionModel.workflow_id == scope.workflow_id,
            WorkflowNodeExecutionModel.workflow_run_id == scope.workflow_run_id,
            WorkflowNodeExecutionModel.node_id == scope.node_id,
            WorkflowNodeExecutionModel.node_type == "agent",
        )
        row = session.scalar(stmt.with_for_update() if lock else stmt)
        if row is None or row.agent_workspace_binding_id is None:
            raise AgentCreateIntentConflict("Owned Agent execution is unavailable")
        data = row.process_data_dict
        if not isinstance(data, dict) or data.get("workflow_agent_binding_id") != scope.workflow_binding_id:
            raise AgentCreateIntentConflict("Owned Agent binding does not match")
        return row

    @staticmethod
    def _intents(row: WorkflowNodeExecutionModel) -> list[AgentCreateIntent]:
        raw = (row.process_data_dict or {}).get(_INTENTS_KEY, [])
        if not isinstance(raw, list) or len(raw) > _MAX_ATTEMPT + 1:
            raise AgentCreateIntentConflict("Stored Agent create identity is invalid")
        try:
            intents = [AgentCreateIntent.model_validate(item) for item in raw]
        except ValidationError:
            raise AgentCreateIntentConflict("Stored Agent create identity is invalid") from None
        if len({item.attempt for item in intents}) != len(intents):
            raise AgentCreateIntentConflict("Stored Agent create identity is ambiguous")
        return intents

    @staticmethod
    def _save(row: WorkflowNodeExecutionModel, intents: list[AgentCreateIntent]) -> None:
        row.process_data = json.dumps(
            {**(row.process_data_dict or {}), _INTENTS_KEY: [item.model_dump(mode="json") for item in intents]},
            ensure_ascii=False,
        )

    def reserve(
        self, *, scope: AgentCreateScope, attempt: int, key: str, digest: str
    ) -> tuple[AgentCreateIntent, bool]:
        try:
            candidate = AgentCreateIntent(attempt=attempt, key=key, digest=digest)
        except ValidationError:
            raise AgentCreateIntentConflict("Invalid Agent create identity") from None
        with self.sessions() as session, session.begin():
            row = self._caller(session, scope, lock=True)
            intents = self._intents(row)
            for existing in intents:
                if existing.attempt == attempt:
                    if (existing.key, existing.digest) != (key, digest):
                        raise AgentCreateIntentConflict("Agent create attempt changed")
                    return existing, False
            if len(intents) >= _MAX_ATTEMPT + 1:
                raise AgentCreateIntentConflict("Agent create attempt limit exceeded")
            self._save(row, [*intents, candidate])
        return candidate, True

    def bind_child(self, *, scope: AgentCreateScope, intent: AgentCreateIntent, child_run_id: str) -> AgentCreateIntent:
        try:
            desired = AgentCreateIntent.model_validate({**intent.model_dump(), "child_run_id": child_run_id})
        except ValidationError:
            raise AgentCreateIntentConflict("Invalid Agent child identity") from None
        with self.sessions() as session, session.begin():
            row = self._caller(session, scope, lock=True)
            intents = self._intents(row)
            for index, existing in enumerate(intents):
                if existing.attempt != intent.attempt:
                    continue
                if (existing.key, existing.digest) != (intent.key, intent.digest) or existing.child_run_id not in (
                    None,
                    child_run_id,
                ):
                    raise AgentCreateIntentConflict("Agent child identity changed")
                intents[index] = desired
                self._save(row, intents)
                return desired
            raise AgentCreateIntentConflict("Agent create intent is unavailable")

    def process_data(self, *, scope: AgentCreateScope) -> dict:
        with self.sessions() as session:
            return dict(self._caller(session, scope, lock=False).process_data_dict or {})

    def recover_existing(
        self,
        *,
        scope: AgentCreateScope,
        client: AgentCreateRecoveryClient,
        on_persisted: Callable[[dict], None],
        attempt: int = 0,
    ) -> CreateRunResponse | None:
        """Observe the committed identity without rebuilding executable config."""
        with self.sessions() as session:
            intents = self._intents(self._caller(session, scope, lock=False))
        intent = next((item for item in intents if item.attempt == attempt), None)
        if intent is None:
            return None
        try:
            response = client.lookup_run(LookupRunRequest(idempotency_key=intent.key, request_digest=intent.digest))
        except (AgentBackendError, AttributeError):
            raise AgentCreateAcknowledgementUnknown(
                "Agent create acknowledgement is unknown; automatic replay is disabled"
            ) from None
        if intent.child_run_id is not None and response.run_id != intent.child_run_id:
            raise AgentCreateIntentConflict("Agent child identity changed")
        self.bind_child(scope=scope, intent=intent, child_run_id=response.run_id)
        on_persisted(self.process_data(scope=scope))
        return response

    def start_or_recover(
        self,
        *,
        scope: AgentCreateScope,
        attempt: int,
        request: CreateRunRequest,
        client: AgentCreateRecoveryClient,
        on_persisted: Callable[[dict], None],
    ) -> CreateRunResponse:
        """One first POST or an exact readback, with durable metadata before I/O.

        The callback mirrors committed identity into the node's ordinary terminal
        event so native persistence cannot erase it. An old intent grants only
        lookup, including when its backend retention has expired.
        """
        if request.idempotency_key is None:
            raise AgentCreateIntentConflict("Agent create identity is required")
        intent, inserted = self.reserve(
            scope=scope, attempt=attempt, key=request.idempotency_key, digest=create_run_fingerprint(request)
        )
        on_persisted(self.process_data(scope=scope))
        response = None
        if inserted:
            try:
                response = client.create_run(request)
            except AgentBackendHTTPError as error:
                if error.status_code < 500:
                    raise
            except (AgentBackendTransportError, AgentBackendValidationError):
                # A malformed successful ACK is ambiguous too. Only a read can
                # resolve it; there is deliberately no second create attempt.
                pass
        if response is None:
            try:
                response = client.lookup_run(LookupRunRequest(idempotency_key=intent.key, request_digest=intent.digest))
            except (AgentBackendError, AttributeError):
                raise AgentCreateAcknowledgementUnknown(
                    "Agent create acknowledgement is unknown; automatic replay is disabled"
                ) from None
        if intent.child_run_id is not None and response.run_id != intent.child_run_id:
            raise AgentCreateIntentConflict("Agent child identity changed")
        self.bind_child(scope=scope, intent=intent, child_run_id=response.run_id)
        on_persisted(self.process_data(scope=scope))
        return response
