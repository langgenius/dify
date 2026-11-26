"""Authorized Agent App steering bound to public task ids.

Invariant: a ``AgentChatTaskScope`` is assembled only from an admitted
caller's trusted tenant, user, and the runtime app id resolved server-side —
DEBUGGER draft/build previews and published WEB_APP snapshot chats each get
their own cache-key prefix; the browser never sends or trusts a Dify Agent
run id. Only runs that opted in at create time register a binding; workflow
runs never register one. When the feature flag is disabled no binding is
created and lookups fail before any backend call. The per-surface cache-key
prefix plus the tenant/app/user/task identity means a wrong tenant, app,
user, task, or surface cannot address another run.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from dify_agent.client import Client, DifyAgentClientError, DifyAgentHTTPError
from dify_agent.protocol import RunInputHandoffResponse, RunInputRequest, RunInputResponse, RunQueueResponse
from redis import RedisError

from clients.agent_backend.factory import create_agent_backend_client
from configs import dify_config
from core.app.apps.agent_app.steering_handoff import wait_for_agent_chat_handoff
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom
from extensions.ext_redis import redis_client
from machinery.context import RequestContext
from models.model import AppMode
from services.app_task_service import AppTaskService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AgentChatTaskScope:
    """Server-side identity of one steering-enabled chat run's binding.

    ``task_id`` is the public queue task id the client already sees; the
    backend run id is stored under the derived key and never leaves the server.
    ``invoke_from`` distinguishes the Console preview binding key from the
    published Web App one so the same task id cannot cross surfaces.
    """

    tenant_id: str
    app_id: str
    user_id: str
    task_id: UUID
    invoke_from: InvokeFrom = InvokeFrom.DEBUGGER

    def cache_key(self) -> str:
        """Return the Redis key owning this scope's run-id binding."""
        identity = json.dumps(
            (self.tenant_id, self.app_id, self.user_id, str(self.task_id)),
            separators=(",", ":"),
        )
        prefix = "agent-web-run:" if self.invoke_from == InvokeFrom.WEB_APP else "agent-preview-run:"
        return prefix + hashlib.sha256(identity.encode()).hexdigest()


class AgentChatTaskNotFoundError(LookupError):
    """Raised when no opted-in backend run exists for the scoped task."""


class AgentChatInputConflictError(RuntimeError):
    """Raised when the backend run exists but cannot accept the submitted input."""


class AgentChatBackendUnavailableError(RuntimeError):
    """Raised when the Agent backend cannot be reached or misbehaves."""


def agent_preview_async_loop_enabled() -> bool:
    """Return whether opted-in steering runs may accept steering inputs.

    Requires the feature flag, a configured real backend URL, a nonblank
    control-plane token, and the fake client to be off.
    """
    return bool(
        dify_config.AGENT_APP_ASYNC_LOOP_ENABLED
        and dify_config.AGENT_BACKEND_BASE_URL
        and (dify_config.AGENT_BACKEND_API_TOKEN or "").strip()
        and not dify_config.AGENT_BACKEND_USE_FAKE
    )


def bind_steering_task_to_run(context: DifyRunContext, task_id: str, run_id: str) -> bool:
    """Bind an accepted backend run id to its steering-enabled chat task.

    Every identifier is generated internally: ``context`` carries the admitted
    tenant/app/user, ``task_id`` is the public queue id, and ``run_id`` came
    back from the backend. Returns ``False`` when Redis is unavailable; the
    caller still owns and consumes the run.
    """
    scope = AgentChatTaskScope(
        context.tenant_id, context.app_id, context.user_id, UUID(task_id), invoke_from=context.invoke_from
    )
    try:
        register_agent_chat_task(scope, run_id)
    except RedisError:
        logger.warning("Could not register steering binding for Agent task %s; continuing the run", task_id)
        return False
    return True


def register_agent_chat_task(scope: AgentChatTaskScope, run_id: str) -> None:
    """Bind an accepted backend run id to its scoped chat task.

    The binding lives for the same bounded 30-minute window as queue user
    mappings; no deletion is needed because the backend enforces run closure
    even while a retained lookup exists.
    """
    redis_client.setex(scope.cache_key(), 1800, run_id)


def _resolve_run_id(scope: AgentChatTaskScope) -> str:
    """Return the bound run id or raise before any backend contact."""
    if not agent_preview_async_loop_enabled():
        raise AgentChatTaskNotFoundError("Agent chat task not found.")
    value: object = redis_client.get(scope.cache_key())
    if isinstance(value, bytes):
        return value.decode()
    if isinstance(value, str):
        return value
    raise AgentChatTaskNotFoundError("Agent chat task not found.")


def _run_client() -> Client:
    """Build the sync SDK client for the configured real backend."""
    base_url = dify_config.AGENT_BACKEND_BASE_URL
    if not base_url:
        raise AgentChatTaskNotFoundError("Agent chat task not found.")
    return create_agent_backend_client(base_url=base_url, api_token=dify_config.AGENT_BACKEND_API_TOKEN)


def get_agent_chat_queue(scope: AgentChatTaskScope) -> RunQueueResponse:
    """Return the scoped run's inbox snapshot.

    Precondition: the scope was resolved from the admitted caller. Raises
    ``AgentChatTaskNotFoundError`` for unknown/expired bindings and
    ``AgentChatBackendUnavailableError`` for upstream failures; backend
    internals are not propagated.
    """
    run_id = _resolve_run_id(scope)
    with _run_client() as client:
        try:
            return client.get_run_queue_sync(run_id)
        except DifyAgentHTTPError as exc:
            if exc.status_code == 404:
                raise AgentChatTaskNotFoundError("Agent chat task not found.") from exc
            raise AgentChatBackendUnavailableError("Agent chat queue is unavailable.") from exc
        except DifyAgentClientError as exc:
            raise AgentChatBackendUnavailableError("Agent chat queue is unavailable.") from exc


def _call_inbox_mutation[T](scope: AgentChatTaskScope, call: Callable[[Client, str], T]) -> T:
    """Run one scoped inbox mutation with the shared error contract.

    A 202 means inbox-accepted, not model-delivered. Backend conflicts are
    normalized to ``AgentChatInputConflictError`` without upstream details.
    """
    run_id = _resolve_run_id(scope)
    with _run_client() as client:
        try:
            return call(client, run_id)
        except DifyAgentHTTPError as exc:
            if exc.status_code == 404:
                raise AgentChatTaskNotFoundError("Agent chat task not found.") from exc
            if exc.status_code == 409:
                raise AgentChatInputConflictError("This Agent run is not accepting this input.") from exc
            raise AgentChatBackendUnavailableError("Agent chat queue is unavailable.") from exc
        except DifyAgentClientError as exc:
            raise AgentChatBackendUnavailableError("Agent chat queue is unavailable.") from exc


def enqueue_agent_chat_input(scope: AgentChatTaskScope, request: RunInputRequest) -> RunInputResponse:
    """Queue one human steering input on the scoped run's inbox."""
    return _call_inbox_mutation(scope, lambda client, run_id: client.enqueue_run_input_sync(run_id, request))


def _request_handoff_cancellation(scope: AgentChatTaskScope) -> None:
    """Cancel the scoped run directly so its scheduler wakes without waiting
    for the stream heartbeat.

    The ordinary Stop flag is only noticed on the next data or keepalive
    frame (up to 15s), which can outlast the handoff barrier wait; the
    idempotent cancel request reaches the scheduler immediately. HTTP 409
    means the run already reached a terminal state — the session-snapshot
    barrier stays authoritative for whether the next turn may start.
    """
    run_id = _resolve_run_id(scope)
    with _run_client() as client:
        try:
            client.cancel_run_sync(run_id)
        except DifyAgentHTTPError as exc:
            if exc.status_code == 409:
                return
            raise AgentChatBackendUnavailableError("Agent chat run did not settle for steering handoff.") from exc
        except DifyAgentClientError as exc:
            raise AgentChatBackendUnavailableError("Agent chat run did not settle for steering handoff.") from exc


def interrupt_agent_chat_input(scope: AgentChatTaskScope, request: RunInputRequest) -> RunInputHandoffResponse:
    """Freeze the run's inbox around the caller's input, stop the run, and wait for its settle.

    The freeze is atomic: it appends the prioritized text last and seals the
    inbox in one script, so the text can never drain natively and a replayed
    request retries safely. The response carries every still-pending input in
    FIFO order — the caller replays them on the next ordinary turn. Returns
    only after the run's session snapshot save finished; a timeout raises
    ``AgentChatBackendUnavailableError`` and the same freeze can be retried.
    """
    receipt = _call_inbox_mutation(scope, lambda client, run_id: client.interrupt_run_input_sync(run_id, request))
    try:
        AppTaskService.stop_task(
            task_id=str(scope.task_id),
            invoke_from=scope.invoke_from,
            user_id=scope.user_id,
            app_mode=AppMode.AGENT,
            tenant_id=scope.tenant_id,
            app_id=scope.app_id,
        )
        _request_handoff_cancellation(scope)
        settled = wait_for_agent_chat_handoff(str(scope.task_id))
    except RedisError as exc:
        raise AgentChatBackendUnavailableError("Agent chat run did not settle for steering handoff.") from exc
    if not settled:
        raise AgentChatBackendUnavailableError("Agent chat run did not settle for steering handoff.")
    return receipt


class AgentChatSteeringOwner(Protocol):
    """Read-only owner lookup resolving a roster Agent to its configuration app."""

    def resolve_roster_app_id(self, *, tenant_id: str, agent_id: str) -> str: ...


class AgentChatSteeringService:
    """Admission façade for Console steering calls on admitted roster Agents.

    Each call rebuilds the ``AgentChatTaskScope`` from the admitted
    ``RequestContext`` plus the server-side roster app resolution, so the
    browser can address a task only inside its own workspace, account, and
    roster app. No hidden inline App is resolved or created, and a queued
    input is accepted by the run inbox, not yet delivered to the model.
    """

    def __init__(self, *, owners: AgentChatSteeringOwner) -> None:
        self._owners = owners

    def _scope(self, context: RequestContext, agent_id: UUID, task_id: UUID) -> AgentChatTaskScope:
        """Build the task scope from the admitted caller and the roster app id.

        Raises ``AgentAppNotFoundError`` when the Agent is not a roster member
        of the caller's active workspace; no Redis or backend call happens.
        """
        tenant_id = context.active_workspace_id
        app_id = self._owners.resolve_roster_app_id(tenant_id=tenant_id, agent_id=str(agent_id))
        return AgentChatTaskScope(tenant_id=tenant_id, app_id=app_id, user_id=context.account_id, task_id=task_id)

    def get_queue(self, context: RequestContext, agent_id: UUID, task_id: UUID) -> RunQueueResponse:
        """Return the pending inbox snapshot for the scoped task."""
        return get_agent_chat_queue(self._scope(context, agent_id, task_id))

    def enqueue_input(
        self, context: RequestContext, agent_id: UUID, task_id: UUID, request: RunInputRequest
    ) -> RunInputResponse:
        """Queue one steering input on the scoped run's inbox; 202 means accepted."""
        return enqueue_agent_chat_input(self._scope(context, agent_id, task_id), request)

    def interrupt_input(
        self, context: RequestContext, agent_id: UUID, task_id: UUID, request: RunInputRequest
    ) -> RunInputHandoffResponse:
        """Freeze pending inputs around the caller's text, stop the run, and return them for the next turn."""
        return interrupt_agent_chat_input(self._scope(context, agent_id, task_id), request)
