"""Request-scoped Stub admission backed by the existing durable Run owner.

The live read and final send are separate operations, not a physical dispatch fence.
"""

from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass
import time

from dify_agent.adapters.native_testing.transport import AgentRuntimeTransportError, bind_runtime_identity
from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubPrincipal
from dify_agent.protocol.native_testing import AgentRuntimeIdentity
from dify_agent.runtime.native_effects import NativeDispatchEnvelope, _dispatch


@dataclass
class _Admission:
    owner: "AgentStubAdmission"
    principal: AgentStubPrincipal
    context_json: str
    dispatch_json: str | None = None
    active: bool = True


_current: ContextVar[_Admission | None] = ContextVar("agent_stub_admission", default=None)


@dataclass
class AgentStubAdmission:
    reader: Callable[[AgentRuntimeIdentity], Awaitable[AgentRuntimeIdentity]] | None = None
    allow_legacy: bool = False

    @property
    def active(self) -> bool:
        current = _current.get()
        return current is not None and current.active and current.owner is self

    def require(self, principal: AgentStubPrincipal) -> None:
        current = _current.get()
        if (
            current is None
            or not current.active
            or current.owner is not self
            or current.principal is not principal
            or current.context_json != principal.execution_context.model_dump_json()
            or current.dispatch_json
            != (principal.native_dispatch.model_dump_json() if principal.native_dispatch else None)
        ):
            raise AgentRuntimeTransportError("agent_stub_admission_missing")

    @asynccontextmanager
    async def scope(self, principal: AgentStubPrincipal) -> AsyncGenerator[None]:
        if _current.get() is not None or self.reader is None:
            raise AgentRuntimeTransportError("agent_stub_live_owner_unavailable")
        identity = principal.runtime
        if identity is None:
            if self.allow_legacy and principal.native_dispatch is None:
                yield
                return
            raise AgentRuntimeTransportError("agent_stub_ordinary_owner_required")
        envelope = principal.native_dispatch
        if identity.execution_mode == "builder_test":
            if identity.native_test_profile != "confirmed":
                raise AgentRuntimeTransportError("agent_stub_confirmed_owner_required")
            if (
                identity.parent_node is None
                or envelope is None
                or envelope.ref != identity.parent_node.ref
                or envelope.intent.key.occurrence_path[0] != identity.parent_node.execution_id
            ):
                raise AgentRuntimeTransportError("agent_stub_confirmed_owner_required")
        elif identity.parent_node is not None or envelope is not None:
            raise AgentRuntimeTransportError("agent_stub_ordinary_owner_required")
        envelope_json = envelope.model_dump_json() if envelope is not None else None
        selected = AgentRuntimeIdentity.model_validate_json(identity.model_dump_json())
        expires_at = principal.expires_at
        admitted = _Admission(self, principal, principal.execution_context.model_dump_json(), envelope_json)
        reader = self.reader

        async def validate() -> None:
            if not admitted.active or expires_at is None or time.time() >= expires_at:
                raise AgentRuntimeTransportError("agent_stub_authorization_expired_or_revoked")
            if (
                principal.runtime != selected
                or principal.execution_context.model_dump_json() != admitted.context_json
                or (principal.native_dispatch.model_dump_json() if principal.native_dispatch else None) != envelope_json
            ):
                raise AgentRuntimeTransportError("agent_stub_principal_changed")
            try:
                actual = await reader(selected)
            except Exception as exc:
                raise AgentRuntimeTransportError("agent_stub_live_owner_unavailable") from exc
            if (
                actual != selected
                or not admitted.active
                or time.time() >= expires_at
                or principal.runtime != selected
                or principal.execution_context.model_dump_json() != admitted.context_json
                or (principal.native_dispatch.model_dump_json() if principal.native_dispatch else None) != envelope_json
            ):
                raise AgentRuntimeTransportError("agent_stub_live_owner_changed")

        await validate()
        token = _current.set(admitted)
        try:
            with bind_runtime_identity(selected, validate_send=validate):
                dispatch_token = _dispatch.set(
                    NativeDispatchEnvelope(envelope.ref, envelope.intent, envelope.permit) if envelope else None
                )
                try:
                    yield
                finally:
                    _dispatch.reset(dispatch_token)
        finally:
            admitted.active = False
            _current.reset(token)
