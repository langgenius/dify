from collections.abc import Sequence
from contextlib import nullcontext
from unittest.mock import patch

import pytest
from redis.exceptions import RedisError
from sqlalchemy.orm import Session, sessionmaker

import tasks.document_indexing_task as task_module
import tasks.recover_document_indexing_task as recovery_module
import tasks.retry_document_indexing_task as retry_module
import tasks.sync_website_document_indexing_task as website_module
from enums import DeploymentEdition
from models.dataset import Document
from models.enums import DataSourceType, IndexingStatus
from services.knowledge.entities.resource_scope import DocumentRef
from services.knowledge.indexing.locks import KnowledgeIndexingLeaseLostError, KnowledgeIndexingLockBusyError
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.model_factories import make_dataset, make_document


@pytest.mark.parametrize("kind", ["retry", "website"])
def test_redis_claim_failure_retries_before_starting_execution(
    sqlite_session_factory: sessionmaker[Session], kind: str
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(make_dataset(indexing_technique="economy"))
        session.add(make_document(data_source_type=DataSourceType.WEBSITE_CRAWL))

    def complete(*_args: object, **_kwargs: object) -> None:
        with sqlite_session_factory.begin() as session:
            document = session.get_one(Document, "document-1")
            assert document.indexing_status == IndexingStatus.WAITING
            document.indexing_status = IndexingStatus.COMPLETED

    if kind == "retry":
        with (
            patch.object(retry_module, "_claim_retry_leases") as claim,
            patch.object(retry_module, "_run_retry_document_indexing", side_effect=complete) as execute,
        ):
            claim.side_effect = [RedisError("unavailable"), nullcontext({"document-1": object()})]
            result = retry_module.retry_document_indexing_task.apply(
                args=("dataset-1", ["document-1"], "account-1"), throw=False
            )
    else:
        with (
            patch.object(website_module, "_hold_website_sync_lease") as claim,
            patch.object(website_module, "_hold_document_indexing_lease", return_value=nullcontext(object())),
            patch.object(website_module, "_run_website_document_sync", side_effect=complete) as execute,
        ):
            claim.side_effect = [RedisError("unavailable"), nullcontext(object())]
            result = website_module.sync_website_document_indexing_task.apply(
                args=("dataset-1", "document-1"), throw=False
            )

    assert result.state == "SUCCESS"
    assert claim.call_count == 2
    execute.assert_called_once()


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
@pytest.mark.parametrize("entrypoint", ["legacy", "normal", "priority"])
@pytest.mark.parametrize("failure", [KnowledgeIndexingLeaseLostError, KnowledgeIndexingLockBusyError, RedisError])
def test_batch_retries_only_unfinished_documents_at_their_persisted_phase(
    sqlite_session_factory: sessionmaker[Session], entrypoint: str, failure: type[Exception]
) -> None:
    document_ids = ["one", "two", "three", "already-completed"]
    with sqlite_session_factory.begin() as session:
        session.add(make_dataset(indexing_technique="economy"))
        for document_id in document_ids:
            document = make_document(document_id=document_id)
            document.indexing_status = (
                IndexingStatus.COMPLETED if document_id == "already-completed" else IndexingStatus.WAITING
            )
            session.add(document)

    def complete(ref: DocumentRef) -> None:
        with sqlite_session_factory.begin() as session:
            session.get_one(Document, ref.document_id).indexing_status = IndexingStatus.COMPLETED

    attempted: list[str] = []

    def index(refs: Sequence[DocumentRef]) -> None:
        for ref in refs:
            attempted.append(ref.document_id)
            if ref.document_id == "two":
                with sqlite_session_factory.begin() as session:
                    session.get_one(Document, ref.document_id).indexing_status = IndexingStatus.INDEXING
                raise failure("temporary indexing interruption")
            complete(ref)

    with (
        patch.object(task_module, "build_document_indexing_service", autospec=True) as builder,
        patch.object(task_module, "TenantIsolatedTaskQueue", autospec=True) as queue,
    ):
        builder.return_value.run.side_effect = index
        builder.return_value.run_in_indexing_status.side_effect = complete
        waiting_tasks: list[dict[str, object]] = []
        queue.return_value.pull_tasks.return_value = waiting_tasks
        if entrypoint == "legacy":
            result = task_module.document_indexing_task.apply(args=("dataset-1", document_ids), throw=False)
        else:
            task = (
                task_module.normal_document_indexing_task
                if entrypoint == "normal"
                else task_module.priority_document_indexing_task
            )
            result = task.apply(args=("tenant-1", "dataset-1", document_ids), throw=False)

    assert result.state == "SUCCESS"
    assert attempted == ["one", "two", "three"]
    resumed_ref = builder.return_value.run_in_indexing_status.call_args.args[0]
    assert resumed_ref.document_id == "two"
    builder.return_value.run_in_indexing_status.assert_called_once()
    if entrypoint == "legacy":
        queue.assert_not_called()
    else:
        queue.assert_called_once()
        queue.return_value.pull_tasks.assert_called_once()
    with sqlite_session_factory() as session:
        for document_id in document_ids:
            document = session.get_one(Document, document_id)
            assert document.indexing_status == IndexingStatus.COMPLETED
        assert session.get_one(Document, "already-completed").processing_started_at is None


def test_replay_after_completion_still_dispatches_requested_summaries(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = make_dataset(indexing_technique="high_quality")
        dataset.summary_index_setting = {"enable": True}
        document = make_document(doc_form="text_model")
        document.indexing_status = IndexingStatus.COMPLETED
        document.need_summary = True
        session.add_all([dataset, document])

    with (
        patch.object(task_module, "build_document_indexing_service", autospec=True) as builder,
        patch.object(task_module.generate_summary_index_task, "delay") as dispatch,
    ):
        task_module.document_indexing_task.run("dataset-1", ["document-1"])

    builder.assert_not_called()
    dispatch.assert_called_once_with("dataset-1", "document-1", None)


@pytest.mark.parametrize(
    ("status", "runner"),
    [
        (IndexingStatus.WAITING, "run"),
        (IndexingStatus.PARSING, "run"),
        (IndexingStatus.CLEANING, "run"),
        (IndexingStatus.SPLITTING, "run_in_splitting_status"),
        (IndexingStatus.INDEXING, "run_in_indexing_status"),
    ],
)
def test_recovery_retries_lease_loss_without_discarding_its_phase(
    sqlite_session_factory: sessionmaker[Session], status: IndexingStatus, runner: str
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(make_dataset(indexing_technique="economy"))
        document = make_document()
        document.indexing_status = status
        session.add(document)

    attempts = 0

    def recover(*_args: object) -> None:
        nonlocal attempts
        attempts += 1
        with sqlite_session_factory.begin() as session:
            document = session.get_one(Document, "document-1")
            assert document.indexing_status == status
            if attempts == 2:
                document.indexing_status = IndexingStatus.COMPLETED
        if attempts == 1:
            raise KnowledgeIndexingLeaseLostError("temporary lease loss")

    with patch.object(recovery_module, "build_document_indexing_service", autospec=True) as builder:
        getattr(builder.return_value, runner).side_effect = recover
        result = recovery_module.recover_document_indexing_task.apply(args=("dataset-1", "document-1"), throw=False)

    assert result.state == "SUCCESS"
    assert attempts == 2
    with sqlite_session_factory() as session:
        assert session.get_one(Document, "document-1").indexing_status == IndexingStatus.COMPLETED
