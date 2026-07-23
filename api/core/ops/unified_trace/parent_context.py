"""Coordinate nested-workflow provider parent contexts through Redis.

The coordinator owns storage, compatibility decisions, validation, and retry
signals. Provider adapters only create and consume their opaque context fields.
"""

import hashlib
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.helper.trace_id_helper import ParentTraceContext
from core.ops.exceptions import (
    InvalidTraceParentContextError,
    PendingTraceParentContextError,
    TraceParentContextAccessError,
)
from extensions.ext_database import db
from models.model import App, TraceAppConfig
from models.workflow import WorkflowRun

_PARENT_CONTEXT_TTL_SECONDS = 300
_PARENT_CONTEXT_KEY_PREFIX = "trace:unified:parent:"


class RedisParentContextStore(Protocol):
    def setex(self, name: str, time: int, value: str) -> object:
        raise NotImplementedError

    def get(self, name: str) -> bytes | str | None:
        raise NotImplementedError


class ProviderParentContext(BaseModel):
    """Versioned envelope containing the minimum provider restoration state."""

    version: Literal[1] = 1
    provider: str
    scope: str
    trace_id: str
    parent_id: str
    provider_context: dict[str, str]

    model_config = ConfigDict(extra="forbid", frozen=True)


@dataclass(frozen=True)
class ParentDestination:
    provider: str
    scope: str
    unified: bool


class ParentResolutionKind(StrEnum):
    RESTORED = "restored"
    LINKED_ROOT = "linked_root"


@dataclass(frozen=True)
class ParentResolution:
    kind: ParentResolutionKind
    context: ProviderParentContext | None = None
    linked_parent: ParentTraceContext | None = None

    @classmethod
    def restored(cls, context: ProviderParentContext) -> "ParentResolution":
        return cls(kind=ParentResolutionKind.RESTORED, context=context)

    @classmethod
    def linked_root(cls, parent: ParentTraceContext) -> "ParentResolution":
        return cls(kind=ParentResolutionKind.LINKED_ROOT, linked_parent=parent)


ParentDestinationResolver = Callable[[str], ParentDestination | None]


def destination_scope(provider: str, endpoint: str, project: str) -> str:
    """Return a stable non-secret fingerprint for a provider destination."""
    value = f"{provider}\0{endpoint.rstrip('/')}\0{project}"
    return hashlib.sha256(value.encode()).hexdigest()


def parent_destination_from_config(
    provider: str,
    tracing_config: Mapping[str, object],
    *,
    unified: bool,
) -> ParentDestination:
    """Build destination compatibility from non-secret persisted fields."""
    endpoint = tracing_config.get("endpoint")
    project = tracing_config.get("project")
    return ParentDestination(
        provider=provider,
        scope=destination_scope(
            provider,
            endpoint if isinstance(endpoint, str) else "",
            project if isinstance(project, str) else "",
        ),
        unified=unified,
    )


def resolve_parent_destination(parent_workflow_run_id: str) -> ParentDestination | None:
    """Resolve whether a parent workflow can publish compatible unified context."""
    with Session(db.engine) as session:
        workflow_run = session.get(WorkflowRun, parent_workflow_run_id)
        if workflow_run is None:
            return None
        app = session.get(App, workflow_run.app_id)
        if app is None or not app.tracing:
            return None
        try:
            app_tracing = json.loads(app.tracing)
        except (TypeError, json.JSONDecodeError):
            return None
        if not isinstance(app_tracing, Mapping) or not app_tracing.get("enabled"):
            return None
        provider = app_tracing.get("tracing_provider")
        if not isinstance(provider, str):
            return None
        trace_config = session.scalar(
            select(TraceAppConfig)
            .where(TraceAppConfig.app_id == app.id, TraceAppConfig.tracing_provider == provider)
            .limit(1)
        )
        if trace_config is None or not isinstance(trace_config.tracing_config, Mapping):
            return None

        unified = False
        if dify_config.OPS_TRACE_UNIFIED_ENABLED:
            from core.ops.unified_trace.registry import unified_provider_config_map

            try:
                unified_provider_config_map[provider]
                unified = True
            except KeyError:
                pass
        return parent_destination_from_config(provider, trace_config.tracing_config, unified=unified)


class ParentContextCoordinator:
    """Publish and resolve cross-task parent contexts for unified providers."""

    def __init__(
        self,
        store: RedisParentContextStore,
        resolve_parent_destination: ParentDestinationResolver,
    ) -> None:
        self._store = store
        self._resolve_parent_destination = resolve_parent_destination

    @staticmethod
    def _key(parent_node_execution_id: str) -> str:
        return f"{_PARENT_CONTEXT_KEY_PREFIX}{parent_node_execution_id}"

    def publish(self, parent_node_execution_id: str, context: ProviderParentContext) -> None:
        """Persist an accepted provider parent so a nested task can restore it."""
        try:
            self._store.setex(
                self._key(parent_node_execution_id),
                _PARENT_CONTEXT_TTL_SECONDS,
                context.model_dump_json(),
            )
        except Exception as error:
            raise TraceParentContextAccessError(
                f"Could not publish unified parent context for node_execution_id={parent_node_execution_id}"
            ) from error

    def resolve(
        self,
        parent: ParentTraceContext,
        *,
        expected_provider: str,
        expected_scope: str,
    ) -> ParentResolution:
        """Restore compatible context or explicitly select a linked new root."""
        destination = self._resolve_parent_destination(parent.parent_workflow_run_id)
        if (
            destination is None
            or not destination.unified
            or destination.provider != expected_provider
            or destination.scope != expected_scope
        ):
            return ParentResolution.linked_root(parent)

        parent_node_execution_id = parent.parent_node_execution_id
        if not parent_node_execution_id:
            raise InvalidTraceParentContextError("Nested workflow parent context has no node execution ID")

        return ParentResolution.restored(
            self._restore(
                parent_node_execution_id,
                expected_provider=expected_provider,
                expected_scope=expected_scope,
            )
        )

    def resolve_required(
        self,
        parent_context_id: str,
        *,
        expected_provider: str,
        expected_scope: str,
    ) -> ParentResolution:
        """Restore a parent context that must exist for an asynchronous child."""
        return ParentResolution.restored(
            self._restore(
                parent_context_id,
                expected_provider=expected_provider,
                expected_scope=expected_scope,
            )
        )

    def _restore(
        self,
        parent_context_id: str,
        *,
        expected_provider: str,
        expected_scope: str,
    ) -> ProviderParentContext:
        try:
            raw_context = self._store.get(self._key(parent_context_id))
        except Exception as error:
            raise TraceParentContextAccessError(
                f"Could not read unified parent context for parent_context_id={parent_context_id}"
            ) from error

        if raw_context is None:
            raise PendingTraceParentContextError(parent_context_id)

        try:
            context = ProviderParentContext.model_validate_json(raw_context)
        except (ValidationError, ValueError, TypeError) as error:
            raise InvalidTraceParentContextError(
                f"Invalid unified parent context for parent_context_id={parent_context_id}"
            ) from error

        if context.provider != expected_provider or context.scope != expected_scope:
            raise InvalidTraceParentContextError(
                "Stored unified parent context does not match the expected provider destination: "
                f"parent_context_id={parent_context_id}"
            )
        return context
