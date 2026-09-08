"""Resolve tenant-owned trace sources and destination settings before capture or export."""

from __future__ import annotations

import hmac
import json
import logging
from collections.abc import Callable, Mapping
from datetime import timedelta
from functools import partial
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from core.ops.provider_config import decrypt_provider_config
from core.ops.trace_data import TraceProviderSettings, TraceSource

if TYPE_CHECKING:
    from core.ops.message_trace import MessageTraceRecorder


def _settings_hash(tenant_id: str, settings: dict[str, Any]) -> str:
    """Identify one configuration without publishing a guessable hash of its credentials."""
    from configs import dify_config

    if not dify_config.SECRET_KEY:
        raise ValueError("OPS trace settings require SECRET_KEY")
    payload = json.dumps(settings, sort_keys=True, separators=(",", ":")).encode()
    message = b"ops-trace-settings\0" + tenant_id.encode() + b"\0" + payload
    return hmac.digest(dify_config.SECRET_KEY.encode(), message, "sha256").hex()


def _enterprise_config() -> dict[str, Any] | None:
    from configs import dify_config
    from enterprise.telemetry.exporter import _parse_otlp_headers, is_enterprise_telemetry_enabled

    if not is_enterprise_telemetry_enabled():
        return None
    return {
        "endpoint": dify_config.ENTERPRISE_OTLP_ENDPOINT,
        "protocol": dify_config.ENTERPRISE_OTLP_PROTOCOL,
        "headers": _parse_otlp_headers(dify_config.ENTERPRISE_OTLP_HEADERS),
        "api_key": dify_config.ENTERPRISE_OTLP_API_KEY,
        "service_name": dify_config.APPLICATION_NAME,
        "include_content": dify_config.ENTERPRISE_INCLUDE_CONTENT,
        "sampling_rate": dify_config.ENTERPRISE_OTEL_SAMPLING_RATE,
    }


def get_trace_provider_settings(tenant_id: str, app_id: str | None = None) -> tuple[TraceProviderSettings, ...]:
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from extensions.ext_database import db
    from models.account import Tenant
    from models.enums import AppStatus
    from models.model import App, TraceAppConfig

    destinations: list[TraceProviderSettings] = []
    with Session(db.engine) as session:
        if session.scalar(select(Tenant.id).where(Tenant.id == tenant_id)) is None:
            raise ValueError("Trace tenant not found")
        if app_id is not None:
            rows = session.execute(
                select(App, TraceAppConfig)
                .outerjoin(TraceAppConfig, TraceAppConfig.app_id == App.id)
                .where(
                    App.tenant_id == tenant_id,
                    App.id == app_id,
                    App.status == AppStatus.NORMAL,
                )
            ).all()
            if not rows:
                raise ValueError("Trace app not found")
            app = rows[0][0]
            selected = json.loads(app.tracing) if app.tracing else {}
            provider_name = selected.get("tracing_provider")
            if selected.get("enabled") and isinstance(provider_name, str):
                config = next(
                    (row[1] for row in rows if row[1] is not None and row[1].tracing_provider == provider_name), None
                )
                if config is not None and config.tracing_config is not None:
                    destinations.append(
                        TraceProviderSettings(
                            tenant_id=tenant_id,
                            app_id=app_id,
                            provider_name=provider_name,
                            config_id=config.id,
                            config_revision=app.tracing_revision,
                            destination_settings_hash=_settings_hash(tenant_id, config.tracing_config),
                        )
                    )
    enterprise_config = _enterprise_config()
    if enterprise_config is not None:
        settings_hash = _settings_hash(tenant_id, enterprise_config)
        destinations.append(
            TraceProviderSettings(
                tenant_id=tenant_id,
                app_id=app_id,
                provider_name="enterprise",
                destination_type="enterprise",
                config_revision=int(settings_hash[:7], 16),
                destination_settings_hash=settings_hash,
            )
        )
    return tuple(destinations)


def load_trace_provider_config(settings: TraceProviderSettings) -> dict[str, Any]:
    """Authorize one exact revision and decrypt only its copied configuration."""
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from extensions.ext_database import db
    from models.enums import AppStatus
    from models.model import App, TraceAppConfig

    if settings.destination_type == "enterprise":
        from models.account import Tenant

        with Session(db.engine) as session:
            if session.scalar(select(Tenant.id).where(Tenant.id == settings.tenant_id)) is None:
                raise ValueError("configuration_changed")
            if (
                settings.app_id is not None
                and session.scalar(
                    select(App.id).where(
                        App.id == settings.app_id,
                        App.tenant_id == settings.tenant_id,
                        App.status == AppStatus.NORMAL,
                    )
                )
                is None
            ):
                raise ValueError("configuration_changed")
        enterprise_config = _enterprise_config()
        if (
            enterprise_config is None
            or _settings_hash(settings.tenant_id, enterprise_config) != settings.destination_settings_hash
        ):
            raise ValueError("configuration_changed")
        return enterprise_config
    with Session(db.engine) as session:
        row = session.execute(
            select(App, TraceAppConfig)
            .join(TraceAppConfig, TraceAppConfig.app_id == App.id)
            .where(
                App.tenant_id == settings.tenant_id,
                App.id == settings.app_id,
                App.status == AppStatus.NORMAL,
                App.tracing_revision == settings.config_revision,
                TraceAppConfig.id == settings.config_id,
                TraceAppConfig.tracing_provider == settings.provider_name,
            )
        ).first()
        if row is None:
            raise ValueError("configuration_changed")
        app, config = row
        selected = json.loads(app.tracing) if app.tracing else {}
        if not selected.get("enabled") or selected.get("tracing_provider") != settings.provider_name:
            raise ValueError("configuration_changed")
        encrypted = dict(config.tracing_config or {})
        if _settings_hash(settings.tenant_id, encrypted) != settings.destination_settings_hash:
            raise ValueError("configuration_changed")
    return decrypt_provider_config(settings.tenant_id, settings.provider_name, encrypted)


def create_message_trace(
    *,
    tenant_id: str,
    app_id: str | None = None,
    pipeline_id: str | None = None,
    user_id: str | None = None,
    operation_id: str | None = None,
    message_id: str | None = None,
    conversation_id: str | None = None,
    external_trace_id: str | None = None,
    session_id: str | None = None,
    record_message_result: Callable[[MessageTraceRecorder, Mapping[str, Any]], None] | None = None,
) -> MessageTraceRecorder | None:
    """Resolve the application's queue once and pass explicit ownership to the recorder."""
    from flask import current_app

    from core.ops.message_trace import MessageTraceRecorder

    try:
        trace_queue = current_app.extensions.get("ops_trace_queue")
        if trace_queue is None:
            return None
        source = TraceSource(
            tenant_id=tenant_id,
            app_id=app_id,
            pipeline_id=pipeline_id,
            actor_id=user_id,
            operation_id=operation_id or message_id or str(uuid4()),
            message_id=message_id,
            conversation_id=conversation_id,
            external_trace_id=external_trace_id,
            session_id=session_id,
        )
        settings = get_trace_provider_settings(tenant_id, app_id)
        if pipeline_id is not None:
            _require_pipeline(tenant_id, pipeline_id)
        return MessageTraceRecorder(
            source,
            trace_queue,
            settings,
            load_message_fields=partial(read_message_trace_fields, tenant_id, app_id) if app_id else None,
            record_message_result=record_message_result,
            load_provider_settings=get_trace_provider_settings,
        )
    except Exception:
        logging.getLogger(__name__).warning("Cannot initialize OPS trace tenant_id=%s app_id=%s", tenant_id, app_id)
        return None


def read_message_trace_fields(tenant_id: str, app_id: str, message_id: str) -> dict[str, Any]:
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from extensions.ext_database import db
    from models.model import App, Conversation, Message, MessageFile, UploadFile

    with Session(db.engine) as session:
        message = session.scalar(
            select(Message)
            .join(App, App.id == Message.app_id)
            .join(Conversation, (Conversation.id == Message.conversation_id) & (Conversation.app_id == App.id))
            .where(App.tenant_id == tenant_id, App.id == app_id, Message.id == message_id)
        )
        if message is None:
            raise ValueError("Trace message not found")
        files = session.execute(
            select(MessageFile, UploadFile.id)
            .outerjoin(
                UploadFile,
                (UploadFile.id == MessageFile.upload_file_id) & (UploadFile.tenant_id == tenant_id),
            )
            .where(MessageFile.message_id == message.id)
        ).all()
        return {
            "message_id": message.id,
            "conversation_id": message.conversation_id,
            "workflow_run_id": message.workflow_run_id,
            "inputs": message.message,
            "query": message.query,
            "outputs": message.answer,
            "started_at": message.created_at,
            "ended_at": max(
                message.updated_at or message.created_at,
                message.created_at + timedelta(seconds=message.provider_response_latency or 0),
            ),
            "error": message.error,
            "model_provider": message.model_provider,
            "model_name": message.model_id,
            "prompt_tokens": message.message_tokens,
            "completion_tokens": message.answer_tokens,
            "total_price": str(message.total_price),
            "currency": message.currency,
            "metadata": {
                **(json.loads(message.message_metadata) if message.message_metadata else {}),
                "from_source": message.from_source,
                "status": message.status,
                "agent_based": message.agent_based,
            },
            "files": [
                {"type": file.type, "upload_file_id": upload_file_id, "transfer_method": file.transfer_method}
                for file, upload_file_id in files
            ],
        }


def _require_pipeline(tenant_id: str, pipeline_id: str) -> None:
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from extensions.ext_database import db
    from models.dataset import Pipeline

    with Session(db.engine) as session:
        if (
            session.scalar(select(Pipeline.id).where(Pipeline.tenant_id == tenant_id, Pipeline.id == pipeline_id))
            is None
        ):
            raise ValueError("Trace pipeline not found")


def record_enterprise_operation(event) -> None:
    """Authorize draft execution and prompt/code generation before copying trace data."""
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from core.telemetry.events import DraftNodeExecutionTraceEvent, PromptGenerationEvent
    from extensions.ext_database import db
    from models.dataset import Pipeline
    from models.model import App
    from models.workflow import Workflow, WorkflowType

    tenant_id = event.context.tenant_id
    if not tenant_id:
        return
    app_id, pipeline_id = event.context.app_id, None
    if isinstance(event, DraftNodeExecutionTraceEvent):
        node = event.payload["node_execution_data"]
        if node.get("tenant_id") != tenant_id or node.get("app_id") != app_id:
            raise ValueError("Trace execution owner mismatch")
        with Session(db.engine) as session:
            workflow = session.scalar(
                select(Workflow).where(
                    Workflow.tenant_id == tenant_id,
                    Workflow.id == node["workflow_id"],
                    Workflow.app_id == app_id,
                )
            )
            if workflow is None:
                raise ValueError("Trace workflow not found")
            if workflow.type == WorkflowType.RAG_PIPELINE:
                pipeline_id, app_id = app_id, None
                if (
                    session.scalar(
                        select(Pipeline.id).where(Pipeline.id == pipeline_id, Pipeline.tenant_id == tenant_id)
                    )
                    is None
                ):
                    raise ValueError("Trace pipeline not found")
            elif session.scalar(select(App.id).where(App.id == app_id, App.tenant_id == tenant_id)) is None:
                raise ValueError("Trace app not found")
    elif isinstance(event, PromptGenerationEvent):
        if event.payload["tenant_id"] != tenant_id or event.payload.get("app_id") not in (None, app_id):
            raise ValueError("Trace operation owner mismatch")
    else:
        return
    recorder = create_message_trace(
        tenant_id=tenant_id, app_id=app_id, pipeline_id=pipeline_id, user_id=event.context.user_id
    )
    if recorder is None:
        return
    recorder.provider_settings = tuple(
        settings for settings in recorder.provider_settings if settings.destination_type == "enterprise"
    )
    if isinstance(event, DraftNodeExecutionTraceEvent):
        node = event.payload["node_execution_data"]
        recorder.record_operation(
            node.get("title") or "draft_node",
            span_type=str(node.get("node_type") or "operation"),
            inputs=node.get("node_inputs"),
            outputs=node.get("node_outputs"),
            error=node.get("error"),
            timer={"start": node.get("created_at"), "end": node.get("finished_at")},
            attributes={
                "operation_type": "draft_node_execution",
                **{
                    name: node.get(name)
                    for name in (
                        "node_id",
                        "node_type",
                        "node_execution_id",
                        "workflow_id",
                        "model_name",
                        "model_provider",
                        "tool_name",
                    )
                },
            },
            usage={
                name: node.get(name)
                for name in ("prompt_tokens", "completion_tokens", "total_tokens", "total_price", "currency")
            },
            independent=True,
        )
    else:
        payload = event.payload
        recorder.record_operation(
            str(payload["operation_type"]),
            span_type="llm",
            inputs=payload["instruction"],
            outputs=payload["generated_output"],
            error=payload.get("error"),
            timer=payload.get("timer"),
            attributes={"model_provider": payload["model_provider"], "model_name": payload["model_name"]},
            usage={
                name: payload.get(name)
                for name in ("prompt_tokens", "completion_tokens", "total_tokens", "total_price", "currency", "latency")
            },
            independent=True,
        )
