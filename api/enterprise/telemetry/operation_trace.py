"""Authorize and capture enterprise draft and generation trace events."""

import logging

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from core.ops.trace_source import create_message_trace


def _read_draft_model_credential(
    session: Session, *, tenant_id: str, provider_name: str | None, model_name: str | None
) -> dict[str, str]:
    """Read configured identity only; a deleted credential keeps its ID without a name."""
    from graphon.model_runtime.entities.model_entities import ModelType
    from models.provider import Provider, ProviderCredential, ProviderModel, ProviderModelCredential, ProviderType

    if not provider_name:
        return {}
    credential_ids = session.execute(
        select(Provider.credential_id, ProviderModel.credential_id)
        .outerjoin(
            ProviderModel,
            (ProviderModel.tenant_id == Provider.tenant_id)
            & (ProviderModel.provider_name == Provider.provider_name)
            & (ProviderModel.model_name == model_name)
            & (ProviderModel.model_type == ModelType.LLM),
        )
        .where(
            Provider.tenant_id == tenant_id,
            Provider.provider_name == provider_name,
            Provider.provider_type == ProviderType.CUSTOM,
        )
    ).first()
    if credential_ids is None:
        return {}
    provider_credential_id, model_credential_id = credential_ids
    credential_id = model_credential_id or provider_credential_id
    if not credential_id:
        return {}
    if model_credential_id:
        credential_name_query = select(ProviderModelCredential.credential_name).where(
            ProviderModelCredential.id == credential_id,
            ProviderModelCredential.tenant_id == tenant_id,
            ProviderModelCredential.provider_name == provider_name,
            ProviderModelCredential.model_name == model_name,
            ProviderModelCredential.model_type == ModelType.LLM,
        )
    else:
        credential_name_query = select(ProviderCredential.credential_name).where(
            ProviderCredential.id == credential_id,
            ProviderCredential.tenant_id == tenant_id,
            ProviderCredential.provider_name == provider_name,
        )
    return {"credential_id": credential_id, "credential_name": session.scalar(credential_name_query) or ""}


def record_enterprise_operation(event) -> None:
    """Authorize draft execution and prompt/code generation before copying trace data."""
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
        credential_fields: dict[str, str] = {}
        if recorder.provider_settings and node.get("model_provider"):
            try:
                with Session(db.engine) as session:
                    credential_fields = _read_draft_model_credential(
                        session,
                        tenant_id=tenant_id,
                        provider_name=node.get("model_provider"),
                        model_name=node.get("model_name"),
                    )
            except SQLAlchemyError:
                logging.getLogger(__name__).warning("Cannot read draft trace credential tenant_id=%s", tenant_id)
        recorder.record_operation(
            node.get("title") or "draft_node",
            span_type=str(node.get("node_type") or "operation"),
            workflow_id=node["workflow_id"],
            node_execution_id=node.get("node_execution_id"),
            node_id=node.get("node_id"),
            inputs=node.get("node_inputs"),
            outputs=node.get("node_outputs"),
            error=node.get("error"),
            timer={"start": node.get("created_at"), "end": node.get("finished_at")},
            attributes={
                "operation_type": "draft_node_execution",
                "business_status": node.get("status"),
                **credential_fields,
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
                        "index",
                        "predecessor_node_id",
                        "iteration_id",
                        "iteration_index",
                        "loop_id",
                        "loop_index",
                        "parallel_id",
                        "process_data",
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
