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

from core.ops.provider_config import decrypt_provider_config, provider_config_identity, resolve_provider_config
from core.ops.trace_data import TraceProviderSettings, TraceSource

if TYPE_CHECKING:
    from core.ops.message_trace import MessageTraceRecorder


def _settings_hash(tenant_id: str, settings: dict[str, Any]) -> str:
    """Detect configuration changes with a tenant-scoped MAC, never authenticate passwords.

    SECRET_KEY prevents guesses of low-entropy credentials from a leaked digest.
    The digest only binds queued deliveries to the configuration they captured.
    """
    from configs import dify_config

    if not dify_config.SECRET_KEY:
        raise ValueError("OPS trace settings require SECRET_KEY")
    payload = json.dumps(settings, sort_keys=True, separators=(",", ":")).encode()
    message = b"ops-trace-settings\0" + tenant_id.encode() + b"\0" + payload
    return hmac.digest(dify_config.SECRET_KEY.encode(), message, "sha256").hex()


def _enterprise_config() -> dict[str, Any] | None:
    from enterprise.telemetry.enterprise_trace import load_enterprise_config

    return load_enterprise_config()


def get_trace_provider_settings(tenant_id: str, app_id: str | None = None) -> tuple[TraceProviderSettings, ...]:
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from extensions.ext_database import db
    from models.account import Tenant
    from models.enums import AppStatus
    from models.model import App, TraceAppConfig

    destinations: list[TraceProviderSettings] = []
    app_settings: TraceProviderSettings | None = None
    app_provider_config: dict[str, Any] = {}
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
                    app_provider_config = dict(config.tracing_config)
                    app_settings = TraceProviderSettings(
                        tenant_id=tenant_id,
                        app_id=app_id,
                        provider_name=provider_name,
                        config_id=config.id,
                        config_revision=app.tracing_destination_revision,
                    )
    if app_settings is not None:
        try:
            resolved_config = resolve_provider_config(app_settings.provider_name, app_provider_config)
            destinations.append(
                app_settings.model_copy(
                    update={
                        "destination_settings_hash": _settings_hash(
                            tenant_id, provider_config_identity(app_settings.provider_name, resolved_config)
                        )
                    }
                )
            )
        except Exception:
            logging.getLogger(__name__).warning(
                "Cannot resolve app tracing settings tenant_id=%s app_id=%s", tenant_id, app_id
            )
    try:
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
    except Exception:
        logging.getLogger(__name__).warning(
            "Cannot resolve enterprise tracing settings tenant_id=%s app_id=%s", tenant_id, app_id
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
        if enterprise_config is None or not hmac.compare_digest(
            _settings_hash(settings.tenant_id, enterprise_config).encode(), settings.destination_settings_hash.encode()
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
                App.tracing_destination_revision == settings.config_revision,
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
    resolved_config = resolve_provider_config(settings.provider_name, encrypted)
    if not hmac.compare_digest(
        _settings_hash(settings.tenant_id, provider_config_identity(settings.provider_name, resolved_config)).encode(),
        settings.destination_settings_hash.encode(),
    ):
        raise ValueError("configuration_changed")
    decrypted = decrypt_provider_config(settings.tenant_id, settings.provider_name, encrypted)
    if "_runtime_settings" in resolved_config:
        decrypted["_runtime_settings"] = resolved_config["_runtime_settings"]
    return decrypted


def create_message_trace(
    *,
    tenant_id: str,
    app_id: str | None = None,
    pipeline_id: str | None = None,
    user_id: str | None = None,
    operation_id: str | None = None,
    message_id: str | None = None,
    conversation_id: str | None = None,
    workflow_run_id: str | None = None,
    external_trace_id: str | None = None,
    session_id: str | None = None,
    record_message_result: Callable[[MessageTraceRecorder, Mapping[str, Any]], None] | None = None,
    attributes: Mapping[str, Any] | None = None,
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
            workflow_run_id=workflow_run_id,
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
            attributes={**read_trace_owner_fields(tenant_id, app_id), **(attributes or {})},
        )
    except Exception:
        logging.getLogger(__name__).warning("Cannot initialize OPS trace tenant_id=%s app_id=%s", tenant_id, app_id)
        return None


def read_trace_owner_fields(tenant_id: str, app_id: str | None) -> dict[str, Any]:
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from extensions.ext_database import db
    from models.account import Tenant
    from models.model import App

    with Session(db.engine) as session:
        workspace_name = session.scalar(select(Tenant.name).where(Tenant.id == tenant_id))
        fields: dict[str, Any] = {"workspace_name": workspace_name}
        if app_id is not None:
            row = session.execute(select(App.name, App.mode).where(App.tenant_id == tenant_id, App.id == app_id)).one()
            fields.update(app_name=row.name, app_mode=row.mode)
        return fields


def read_message_trace_fields(tenant_id: str, app_id: str, message_id: str) -> dict[str, Any]:
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from extensions.ext_database import db
    from models.model import App, Conversation, Message, MessageFile, UploadFile

    with Session(db.engine) as session:
        row = session.execute(
            select(Message, Conversation.mode, Conversation.invoke_from)
            .join(App, App.id == Message.app_id)
            .join(Conversation, (Conversation.id == Message.conversation_id) & (Conversation.app_id == App.id))
            .where(App.tenant_id == tenant_id, App.id == app_id, Message.id == message_id)
        ).first()
        if row is None:
            raise ValueError("Trace message not found")
        message, conversation_mode, invoke_from = row
        files = session.execute(
            select(MessageFile, UploadFile)
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
            "original_inputs": message.inputs_with_session(session=session),
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
                "conversation_mode": conversation_mode,
                "invoke_from": invoke_from,
                "from_account_id": message.from_account_id,
                "from_end_user_id": message.from_end_user_id,
            },
            "files": [
                {
                    "type": file.type,
                    "upload_file_id": upload.id if upload else None,
                    "transfer_method": file.transfer_method,
                    "url": (upload.source_url or file.url) if upload else file.url if not file.upload_file_id else None,
                    "name": upload.name if upload else None,
                    "mime_type": upload.mime_type if upload else None,
                    "size": upload.size if upload else None,
                }
                for file, upload in files
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
