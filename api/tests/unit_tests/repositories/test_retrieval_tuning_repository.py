import json
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from core.rag.index_processor.constant.index_type import IndexStructureType
from models.enums import FeedbackFromSource, FeedbackRating
from models.model import App, AppMode, MessageFeedback
from models.workflow import WorkflowType
from repositories.retrieval_tuning_repository import RetrievalTuningRepository
from services.retrieval_tuning.feedback_volume import AppFeedbackCounts
from services.retrieval_tuning.node_eligibility import DatasetFacts, PublishedAppGraph
from tests.helpers.unit.model_factories import make_dataset, make_document, make_message, make_workflow

_SINCE = datetime(2026, 8, 1)
_UNTIL = datetime(2026, 10, 1)
_IN_WINDOW = datetime(2026, 9, 1)
_TENANT_ID = "22222222-2222-4222-8222-222222222222"
_OTHER_TENANT_ID = "33333333-3333-4333-8333-333333333333"


def _add_app(
    session: Session, *, app_id: str, tenant_id: str = _TENANT_ID, mode: AppMode = AppMode.ADVANCED_CHAT
) -> str:
    app = App(tenant_id=tenant_id, name="App", mode=mode, enable_site=True, enable_api=True)
    app.id = app_id
    session.add(app)
    return app_id


def _add_message(
    session: Session,
    *,
    app_id: str,
    created_at: datetime = _IN_WINDOW,
    invoke_from: InvokeFrom | None = InvokeFrom.WEB_APP,
    workflow_run_id: str | None = None,
) -> str:
    message_id = str(uuid4())
    session.add(
        make_message(
            message_id=message_id,
            app_id=app_id,
            conversation_id=str(uuid4()),
            inputs={},
            query="private query",
            message=[],
            answer="private answer",
            message_unit_price=0,
            answer_unit_price=0,
            currency="USD",
            from_source="api",
            invoke_from=invoke_from,
            workflow_run_id=workflow_run_id,
            created_at=created_at,
        )
    )
    return message_id


def _rate(
    session: Session,
    *,
    app_id: str,
    message_id: str,
    rating: FeedbackRating,
    source: FeedbackFromSource = FeedbackFromSource.USER,
) -> None:
    session.add(
        MessageFeedback(
            app_id=app_id,
            conversation_id=str(uuid4()),
            message_id=message_id,
            rating=rating,
            from_source=source,
        )
    )


def _page(factory: sessionmaker[Session], *, tenant_id: str | None = None, after: str | None = None, limit: int = 10):
    return RetrievalTuningRepository(session_factory=factory).get_feedback_counts_page(
        since=_SINCE, until=_UNTIL, tenant_id=tenant_id, after_app_id=after, limit=limit
    )


def test_counts_separate_user_and_admin_ratings_and_track_run_links(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        _add_app(session, app_id=app_id)
        linked = _add_message(session, app_id=app_id, workflow_run_id=str(uuid4()))
        unlinked = _add_message(session, app_id=app_id)
        admin_rated = _add_message(session, app_id=app_id, workflow_run_id=str(uuid4()))
        _add_message(session, app_id=app_id)
        _rate(session, app_id=app_id, message_id=linked, rating=FeedbackRating.LIKE)
        _rate(session, app_id=app_id, message_id=unlinked, rating=FeedbackRating.DISLIKE)
        _rate(
            session,
            app_id=app_id,
            message_id=admin_rated,
            rating=FeedbackRating.DISLIKE,
            source=FeedbackFromSource.ADMIN,
        )

    page = _page(sqlite_session_factory)

    assert page.records == [
        AppFeedbackCounts(
            tenant_id=_TENANT_ID,
            app_id=app_id,
            messages=4,
            user_likes=1,
            user_dislikes=1,
            user_rated_with_workflow_run=1,
            admin_likes=0,
            admin_dislikes=1,
        )
    ]


def test_debugger_and_out_of_window_messages_and_their_feedback_do_not_count(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        _add_app(session, app_id=app_id)
        counted = _add_message(session, app_id=app_id)
        legacy = _add_message(session, app_id=app_id, invoke_from=None)
        for excluded in (
            _add_message(session, app_id=app_id, invoke_from=InvokeFrom.DEBUGGER),
            _add_message(session, app_id=app_id, created_at=_SINCE - timedelta(seconds=1)),
            _add_message(session, app_id=app_id, created_at=_UNTIL),
        ):
            _rate(session, app_id=app_id, message_id=excluded, rating=FeedbackRating.DISLIKE)
        _rate(session, app_id=app_id, message_id=counted, rating=FeedbackRating.LIKE)
        _add_message(session, app_id=app_id, created_at=_SINCE)
        _rate(session, app_id=app_id, message_id=legacy, rating=FeedbackRating.LIKE)

    record = _page(sqlite_session_factory).records[0]

    assert (record.messages, record.user_likes, record.user_dislikes) == (3, 2, 0)


def test_feedback_from_another_app_on_the_same_message_id_does_not_count(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        _add_app(session, app_id=app_id)
        message_id = _add_message(session, app_id=app_id)
        _rate(session, app_id=str(uuid4()), message_id=message_id, rating=FeedbackRating.LIKE)

    assert _page(sqlite_session_factory).records[0].user_likes == 0


def test_only_chatflow_apps_in_the_requested_tenant_are_scanned(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    chatflow = str(uuid4())
    other_tenant = str(uuid4())
    other_mode = str(uuid4())
    with sqlite_session_factory.begin() as session:
        for app_id, tenant_id, mode in (
            (chatflow, _TENANT_ID, AppMode.ADVANCED_CHAT),
            (other_tenant, _OTHER_TENANT_ID, AppMode.ADVANCED_CHAT),
            (other_mode, _TENANT_ID, AppMode.CHAT),
        ):
            _add_app(session, app_id=app_id, tenant_id=tenant_id, mode=mode)
            _add_message(session, app_id=app_id)

    assert [record.app_id for record in _page(sqlite_session_factory, tenant_id=_TENANT_ID).records] == [chatflow]
    assert {record.app_id for record in _page(sqlite_session_factory).records} == {chatflow, other_tenant}


def test_pages_walk_apps_by_id_and_skip_apps_without_messages(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app_ids = sorted(str(uuid4()) for _ in range(3))
    with sqlite_session_factory.begin() as session:
        for app_id in app_ids:
            _add_app(session, app_id=app_id)
        _add_message(session, app_id=app_ids[1])

    first = _page(sqlite_session_factory, limit=1)
    second = _page(sqlite_session_factory, after=first.next_after_app_id, limit=2)

    assert first.records == []
    assert first.next_after_app_id == app_ids[0]
    assert [record.app_id for record in second.records] == [app_ids[1]]
    assert second.next_after_app_id == app_ids[2]
    assert _page(sqlite_session_factory, after=second.next_after_app_id, limit=2).next_after_app_id is None


_GRAPH = json.dumps({"nodes": []})


def _add_published_app(
    session: Session,
    *,
    app_id: str,
    tenant_id: str = _TENANT_ID,
    mode: AppMode = AppMode.ADVANCED_CHAT,
    workflow_tenant_id: str | None = None,
    workflow_app_id: str | None = None,
) -> str:
    workflow = make_workflow(
        workflow_id=str(uuid4()),
        tenant_id=workflow_tenant_id or tenant_id,
        app_id=workflow_app_id or app_id,
        workflow_type=WorkflowType.CHAT,
        version="1",
        graph=_GRAPH,
        created_by=str(uuid4()),
    )
    session.add(workflow)
    app = App(tenant_id=tenant_id, name="App", mode=mode, enable_site=True, enable_api=True, workflow_id=workflow.id)
    app.id = app_id
    session.add(app)
    return workflow.id


def _add_dataset(
    session: Session,
    *,
    dataset_id: str | None = None,
    tenant_id: str = _TENANT_ID,
    provider: str = "vendor",
    retrieval_model: object = None,
    index_struct: str | None = None,
) -> str:
    resolved_id = dataset_id or str(uuid4())
    dataset = make_dataset(
        dataset_id=resolved_id,
        tenant_id=tenant_id,
        provider=provider,
        indexing_technique="high_quality",
        index_struct=index_struct,
        created_by=str(uuid4()),
        embedding_model="model",
        embedding_model_provider="provider",
    )
    dataset.retrieval_model = retrieval_model
    session.add(dataset)
    return resolved_id


def _add_document(
    session: Session,
    *,
    dataset_id: str,
    tenant_id: str = _TENANT_ID,
    doc_form: IndexStructureType = IndexStructureType.PARAGRAPH_INDEX,
    indexing_status: str = "completed",
    enabled: bool = True,
    archived: bool = False,
) -> None:
    document = make_document(
        document_id=str(uuid4()), tenant_id=tenant_id, dataset_id=dataset_id, created_by=str(uuid4()), doc_form=doc_form
    )
    document.indexing_status = indexing_status
    document.enabled = enabled
    document.archived = archived
    session.add(document)


def _repository(factory: sessionmaker[Session]) -> RetrievalTuningRepository:
    return RetrievalTuningRepository(session_factory=factory)


def test_published_graphs_cover_only_chatflows_with_their_own_published_workflow(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    published = str(uuid4())
    with sqlite_session_factory.begin() as session:
        workflow_id = _add_published_app(session, app_id=published)
        _add_published_app(session, app_id=str(uuid4()), mode=AppMode.WORKFLOW)
        _add_published_app(session, app_id=str(uuid4()), tenant_id=_OTHER_TENANT_ID)
        _add_published_app(session, app_id=str(uuid4()), workflow_tenant_id=_OTHER_TENANT_ID)
        _add_published_app(session, app_id=str(uuid4()), workflow_app_id=str(uuid4()))
        _add_app(session, app_id=str(uuid4()))

    page = _repository(sqlite_session_factory).get_published_graphs_page(
        tenant_id=_TENANT_ID, after_app_id=None, limit=10
    )

    assert page.records == [
        PublishedAppGraph(tenant_id=_TENANT_ID, app_id=published, workflow_id=workflow_id, graph=_GRAPH)
    ]
    assert page.next_after_app_id is None


def test_published_graph_pages_walk_apps_by_id(sqlite_session_factory: sessionmaker[Session]) -> None:
    app_ids = sorted(str(uuid4()) for _ in range(2))
    with sqlite_session_factory.begin() as session:
        for app_id in app_ids:
            _add_published_app(session, app_id=app_id)
    repository = _repository(sqlite_session_factory)

    first = repository.get_published_graphs_page(tenant_id=None, after_app_id=None, limit=1)
    second = repository.get_published_graphs_page(tenant_id=None, after_app_id=first.next_after_app_id, limit=1)
    last = repository.get_published_graphs_page(tenant_id=None, after_app_id=second.next_after_app_id, limit=1)

    assert [first.records[0].app_id, second.records[0].app_id] == app_ids
    assert (last.records, last.next_after_app_id) == ([], None)


def test_dataset_facts_read_retrieval_settings_and_index_details(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset_id = _add_dataset(
            session,
            retrieval_model={"search_method": "hybrid_search", "reranking_mode": "weighted_score", "weights": {"a": 1}},
            index_struct=json.dumps({"type": "qdrant"}),
        )
        _add_document(session, dataset_id=dataset_id)
        _add_document(session, dataset_id=dataset_id, doc_form=IndexStructureType.PARENT_CHILD_INDEX)

    facts = _repository(sqlite_session_factory).get_available_dataset_facts(
        tenant_id=_TENANT_ID, dataset_ids=[dataset_id]
    )

    assert facts == [
        DatasetFacts(
            dataset_id=dataset_id,
            provider="vendor",
            indexing_technique="high_quality",
            embedding_provider="provider",
            embedding_model="model",
            search_method="hybrid_search",
            reranking_mode="weighted_score",
            has_weights=True,
            vector_store="qdrant",
            has_parent_child_documents=True,
        )
    ]


def test_dataset_facts_treat_unreadable_settings_as_absent(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        dataset_id = _add_dataset(session, retrieval_model=["not", "a", "mapping"], index_struct="not json")
        _add_document(session, dataset_id=dataset_id)

    fact = _repository(sqlite_session_factory).get_available_dataset_facts(
        tenant_id=_TENANT_ID, dataset_ids=[dataset_id]
    )[0]

    assert (fact.search_method, fact.reranking_mode, fact.has_weights, fact.vector_store) == (None, None, False, None)


def test_dataset_facts_apply_the_runtime_availability_rule_and_tenant_scope(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        available = _add_dataset(session)
        _add_document(session, dataset_id=available)
        external = _add_dataset(session, provider="external")
        empty = _add_dataset(session)
        indexing = _add_dataset(session)
        _add_document(session, dataset_id=indexing, indexing_status="indexing")
        disabled = _add_dataset(session)
        _add_document(session, dataset_id=disabled, enabled=False)
        archived = _add_dataset(session)
        _add_document(session, dataset_id=archived, archived=True)
        foreign = _add_dataset(session, tenant_id=_OTHER_TENANT_ID)
        _add_document(session, dataset_id=foreign, tenant_id=_OTHER_TENANT_ID)

    facts = _repository(sqlite_session_factory).get_available_dataset_facts(
        tenant_id=_TENANT_ID,
        dataset_ids=[available, external, empty, indexing, disabled, archived, foreign],
    )

    assert {fact.dataset_id for fact in facts} == {available, external}
