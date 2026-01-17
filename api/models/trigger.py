import json
import time
from collections.abc import Mapping
from datetime import datetime
from functools import cached_property
from typing import Any, cast
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy import DateTime, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.api_entities import TriggerProviderSubscriptionApiEntity
from core.trigger.entities.entities import Subscription
from core.trigger.utils.endpoint import generate_plugin_trigger_endpoint_url, generate_webhook_trigger_endpoint
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7

from .base import TypeBase
from .engine import db
from .enums import AppTriggerStatus, AppTriggerType, CreatorUserRole, WorkflowTriggerStatus
from .model import Account
from .types import EnumText, LongText, StringUUID


class TriggerSubscription(TypeBase):
    """
    Trigger provider model for managing credentials
    Supports multiple credential instances per provider
    """

    __tablename__ = "trigger_subscriptions"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="trigger_provider_pkey"),
        Index("idx_trigger_providers_tenant_provider", "tenant_id", "provider_id"),
        # Primary index for O(1) lookup by endpoint
        Index("idx_trigger_providers_endpoint", "endpoint_id", unique=True),
        # Composite index for tenant-specific queries (optional, kept for compatibility)
        Index("idx_trigger_providers_tenant_endpoint", "tenant_id", "endpoint_id"),
        UniqueConstraint("tenant_id", "provider_id", "name", name="unique_trigger_provider"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, comment="Subscription instance name")
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_id: Mapped[str] = mapped_column(
        String(255), nullable=False, comment="Provider identifier (e.g., plugin_id/provider_name)"
    )
    endpoint_id: Mapped[str] = mapped_column(String(255), nullable=False, comment="Subscription endpoint")
    parameters: Mapped[dict[str, Any]] = mapped_column(sa.JSON, nullable=False, comment="Subscription parameters JSON")
    properties: Mapped[dict[str, Any]] = mapped_column(sa.JSON, nullable=False, comment="Subscription properties JSON")

    credentials: Mapped[dict[str, Any]] = mapped_column(
        sa.JSON, nullable=False, comment="Subscription credentials JSON"
    )
    credential_type: Mapped[str] = mapped_column(String(50), nullable=False, comment="oauth or api_key")
    credential_expires_at: Mapped[int] = mapped_column(
        Integer, default=-1, comment="OAuth token expiration timestamp, -1 for never"
    )
    expires_at: Mapped[int] = mapped_column(
        Integer, default=-1, comment="Subscription instance expiration timestamp, -1 for never"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        server_onupdate=func.current_timestamp(),
        init=False,
    )

    def is_credential_expired(self) -> bool:
        """Check if credential is expired"""
        if self.credential_expires_at == -1:
            return False
        # Check if token expires in next 3 minutes
        return (self.credential_expires_at - 180) < int(time.time())

    def to_entity(self) -> Subscription:
        return Subscription(
            expires_at=self.expires_at,
            endpoint=generate_plugin_trigger_endpoint_url(self.endpoint_id),
            parameters=self.parameters,
            properties=self.properties,
        )

    def to_api_entity(self) -> TriggerProviderSubscriptionApiEntity:
        return TriggerProviderSubscriptionApiEntity(
            id=self.id,
            name=self.name,
            provider=self.provider_id,
            endpoint=generate_plugin_trigger_endpoint_url(self.endpoint_id),
            parameters=self.parameters,
            properties=self.properties,
            credential_type=CredentialType(self.credential_type),
            credentials=self.credentials,
            workflows_in_use=-1,
        )


# system level trigger oauth client params
class TriggerOAuthSystemClient(TypeBase):
    __tablename__ = "trigger_oauth_system_clients"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="trigger_oauth_system_client_pkey"),
        sa.UniqueConstraint("plugin_id", "provider", name="trigger_oauth_system_client_plugin_id_provider_idx"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    plugin_id: Mapped[str] = mapped_column(String(255), nullable=False)
    provider: Mapped[str] = mapped_column(String(255), nullable=False)
    # oauth params of the trigger provider
    encrypted_oauth_params: Mapped[str] = mapped_column(LongText, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        server_onupdate=func.current_timestamp(),
        init=False,
    )


# tenant level trigger oauth client params (client_id, client_secret, etc.)
class TriggerOAuthTenantClient(TypeBase):
    __tablename__ = "trigger_oauth_tenant_clients"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="trigger_oauth_tenant_client_pkey"),
        sa.UniqueConstraint("tenant_id", "plugin_id", "provider", name="unique_trigger_oauth_tenant_client"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    # tenant id
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    plugin_id: Mapped[str] = mapped_column(String(255), nullable=False)
    provider: Mapped[str] = mapped_column(String(255), nullable=False)
    enabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("true"), default=True)
    # oauth params of the trigger provider
    encrypted_oauth_params: Mapped[str] = mapped_column(LongText, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        server_onupdate=func.current_timestamp(),
        init=False,
    )

    @property
    def oauth_params(self) -> Mapping[str, Any]:
        return cast(Mapping[str, Any], json.loads(self.encrypted_oauth_params or "{}"))


class WorkflowTriggerLog(TypeBase):
    """
    Workflow Trigger Log

    Track async trigger workflow runs with re-invocation capability

    Attributes:
    - id (uuid) Trigger Log ID (used as workflow_trigger_log_id)
    - tenant_id (uuid) Workspace ID
    - app_id (uuid) App ID
    - workflow_id (uuid) Workflow ID
    - workflow_run_id (uuid) Optional - Associated workflow run ID when execution starts
    - root_node_id (string) Optional - Custom starting node ID for workflow execution
    - trigger_metadata (text) Optional - Trigger metadata (JSON)
    - trigger_type (string) Type of trigger: webhook, schedule, plugin
    - trigger_data (text) Full trigger data including inputs (JSON)
    - inputs (text) Input parameters (JSON)
    - outputs (text) Optional - Output content (JSON)
    - status (string) Execution status
    - error (text) Optional - Error message if failed
    - queue_name (string) Celery queue used
    - celery_task_id (string) Optional - Celery task ID for tracking
    - retry_count (int) Number of retry attempts
    - elapsed_time (float) Optional - Time consumption in seconds
    - total_tokens (int) Optional - Total tokens used
    - created_by_role (string) Creator role: account, end_user
    - created_by (string) Creator ID
    - created_at (timestamp) Creation time
    - triggered_at (timestamp) Optional - When actually triggered
    - finished_at (timestamp) Optional - Completion time
    """

    __tablename__ = "workflow_trigger_logs"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workflow_trigger_log_pkey"),
        sa.Index("workflow_trigger_log_tenant_app_idx", "tenant_id", "app_id"),
        sa.Index("workflow_trigger_log_status_idx", "status"),
        sa.Index("workflow_trigger_log_created_at_idx", "created_at"),
        sa.Index("workflow_trigger_log_workflow_run_idx", "workflow_run_id"),
        sa.Index("workflow_trigger_log_workflow_id_idx", "workflow_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_run_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    root_node_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    trigger_metadata: Mapped[str] = mapped_column(LongText, nullable=False)
    trigger_type: Mapped[str] = mapped_column(EnumText(AppTriggerType, length=50), nullable=False)
    trigger_data: Mapped[str] = mapped_column(LongText, nullable=False)  # Full TriggerData as JSON
    inputs: Mapped[str] = mapped_column(LongText, nullable=False)  # Just inputs for easy viewing
    outputs: Mapped[str | None] = mapped_column(LongText, nullable=True)

    status: Mapped[str] = mapped_column(EnumText(WorkflowTriggerStatus, length=50), nullable=False)
    error: Mapped[str | None] = mapped_column(LongText, nullable=True)

    queue_name: Mapped[str] = mapped_column(String(100), nullable=False)
    celery_task_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by_role: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)
    retry_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    elapsed_time: Mapped[float | None] = mapped_column(sa.Float, nullable=True, default=None)
    total_tokens: Mapped[int | None] = mapped_column(sa.Integer, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    triggered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    @property
    def created_by_account(self):
        created_by_role = CreatorUserRole(self.created_by_role)
        return db.session.get(Account, self.created_by) if created_by_role == CreatorUserRole.ACCOUNT else None

    @property
    def created_by_end_user(self):
        from .model import EndUser

        created_by_role = CreatorUserRole(self.created_by_role)
        return db.session.get(EndUser, self.created_by) if created_by_role == CreatorUserRole.END_USER else None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses"""
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "app_id": self.app_id,
            "workflow_id": self.workflow_id,
            "workflow_run_id": self.workflow_run_id,
            "root_node_id": self.root_node_id,
            "trigger_metadata": json.loads(self.trigger_metadata) if self.trigger_metadata else None,
            "trigger_type": self.trigger_type,
            "trigger_data": json.loads(self.trigger_data),
            "inputs": json.loads(self.inputs),
            "outputs": json.loads(self.outputs) if self.outputs else None,
            "status": self.status,
            "error": self.error,
            "queue_name": self.queue_name,
            "celery_task_id": self.celery_task_id,
            "retry_count": self.retry_count,
            "elapsed_time": self.elapsed_time,
            "total_tokens": self.total_tokens,
            "created_by_role": self.created_by_role,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "triggered_at": self.triggered_at.isoformat() if self.triggered_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
        }


class WorkflowWebhookTrigger(TypeBase):
    """
    Workflow Webhook Trigger

    Attributes:
    - id (uuid) Primary key
    - app_id (uuid) App ID to bind to a specific app
    - node_id (varchar) Node ID which node in the workflow
    - tenant_id (uuid) Workspace ID
    - webhook_id (varchar) Webhook ID for URL: https://api.dify.ai/triggers/webhook/:webhook_id
    - created_by (varchar) User ID of the creator
    - created_at (timestamp) Creation time
    - updated_at (timestamp) Last update time
    """

    __tablename__ = "workflow_webhook_triggers"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workflow_webhook_trigger_pkey"),
        sa.Index("workflow_webhook_trigger_tenant_idx", "tenant_id"),
        sa.UniqueConstraint("app_id", "node_id", name="uniq_node"),
        sa.UniqueConstraint("webhook_id", name="uniq_webhook_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    node_id: Mapped[str] = mapped_column(String(64), nullable=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    webhook_id: Mapped[str] = mapped_column(String(24), nullable=False)
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        server_onupdate=func.current_timestamp(),
        init=False,
    )

    @cached_property
    def webhook_url(self):
        """
        Generated webhook url
        """
        return generate_webhook_trigger_endpoint(self.webhook_id)

    @cached_property
    def webhook_debug_url(self):
        """
        Generated debug webhook url
        """
        return generate_webhook_trigger_endpoint(self.webhook_id, True)


class WorkflowPluginTrigger(TypeBase):
    """
    Workflow Plugin Trigger

    Maps plugin triggers to workflow nodes, similar to WorkflowWebhookTrigger

    Attributes:
    - id (uuid) Primary key
    - app_id (uuid) App ID to bind to a specific app
    - node_id (varchar) Node ID which node in the workflow
    - tenant_id (uuid) Workspace ID
    - provider_id (varchar) Plugin provider ID
    - event_name (varchar) trigger name
    - subscription_id (varchar) Subscription ID
    - created_at (timestamp) Creation time
    - updated_at (timestamp) Last update time
    """

    __tablename__ = "workflow_plugin_triggers"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workflow_plugin_trigger_pkey"),
        sa.Index("workflow_plugin_trigger_tenant_subscription_idx", "tenant_id", "subscription_id", "event_name"),
        sa.UniqueConstraint("app_id", "node_id", name="uniq_app_node_subscription"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    node_id: Mapped[str] = mapped_column(String(64), nullable=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider_id: Mapped[str] = mapped_column(String(512), nullable=False)
    event_name: Mapped[str] = mapped_column(String(255), nullable=False)
    subscription_id: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        server_onupdate=func.current_timestamp(),
        init=False,
    )


class AppTrigger(TypeBase):
    """
    App Trigger

    Manages multiple triggers for an app with enable/disable and authorization states.

    Attributes:
    - id (uuid) Primary key
    - tenant_id (uuid) Workspace ID
    - app_id (uuid) App ID
    - trigger_type (string) Type: webhook, schedule, plugin
    - title (string) Trigger title

    - status (string) Status: enabled, disabled, unauthorized, error
    - node_id (string) Optional workflow node ID
    - created_at (timestamp) Creation time
    - updated_at (timestamp) Last update time
    """

    __tablename__ = "app_triggers"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="app_trigger_pkey"),
        sa.Index("app_trigger_tenant_app_idx", "tenant_id", "app_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    node_id: Mapped[str | None] = mapped_column(String(64), nullable=False)
    trigger_type: Mapped[str] = mapped_column(EnumText(AppTriggerType, length=50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_name: Mapped[str | None] = mapped_column(String(255), nullable=True, server_default="", default="")
    status: Mapped[str] = mapped_column(
        EnumText(AppTriggerStatus, length=50), nullable=False, default=AppTriggerStatus.ENABLED
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=naive_utc_now(),
        server_onupdate=func.current_timestamp(),
        init=False,
    )


class WorkflowSchedulePlan(TypeBase):
    """
    Workflow Schedule Configuration

    Store schedule configurations for time-based workflow triggers.
    Uses cron expressions with timezone support for flexible scheduling.

    Attributes:
    - id (uuid) Primary key
    - app_id (uuid) App ID to bind to a specific app
    - node_id (varchar) Starting node ID for workflow execution
    - tenant_id (uuid) Workspace ID for multi-tenancy
    - cron_expression (varchar) Cron expression defining schedule pattern
    - timezone (varchar) Timezone for cron evaluation (e.g., 'Asia/Shanghai')
    - next_run_at (timestamp) Next scheduled execution time
    - created_at (timestamp) Creation timestamp
    - updated_at (timestamp) Last update timestamp
    """

    __tablename__ = "workflow_schedule_plans"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workflow_schedule_plan_pkey"),
        sa.UniqueConstraint("app_id", "node_id", name="uniq_app_node"),
        sa.Index("workflow_schedule_plan_next_idx", "next_run_at"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID,
        primary_key=True,
        insert_default=lambda: str(uuidv7()),
        default_factory=lambda: str(uuidv7()),
        init=False,
    )
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    node_id: Mapped[str] = mapped_column(String(64), nullable=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)

    # Schedule configuration
    cron_expression: Mapped[str] = mapped_column(String(255), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)

    # Schedule control
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp(), init=False
    )

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary representation"""
        return {
            "id": self.id,
            "app_id": self.app_id,
            "node_id": self.node_id,
            "tenant_id": self.tenant_id,
            "cron_expression": self.cron_expression,
            "timezone": self.timezone,
            "next_run_at": self.next_run_at.isoformat() if self.next_run_at else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
