"""Read feedback volume for retrieval tuning reports in short, independent sessions."""

import json
from collections.abc import Collection, Sequence
from datetime import datetime
from typing import override

from sqlalchemy import ColumnElement, and_, case, distinct, func, or_, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document
from models.enums import FeedbackFromSource, FeedbackRating
from models.model import App, AppMode, Message, MessageFeedback
from models.workflow import Workflow
from services.retrieval_tuning.feedback_volume import AppFeedbackCounts, AppFeedbackCountsPage, FeedbackVolumeQuery
from services.retrieval_tuning.node_eligibility import (
    DatasetFacts,
    NodeEligibilityQuery,
    PublishedAppGraph,
    PublishedAppGraphPage,
)


def _stored_vector_store(index_struct: str | None) -> str | None:
    """Read the vector store name from a dataset's index structure; unreadable reads as absent."""
    try:
        parsed = json.loads(index_struct) if index_struct else None
    except ValueError:
        return None
    vector_store = parsed.get("type") if isinstance(parsed, dict) else None
    return vector_store if isinstance(vector_store, str) else None


class RetrievalTuningRepository(FeedbackVolumeQuery, NodeEligibilityQuery):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

    @override
    def get_feedback_counts_page(
        self,
        *,
        since: datetime,
        until: datetime,
        tenant_id: str | None,
        after_app_id: str | None,
        limit: int,
    ) -> AppFeedbackCountsPage:
        """Implement the port by scanning one app keyset page, then counting only those apps.

        Counts are bounded by app id so the message app and time index serves them,
        rather than aggregating the whole table across tenants.
        """
        with self._session_factory() as session:
            app_conditions: list[ColumnElement[bool]] = [App.mode == AppMode.ADVANCED_CHAT]
            if tenant_id is not None:
                app_conditions.append(App.tenant_id == tenant_id)
            if after_app_id is not None:
                app_conditions.append(App.id > after_app_id)
            app_rows = session.execute(
                select(App.id, App.tenant_id).where(*app_conditions).order_by(App.id).limit(limit)
            ).all()
            tenant_by_app_id = {str(app_id): str(owner_tenant_id) for app_id, owner_tenant_id in app_rows}
            app_ids = list(tenant_by_app_id)
            in_window = and_(
                Message.app_id.in_(app_ids),
                Message.created_at >= since,
                Message.created_at < until,
                # Rows predating invoke_from are deployed traffic, so only an explicit debugger run is excluded.
                or_(Message.invoke_from.is_(None), Message.invoke_from != InvokeFrom.DEBUGGER),
            )
            message_counts = {
                str(app_id): count
                for app_id, count in session.execute(
                    select(Message.app_id, func.count()).where(in_window).group_by(Message.app_id)
                ).all()
            }
            linked_message_id = case((Message.workflow_run_id.is_not(None), Message.id))
            feedback_rows = session.execute(
                select(
                    Message.app_id,
                    MessageFeedback.from_source,
                    MessageFeedback.rating,
                    func.count(distinct(Message.id)),
                    func.count(distinct(linked_message_id)),
                )
                .join(
                    MessageFeedback,
                    and_(MessageFeedback.message_id == Message.id, MessageFeedback.app_id == Message.app_id),
                )
                .where(in_window)
                .group_by(Message.app_id, MessageFeedback.from_source, MessageFeedback.rating)
            ).all()

        rated: dict[tuple[str, FeedbackFromSource, FeedbackRating], int] = {}
        rated_with_run: dict[tuple[str, FeedbackFromSource, FeedbackRating], int] = {}
        for app_id, source, rating, count, linked_count in feedback_rows:
            rated[(str(app_id), source, rating)] = count
            rated_with_run[(str(app_id), source, rating)] = linked_count

        return AppFeedbackCountsPage(
            records=[
                AppFeedbackCounts(
                    tenant_id=tenant_by_app_id[app_id],
                    app_id=app_id,
                    messages=message_counts[app_id],
                    user_likes=rated.get((app_id, FeedbackFromSource.USER, FeedbackRating.LIKE), 0),
                    user_dislikes=rated.get((app_id, FeedbackFromSource.USER, FeedbackRating.DISLIKE), 0),
                    user_rated_with_workflow_run=rated_with_run.get(
                        (app_id, FeedbackFromSource.USER, FeedbackRating.LIKE), 0
                    )
                    + rated_with_run.get((app_id, FeedbackFromSource.USER, FeedbackRating.DISLIKE), 0),
                    admin_likes=rated.get((app_id, FeedbackFromSource.ADMIN, FeedbackRating.LIKE), 0),
                    admin_dislikes=rated.get((app_id, FeedbackFromSource.ADMIN, FeedbackRating.DISLIKE), 0),
                )
                for app_id in app_ids
                if app_id in message_counts
            ],
            next_after_app_id=app_ids[-1] if len(app_ids) == limit else None,
        )

    @override
    def get_published_graphs_page(
        self, *, tenant_id: str | None, after_app_id: str | None, limit: int
    ) -> PublishedAppGraphPage:
        """Implement the port with one keyset page over apps joined to their published workflow."""
        conditions: list[ColumnElement[bool]] = [App.mode == AppMode.ADVANCED_CHAT]
        if tenant_id is not None:
            conditions.append(App.tenant_id == tenant_id)
        if after_app_id is not None:
            conditions.append(App.id > after_app_id)
        with self._session_factory() as session:
            rows = session.execute(
                select(App.tenant_id, App.id, Workflow.id, Workflow.graph)
                .join(
                    Workflow,
                    and_(
                        Workflow.id == App.workflow_id, Workflow.app_id == App.id, Workflow.tenant_id == App.tenant_id
                    ),
                )
                .where(*conditions)
                .order_by(App.id)
                .limit(limit)
            ).all()
        records: Sequence[PublishedAppGraph] = [
            PublishedAppGraph(tenant_id=str(owner), app_id=str(app_id), workflow_id=str(workflow_id), graph=graph)
            for owner, app_id, workflow_id, graph in rows
        ]
        return PublishedAppGraphPage(
            records=records,
            next_after_app_id=records[-1].app_id if len(records) == limit else None,
        )

    @override
    def get_available_dataset_facts(self, *, tenant_id: str, dataset_ids: Collection[str]) -> Sequence[DatasetFacts]:
        """Implement the port, applying the same availability rule retrieval applies at runtime."""
        with self._session_factory() as session:
            document_forms = session.execute(
                select(Document.dataset_id, Document.doc_form)
                .where(
                    Document.tenant_id == tenant_id,
                    Document.dataset_id.in_(dataset_ids),
                    Document.indexing_status == "completed",
                    Document.enabled.is_(True),
                    Document.archived.is_(False),
                )
                .distinct()
            ).all()
            with_documents = {str(dataset_id) for dataset_id, _ in document_forms}
            with_parent_child = {
                str(dataset_id)
                for dataset_id, doc_form in document_forms
                if doc_form == IndexStructureType.PARENT_CHILD_INDEX
            }
            datasets = session.execute(
                select(
                    Dataset.id,
                    Dataset.provider,
                    Dataset.indexing_technique,
                    Dataset.embedding_model_provider,
                    Dataset.embedding_model,
                    Dataset.retrieval_model,
                    Dataset.index_struct,
                ).where(Dataset.tenant_id == tenant_id, Dataset.id.in_(dataset_ids))
            ).all()

        facts: list[DatasetFacts] = []
        for (
            dataset_id,
            provider,
            technique,
            embedding_provider,
            embedding_model,
            retrieval_model,
            index_struct,
        ) in datasets:
            dataset_key = str(dataset_id)
            if provider == "external" or dataset_key in with_documents:
                settings = retrieval_model if isinstance(retrieval_model, dict) else {}
                facts.append(
                    DatasetFacts(
                        dataset_id=dataset_key,
                        provider=provider,
                        indexing_technique=technique,
                        embedding_provider=embedding_provider,
                        embedding_model=embedding_model,
                        search_method=settings.get("search_method"),
                        reranking_mode=settings.get("reranking_mode"),
                        has_weights=bool(settings.get("weights")),
                        vector_store=_stored_vector_store(index_struct),
                        has_parent_child_documents=dataset_key in with_parent_child,
                    )
                )
        return facts
