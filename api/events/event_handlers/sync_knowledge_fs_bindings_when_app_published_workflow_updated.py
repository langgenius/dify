from __future__ import annotations

from typing import cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from core.workflow.nodes.knowledge_retrieval_v2.validation import collect_control_space_ids
from events.app_event import app_published_workflow_was_updated
from extensions.ext_database import db
from models.knowledge_fs import AppKnowledgeFSSpaceJoin, KnowledgeFSAppSpaceJoinType
from models.model import App
from models.workflow import Workflow
from services.knowledge_fs.runtime import get_knowledge_fs_runtime


@app_published_workflow_was_updated.connect
def handle(sender: object, **kwargs: object) -> None:
    app = cast(App, sender)
    published_workflow = cast(Workflow, kwargs["published_workflow"])
    publish_session = cast(Session | None, kwargs.get("session"))
    control_space_ids = get_control_space_ids_from_workflow(published_workflow)

    if not control_space_ids:
        lookup_session = publish_session if publish_session is not None else db.session
        existing_binding = lookup_session.scalar(
            select(AppKnowledgeFSSpaceJoin.id)
            .where(
                AppKnowledgeFSSpaceJoin.tenant_id == app.tenant_id,
                AppKnowledgeFSSpaceJoin.app_id == app.id,
                AppKnowledgeFSSpaceJoin.join_type == KnowledgeFSAppSpaceJoinType.WORKFLOW,
            )
            .limit(1)
        )
        if existing_binding is None:
            return

    runtime = get_knowledge_fs_runtime(session_factory.get_session_maker())
    sync_kwargs: dict[str, object] = {}
    if publish_session is not None:
        sync_kwargs["session"] = publish_session
    runtime.app_bindings.sync_workflow_bindings(
        tenant_id=app.tenant_id,
        actor_account_id=published_workflow.created_by,
        app_id=app.id,
        control_space_ids=list(control_space_ids),
        **sync_kwargs,
    )


def get_control_space_ids_from_workflow(published_workflow: Workflow) -> tuple[str, ...]:
    graph = published_workflow.graph_dict
    return collect_control_space_ids(graph) if isinstance(graph, dict) else ()


__all__ = ["get_control_space_ids_from_workflow", "handle"]
