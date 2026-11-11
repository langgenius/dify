"""Console workflow use cases over explicit persistence and runtime ports."""

import json
import logging
from collections.abc import Mapping, Sequence
from contextlib import AbstractContextManager
from dataclasses import replace
from typing import Any, Protocol

from machinery.context import RequestContext
from services.errors.app import WorkflowNotFoundError
from services.errors.base import NoPermissionError
from services.errors.llm import InvokeRateLimitError
from services.workflow.contracts import (
    MAX_WORKFLOW_ONLINE_USERS_REQUEST_IDS,
    DeletedWorkflowBinding,
    DraftSyncCommand,
    DraftWorkflowMissingError,
    DraftWorkflowRead,
    ValidatedWorkflowPublication,
    WorkflowAgentServices,
    WorkflowChange,
    WorkflowGeneration,
    WorkflowOwner,
    WorkflowPublication,
    WorkflowRecord,
    WorkflowSnapshot,
    WorkflowTriggerError,
    WorkflowTriggerEvent,
)
from services.workflow.deletion_policy import inline_agent_retirement_candidates
from services.workflow.draft_service import WorkflowDraftService
from services.workflow.publication_service import WorkflowPublicationTransaction, prepare_publication, publish_workflow
from services.workflow_variable_reference_validator import (
    format_variable_reference_errors,
    validate_variable_references,
)

logger = logging.getLogger(__name__)


class WorkflowDefinitions[BindingStore](Protocol):
    def draft(
        self, context: RequestContext, app_id: str
    ) -> AbstractContextManager[DraftWorkflowRead[BindingStore] | None]: ...
    def publication(
        self, context: RequestContext, app_id: str, draft: WorkflowSnapshot
    ) -> AbstractContextManager[WorkflowPublicationTransaction[BindingStore]]: ...
    def published(self, context: RequestContext, app_id: str) -> WorkflowRecord | None: ...
    def versions(
        self, context: RequestContext, app_id: str, *, page: int, limit: int, user_id: str | None, named_only: bool
    ) -> tuple[list[WorkflowRecord], bool]: ...
    def update(
        self, context: RequestContext, app_id: str, workflow_id: str, changes: dict[str, str]
    ) -> WorkflowRecord | None: ...
    def delete(
        self, context: RequestContext, owner: WorkflowOwner, workflow_id: str
    ) -> list[DeletedWorkflowBinding]: ...
    def update_features(self, context: RequestContext, app_id: str, features: dict[str, Any]) -> None: ...


class WorkflowDefinitionLifecycle(Protocol):
    def validate_publish(self, context: RequestContext, app_id: str) -> ValidatedWorkflowPublication: ...
    def validate_features(self, context: RequestContext, app_id: str, features: dict[str, Any]) -> None: ...


class WorkflowRuntime(Protocol):
    def generate(
        self,
        context: RequestContext,
        app_id: str,
        args: dict[str, Any],
        *,
        root_node_id: str | None,
        workflow: WorkflowSnapshot | None,
    ) -> WorkflowGeneration: ...
    def iteration(
        self, context: RequestContext, app_id: str, node_id: str, inputs: dict[str, Any] | None
    ) -> WorkflowGeneration: ...
    def loop(
        self, context: RequestContext, app_id: str, node_id: str, inputs: dict[str, Any] | None
    ) -> WorkflowGeneration: ...
    def run_node(
        self,
        context: RequestContext,
        app_id: str,
        node_id: str,
        args: dict[str, Any],
        *,
        include_details: bool,
        workflow: WorkflowSnapshot | None,
    ) -> dict[str, Any]: ...
    def last_run(self, context: RequestContext, app_id: str, node_id: str) -> dict[str, Any] | None: ...
    def poll_trigger(
        self, context: RequestContext, app_id: str, node_ids: list[str], *, single_node: bool, select_all: bool
    ) -> WorkflowTriggerEvent | None: ...
    def stop(self, task_id: str) -> None: ...
    def default_blocks(self) -> Sequence[Mapping[str, object]]: ...
    def default_block(self, block_type: str, filters: dict[str, Any] | None) -> Mapping[str, object] | None: ...
    def retire_agents(self, context: RequestContext, agent_ids: list[str]) -> None: ...


class WorkflowAppLookup(Protocol):
    def maintainers(self, context: RequestContext, app_ids: list[str]) -> dict[str, str | None]: ...


class WorkflowConversion(Protocol):
    def convert(self, context: RequestContext, app_id: str, args: dict[str, Any]) -> str: ...


class WorkflowPresence(Protocol):
    def online_users(self, app_ids: list[str]) -> dict[str, list[dict[str, Any]]]: ...


class WorkflowAccess(Protocol):
    def accessible_app_ids(self, context: RequestContext, maintainers: dict[str, str | None]) -> set[str]: ...
    def permission_keys(self, context: RequestContext, app_id: str) -> list[str]: ...
    def avatar_url(self, avatar: str) -> str: ...


class ConsoleWorkflowService[BindingStore]:
    def __init__(
        self,
        *,
        definitions: WorkflowDefinitions[BindingStore],
        drafts: WorkflowDraftService[BindingStore],
        agent_services: WorkflowAgentServices[BindingStore],
        lifecycle: WorkflowDefinitionLifecycle,
        runtime: WorkflowRuntime,
        conversion: WorkflowConversion,
        apps: WorkflowAppLookup,
        presence: WorkflowPresence,
        access: WorkflowAccess,
    ) -> None:
        self._drafts = drafts
        self._agent_services = agent_services
        self._definitions = definitions
        self._lifecycle = lifecycle
        self._runtime = runtime
        self._conversion = conversion
        self._apps = apps
        self._presence = presence
        self._access = access

    def draft(self, context: RequestContext, app_id: str) -> WorkflowRecord:
        with self._definitions.draft(context, app_id) as draft:
            if draft is None:
                raise DraftWorkflowMissingError()
            return replace(
                draft.record,
                graph=self._agent_services(repository=draft.bindings).project_draft_bindings_to_graph(
                    draft_workflow=draft.workflow
                ),
            )

    def published(self, context: RequestContext, app_id: str) -> WorkflowRecord | None:
        return self._definitions.published(context, app_id)

    def versions(
        self, context: RequestContext, app_id: str, *, page: int, limit: int, user_id: str | None, named_only: bool
    ) -> tuple[list[WorkflowRecord], bool]:
        if user_id and user_id != context.account_id:
            raise NoPermissionError()
        return self._definitions.versions(
            context, app_id, page=page, limit=limit, user_id=user_id, named_only=named_only
        )

    def sync(self, context: RequestContext, app_id: str, command: DraftSyncCommand) -> WorkflowChange:
        workflow = self._drafts.sync(context, WorkflowOwner(app_id), command)
        return WorkflowChange(workflow.hash, workflow.updated_at)

    def publish(
        self, context: RequestContext, app_id: str, *, marked_name: str, marked_comment: str
    ) -> tuple[WorkflowPublication, str | None]:
        validated = self._lifecycle.validate_publish(context, app_id)
        draft = validated.workflow
        configuration = prepare_publication(draft)
        with self._definitions.publication(context, app_id, draft) as transaction:
            workflow = publish_workflow(
                transaction,
                configuration,
                agent_service=self._agent_services(repository=transaction.bindings),
                agents=validated.agents,
                marked_name=marked_name,
                marked_comment=marked_comment,
            )
        publication = WorkflowPublication(workflow.created_at, workflow.graph)
        return publication, advisory_variable_reference_warning(publication.graph)

    def restore(self, context: RequestContext, app_id: str, workflow_id: str) -> WorkflowChange:
        workflow = self._drafts.restore(context, WorkflowOwner(app_id), workflow_id)
        return WorkflowChange(workflow.hash, workflow.updated_at)

    def update(self, context: RequestContext, app_id: str, workflow_id: str, changes: dict[str, str]) -> WorkflowRecord:
        workflow = self._definitions.update(context, app_id, workflow_id, changes)
        if workflow is None:
            raise WorkflowNotFoundError("Workflow not found")
        return workflow

    def delete(self, context: RequestContext, owner: WorkflowOwner, workflow_id: str) -> None:
        bindings = self._definitions.delete(context, owner, workflow_id)
        self._runtime.retire_agents(context, inline_agent_retirement_candidates(bindings))

    def update_features(self, context: RequestContext, app_id: str, features: dict[str, Any]) -> None:
        self._lifecycle.validate_features(context, app_id, features)
        self._definitions.update_features(context, app_id, features)

    def generate(self, context: RequestContext, app_id: str, args: dict[str, Any]) -> WorkflowGeneration:
        return self._runtime.generate(context, app_id, args, root_node_id=None, workflow=None)

    def iteration(
        self, context: RequestContext, app_id: str, node_id: str, inputs: dict[str, Any] | None
    ) -> WorkflowGeneration:
        return self._runtime.iteration(context, app_id, node_id, inputs)

    def loop(
        self, context: RequestContext, app_id: str, node_id: str, inputs: dict[str, Any] | None
    ) -> WorkflowGeneration:
        return self._runtime.loop(context, app_id, node_id, inputs)

    def run_node(self, context: RequestContext, app_id: str, node_id: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._runtime.run_node(context, app_id, node_id, args, include_details=True, workflow=None)

    def last_run(self, context: RequestContext, app_id: str, node_id: str) -> dict[str, Any]:
        result = self._runtime.last_run(context, app_id, node_id)
        if result is None:
            raise WorkflowNotFoundError("last run not found")
        return result

    def trigger(
        self, context: RequestContext, app_id: str, node_ids: list[str], *, single_node: bool, select_all: bool
    ) -> WorkflowGeneration | None:
        event = self._runtime.poll_trigger(context, app_id, node_ids, single_node=single_node, select_all=select_all)
        if event is None:
            return None
        try:
            if single_node:
                return self._runtime.run_node(
                    context, app_id, event.node_id, event.workflow_args, include_details=False, workflow=event.workflow
                )
            return self._runtime.generate(
                context, app_id, event.workflow_args, root_node_id=event.node_id, workflow=event.workflow
            )
        except InvokeRateLimitError:
            if not single_node:
                raise
            raise WorkflowTriggerError("An unexpected error occurred while running the node.") from None
        except Exception:
            if not single_node and not select_all:
                raise
            logger.exception("Error running draft workflow trigger")
            raise WorkflowTriggerError(
                "An unexpected error occurred while running the node." if single_node else None
            ) from None

    def stop(self, task_id: str) -> None:
        self._runtime.stop(task_id)

    def default_blocks(self) -> Sequence[Mapping[str, object]]:
        return self._runtime.default_blocks()

    def default_block(self, block_type: str, filters: dict[str, Any] | None) -> Mapping[str, object] | None:
        return self._runtime.default_block(block_type, filters)

    def convert(self, context: RequestContext, app_id: str, args: dict[str, Any]) -> dict[str, Any]:
        new_app_id = self._conversion.convert(context, app_id, args)
        return {"new_app_id": new_app_id, "permission_keys": self._access.permission_keys(context, new_app_id)}

    def online_users(self, context: RequestContext, app_ids: list[str]) -> list[dict[str, Any]]:
        if len(app_ids) > MAX_WORKFLOW_ONLINE_USERS_REQUEST_IDS:
            raise ValueError(f"Maximum {MAX_WORKFLOW_ONLINE_USERS_REQUEST_IDS} app_ids are allowed per request.")
        if not app_ids:
            return []
        maintainers = self._apps.maintainers(context, app_ids)
        accessible = self._access.accessible_app_ids(context, maintainers)
        ordered = [app_id for app_id in app_ids if app_id in accessible]
        users_by_app = self._presence.online_users(ordered)
        results = []
        for app_id in ordered:
            users = []
            for info in users_by_app.get(app_id, []):
                user_id, username = info.get("user_id"), info.get("username")
                if not isinstance(user_id, str) or not isinstance(username, str):
                    continue
                avatar = info.get("avatar")
                if not isinstance(avatar, str):
                    avatar = None
                if avatar and not avatar.startswith(("http://", "https://")):
                    try:
                        avatar = self._access.avatar_url(avatar)
                    except Exception:
                        logger.warning("Failed to sign workflow online user avatar; app_id=%s", app_id, exc_info=True)
                users.append({"user_id": user_id, "username": username, "avatar": avatar})
            results.append({"app_id": app_id, "users": users})
        return results


def advisory_variable_reference_warning(graph_text: str | None) -> str | None:
    """A broken advisory checker must never roll back or fail publication."""
    if not graph_text:
        return None
    try:
        graph = json.loads(graph_text)
        if not isinstance(graph, dict):
            return None
        issues = validate_variable_references(graph)
        return format_variable_reference_errors(issues) if issues else None
    except Exception:
        logger.warning("Skipped advisory variable reference check", exc_info=True)
        return None
