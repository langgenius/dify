"""Materialize app response data while the repository Session is open."""

from collections.abc import Mapping, Sequence
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.model import App, Site, load_annotation_reply_config
from models.tools import ApiToolProvider
from services.entities.app_entities import AppRecord, AppSummary, AppToolReference


def app_summary(app: App) -> AppSummary:
    return AppSummary(
        id=app.id,
        tenant_id=app.tenant_id,
        name=app.name,
        description=app.description,
        mode=app.mode,
        status=app.status,
        updated_at=app.updated_at,
        maintainer=app.maintainer,
    )


def app_record(
    app: App, *, session: Session, projection: Literal["list", "detail", "detail-with-site"] = "list"
) -> AppRecord:
    """Materialize the requested projection without resolving request-dependent URLs."""
    detail = projection != "list"
    with_site = projection == "detail-with-site"
    config = app.app_model_config_with_session(session=session)
    model_config: dict[str, Any] | None = None
    if config is not None:
        model_config = {
            "model": config.model_dict,
            "pre_prompt": config.pre_prompt,
            "created_by": config.created_by,
            "created_at": config.created_at,
            "updated_by": config.updated_by,
            "updated_at": config.updated_at,
        }
        if detail:
            model_config.update(config.to_dict(annotation_reply=load_annotation_reply_config(session, app.id)))
    workflow = app.workflow_with_session(session=session)
    workflow_data = (
        None
        if workflow is None
        else {
            "id": workflow.id,
            "created_by": workflow.created_by,
            "created_at": workflow.created_at,
            "updated_by": workflow.updated_by,
            "updated_at": workflow.updated_at,
        }
    )
    site = app.site_with_session(session=session) if with_site else None
    site_data = (
        None
        if site is None
        else {
            column.name: getattr(site, column.name)  # guard-ignore: no-new-getattr -- SQLAlchemy mapped columns
            for column in Site.__table__.columns
        }
    )
    return AppRecord(
        id=app.id,
        name=app.name,
        mode_compatible_with_agent=app.mode_compatible_with_agent_with_session(session=session),
        description=app.description,
        desc_or_prompt=None if detail else app.desc_or_prompt_with_session(session=session),
        icon_type=app.icon_type,
        icon=app.icon,
        icon_background=app.icon_background,
        enable_site=app.enable_site,
        enable_api=app.enable_api,
        max_active_requests=app.max_active_requests,
        use_icon_as_answer_icon=app.use_icon_as_answer_icon,
        created_by=app.created_by,
        created_at=app.created_at,
        updated_by=app.updated_by,
        updated_at=app.updated_at,
        maintainer=app.maintainer,
        author_name=None if detail else app.author_name_with_session(session=session),
        app_model_config=model_config,
        workflow=workflow_data,
        site=site_data,
        tracing=app.tracing,
        bound_agent_id=app.bound_agent_id_with_session(session=session) if projection != "detail" else None,
        tags=[{"id": tag.id, "name": tag.name, "type": tag.type} for tag in app.tags_with_session(session=session)],
        tool_references=load_app_tool_references(
            tenant_id=app.tenant_id, tools=config.agent_mode_dict.get("tools", []), session=session
        )
        if with_site and config
        else (),
        is_starred=bool(app.__dict__.get("is_starred", False)),
    )


def load_app_tool_references(
    *, tenant_id: str, tools: Sequence[Mapping[str, Any]], session: Session
) -> tuple[AppToolReference, ...]:
    """Load API provider existence without resolving plugin or hardcoded builtin providers."""
    references: list[AppToolReference] = []
    api_provider_ids: list[str] = []
    for tool in tools:
        if len(tool) < 4:
            continue
        provider_type = tool.get("provider_type", "")
        provider_id = tool.get("provider_id", "")
        if provider_type == "api":
            try:
                UUID(provider_id)
            except (ValueError, TypeError, AttributeError):
                continue
            api_provider_ids.append(provider_id)
        elif provider_type != "builtin":
            continue
        references.append(AppToolReference(provider_type, provider_id, tool["tool_name"]))

    existing_ids = (
        set(
            session.scalars(
                select(ApiToolProvider.id).where(
                    ApiToolProvider.tenant_id == tenant_id, ApiToolProvider.id.in_(api_provider_ids)
                )
            )
        )
        if api_provider_ids
        else set()
    )
    return tuple(
        AppToolReference(ref.provider_type, ref.provider_id, ref.tool_name, ref.provider_id in existing_ids)
        if ref.provider_type == "api"
        else ref
        for ref in references
    )
