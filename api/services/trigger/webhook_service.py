"""Native webhook admission and execution, independent of HTTP and SQL sessions."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Protocol, TypedDict

from enums import QuotaType
from graphon.entities.graph_config import NodeConfigDict
from graphon.file import File
from models.enums import AppTriggerStatus
from services.async_workflow_service import TriggerWorkflowDispatcher
from services.errors.app import QuotaExceededError
from services.quota_service import QuotaCharge
from services.trigger.workflow_dispatch_service import TriggerEndUserProvisioner
from services.workflow.entities import TriggerActor, WebhookTriggerData


class WebhookNotFoundError(Exception):
    """The webhook or its admitted workflow is unavailable."""


class RawWebhookDataDict(TypedDict):
    method: str
    headers: dict[str, str]
    query_params: dict[str, Any]
    body: dict[str, Any]
    files: dict[str, Any]


class WorkflowInputsDict(TypedDict):
    webhook_data: RawWebhookDataDict
    webhook_headers: dict[str, str]
    webhook_query_params: dict[str, Any]
    webhook_body: dict[str, Any]


@dataclass(frozen=True, slots=True)
class WebhookContext:
    tenant_id: str
    app_id: str
    webhook_id: str
    node_id: str
    created_by: str
    workflow_id: str
    node_config: NodeConfigDict
    # Draft lookup does not require a published AppTrigger record.
    status: AppTriggerStatus | None


@dataclass(frozen=True, slots=True)
class UnavailableWebhook:
    """Inactive published triggers are admitted before loading workflow configuration."""

    tenant_id: str
    status: AppTriggerStatus


class WebhookQuery(Protocol):
    def get_webhook_context(self, *, webhook_id: str, debug: bool) -> WebhookContext | UnavailableWebhook: ...


class WebhookFiles(Protocol):
    def create(self, *, tenant_id: str, user_id: str, content: bytes, mimetype: str) -> File: ...


class WebhookBindingWriter(Protocol):
    def __call__(self, *, tenant_id: str, app_id: str, created_by: str | None, node_ids: Sequence[str]) -> None: ...


def build_webhook_workflow_inputs(webhook_data: RawWebhookDataDict) -> WorkflowInputsDict:
    return {
        "webhook_data": webhook_data,
        "webhook_headers": webhook_data.get("headers", {}),
        "webhook_query_params": webhook_data.get("query_params", {}),
        "webhook_body": webhook_data.get("body", {}),
    }


class WebhookBindingService:
    MAX_WEBHOOK_NODES_PER_WORKFLOW = 5

    def __init__(self, *, sync_bindings: WebhookBindingWriter) -> None:
        self._sync_bindings = sync_bindings

    def sync(self, *, tenant_id: str, app_id: str, created_by: str | None, node_ids: Sequence[str]) -> None:
        if len(node_ids) > self.MAX_WEBHOOK_NODES_PER_WORKFLOW:
            raise ValueError(
                "Workflow exceeds maximum webhook node limit. "
                f"Found {len(node_ids)} webhook nodes, maximum allowed is {self.MAX_WEBHOOK_NODES_PER_WORKFLOW}"
            )
        self._sync_bindings(tenant_id=tenant_id, app_id=app_id, created_by=created_by, node_ids=node_ids)


class WebhookService:
    def __init__(
        self,
        *,
        webhooks: WebhookQuery,
        end_users: TriggerEndUserProvisioner,
        dispatch: TriggerWorkflowDispatcher,
        reserve_quota: Callable[[QuotaType, str], QuotaCharge],
        mark_rate_limited: Callable[[str], None],
    ) -> None:
        self._webhooks = webhooks
        self._end_users = end_users
        self._dispatch = dispatch
        self._reserve_quota = reserve_quota
        self._mark_rate_limited = mark_rate_limited

    def prepare(self, *, webhook_id: str, debug: bool) -> WebhookContext:
        context = self._webhooks.get_webhook_context(webhook_id=webhook_id, debug=debug)
        if isinstance(context, UnavailableWebhook):
            if context.status == AppTriggerStatus.RATE_LIMITED:
                raise QuotaExceededError(feature=QuotaType.TRIGGER.value, tenant_id=context.tenant_id, required=1)
            raise WebhookNotFoundError(f"Webhook trigger is disabled for webhook {webhook_id}")
        return context

    def resolve_actor(self, *, context: WebhookContext) -> TriggerActor:
        return self._end_users.get_or_create_trigger_end_user(tenant_id=context.tenant_id, app_id=context.app_id)

    def execute(
        self,
        *,
        context: WebhookContext,
        data: RawWebhookDataDict,
        actor: TriggerActor | None = None,
    ) -> None:
        resolved_actor = actor or self.resolve_actor(context=context)
        try:
            charge = self._reserve_quota(QuotaType.TRIGGER, context.tenant_id)
        except QuotaExceededError:
            self._mark_rate_limited(context.tenant_id)
            raise
        try:
            self._dispatch.trigger_workflow_async(
                actor=resolved_actor,
                trigger_data=WebhookTriggerData(
                    tenant_id=context.tenant_id,
                    app_id=context.app_id,
                    workflow_id=context.workflow_id,
                    root_node_id=context.node_id,
                    inputs=build_webhook_workflow_inputs(data),
                ),
            )
            charge.commit()
        except Exception:
            charge.refund()
            raise
