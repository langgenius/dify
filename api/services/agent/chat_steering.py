"""Authorized Agent App preview steering bound to public task ids.

Invariant: a ``AgentChatTaskScope`` is assembled only from an admitted DEBUGGER
caller's trusted tenant, user, and the runtime app id resolved server-side;
the browser never sends or trusts a Dify Agent run id. Only draft chat runs
that opted in at create time register a binding; workflow runs never register
one. When the feature flag is disabled no binding is created and lookups fail
before any backend call. The cache-key prefix is restricted to these admitted
draft chats, so a wrong tenant/app/user/task cannot address another run.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from uuid import UUID

from dify_agent.client import Client, DifyAgentClientError, DifyAgentHTTPError
from dify_agent.protocol import RunInputRequest, RunInputResponse, RunQueueResponse
from redis import RedisError

from clients.agent_backend.factory import create_agent_backend_client
from configs import dify_config
from core.app.entities.app_invoke_entities import DifyRunContext
from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AgentChatTaskScope:
    """Server-side identity of one draft chat run's steering binding.

    ``task_id`` is the public queue task id the client already sees; the
    backend run id is stored under the derived key and never leaves the server.
    """

    tenant_id: str
    app_id: str
    user_id: str
    task_id: UUID

    def cache_key(self) -> str:
        """Return the Redis key owning this scope's run-id binding."""
        identity = json.dumps(
            (self.tenant_id, self.app_id, self.user_id, str(self.task_id)),
            separators=(",", ":"),
        )
        return "agent-preview-run:" + hashlib.sha256(identity.encode()).hexdigest()


class AgentChatTaskNotFoundError(LookupError):
    """Raised when no opted-in backend run exists for the scoped preview task."""


class AgentChatInputConflictError(RuntimeError):
    """Raised when the backend run exists but cannot accept the submitted input."""


class AgentChatBackendUnavailableError(RuntimeError):
    """Raised when the Agent backend cannot be reached or misbehaves."""


def agent_preview_async_loop_enabled() -> bool:
    """Return whether opted-in preview runs may steer and run background jobs.

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
    """Bind an accepted backend run id to its draft chat task.

    Every identifier is generated internally: ``context`` carries the admitted
    tenant/app/user, ``task_id`` is the public queue id, and ``run_id`` came
    back from the backend. Returns ``False`` when Redis is unavailable; the
    caller still owns and consumes the run.
    """
    scope = AgentChatTaskScope(context.tenant_id, context.app_id, context.user_id, UUID(task_id))
    try:
        register_agent_chat_task(scope, run_id)
    except RedisError:
        logger.warning("Could not register steering binding for Agent task %s; continuing the run", task_id)
        return False
    return True


def register_agent_chat_task(scope: AgentChatTaskScope, run_id: str) -> None:
    """Bind an accepted backend run id to its scoped preview task.

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


def enqueue_agent_chat_input(scope: AgentChatTaskScope, request: RunInputRequest) -> RunInputResponse:
    """Queue one human steering input on the scoped run's inbox.

    A 202 means inbox-accepted, not model-delivered. Backend conflicts are
    normalized to ``AgentChatInputConflictError`` without upstream details.
    """
    run_id = _resolve_run_id(scope)
    with _run_client() as client:
        try:
            return client.enqueue_run_input_sync(run_id, request)
        except DifyAgentHTTPError as exc:
            if exc.status_code == 404:
                raise AgentChatTaskNotFoundError("Agent chat task not found.") from exc
            if exc.status_code == 409:
                raise AgentChatInputConflictError("This Agent run is not accepting this input.") from exc
            raise AgentChatBackendUnavailableError("Agent chat queue is unavailable.") from exc
        except DifyAgentClientError as exc:
            raise AgentChatBackendUnavailableError("Agent chat queue is unavailable.") from exc
