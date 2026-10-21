"""Delete document indexes between bounded database transactions."""

import contextlib
from collections.abc import Callable, Mapping, Sequence

from sqlalchemy.orm import Session

from configs import dify_config
from core.rag.datasource.keyword.jieba.jieba import Jieba
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models.dataset import Dataset
from repositories.knowledge.index_cleanup_repository import get_current_dataset, snapshot_index_cleanup
from repositories.knowledge.keyword_table_repository import (
    delete_keyword_table,
    get_keyword_table_storage_type,
    keyword_file_key,
    persist_keyword_table_for_existing_dataset,
    read_keyword_table_state,
    tenant_dataset_exists,
)
from repositories.knowledge.segment_repository import filter_attachment_ids_without_active_references
from repositories.knowledge.upload_file_repository import filter_inline_image_ids_without_active_references
from services.knowledge.indexing.cleanup import DeletionIndexCleanup
from services.knowledge.resource_scope import DatasetRef


def build_deletion_index_cleanup(
    session: Session,
    *,
    dataset: Dataset,
    delete_all: bool,
    segment_ids: Sequence[str] = (),
    index_node_ids: Sequence[str] = (),
    child_node_ids: Sequence[str] = (),
    summary_node_ids: Sequence[str] = (),
    file_node_ids: Sequence[str] = (),
    inline_image_node_ids: Sequence[str] = (),
    attachment_node_ids: Sequence[str] = (),
    refresh_billing: bool = False,
) -> DeletionIndexCleanup:
    """Snapshot external index inputs before their SQL owners disappear."""

    unique_segment_ids = tuple(dict.fromkeys(segment_ids))
    body_node_ids = list(dict.fromkeys(index_node_ids))
    child_ids = list(dict.fromkeys(child_node_ids))
    summary_ids = list(dict.fromkeys(summary_node_ids))
    dataset_ref = DatasetRef(dataset.tenant_id, dataset.id)
    snapshot = snapshot_index_cleanup(
        session,
        tenant_id=dataset_ref.tenant_id,
        dataset_id=dataset_ref.dataset_id,
        segment_ids=unique_segment_ids if not delete_all else (),
    )
    body_node_ids.extend(snapshot.body_node_ids)
    child_ids.extend(snapshot.child_node_ids)
    summary_ids.extend(snapshot.summary_node_ids)

    high_quality = dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY
    vector_type: str | None = None
    if high_quality:
        try:
            vector_type = Vector.resolve_vector_type(dataset, session=session)
        except ValueError:
            # Persist the cleanup even when the current vector configuration is
            # invalid. The independent worker will keep the failure visible and
            # retry after configuration is repaired.
            vector_type = None

    unique_inline_image_node_ids = tuple(dict.fromkeys(inline_image_node_ids))
    unique_attachment_node_ids = tuple(dict.fromkeys(attachment_node_ids))
    return DeletionIndexCleanup(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        indexing_technique=str(dataset.indexing_technique) if dataset.indexing_technique is not None else None,
        index_struct=dataset.index_struct,
        collection_binding_id=dataset.collection_binding_id,
        embedding_model_provider=dataset.embedding_model_provider,
        embedding_model=dataset.embedding_model,
        vector_type=vector_type,
        delete_all=delete_all,
        vector_node_ids=tuple(
            dict.fromkeys(
                [
                    *body_node_ids,
                    *child_ids,
                    *summary_ids,
                    *file_node_ids,
                    *unique_inline_image_node_ids,
                    *unique_attachment_node_ids,
                ]
            )
        ),
        inline_image_node_ids=unique_inline_image_node_ids,
        attachment_node_ids=unique_attachment_node_ids,
        keyword_node_ids=tuple(dict.fromkeys(body_node_ids)),
        keyword_data_source_type=(
            get_keyword_table_storage_type(session, dataset.id)
            if dataset.indexing_technique == IndexTechniqueType.ECONOMY
            else None
        ),
        refresh_billing=refresh_billing,
    )


def filter_file_vector_ids_without_active_references(
    session: Session,
    dataset_ref: DatasetRef,
    *,
    inline_image_ids: Sequence[str],
    attachment_ids: Sequence[str],
    excluding_segment_ids: Sequence[str] = (),
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Keep file-vector ids only when neither reference type still needs them."""

    unique_inline_image_ids = tuple(dict.fromkeys(inline_image_ids))
    unique_attachment_ids = tuple(dict.fromkeys(attachment_ids))
    candidates = tuple(dict.fromkeys([*unique_inline_image_ids, *unique_attachment_ids]))
    if not candidates:
        return (), ()
    deletable_inline_image_ids = set(
        filter_inline_image_ids_without_active_references(
            session,
            dataset_ref,
            candidates,
            excluding_segment_ids=excluding_segment_ids,
        )
    )
    deletable_attachment_ids = set(
        filter_attachment_ids_without_active_references(
            session,
            dataset_ref,
            candidates,
            excluding_segment_ids=excluding_segment_ids,
        )
    )
    deletable_ids = deletable_inline_image_ids & deletable_attachment_ids
    return (
        tuple(file_id for file_id in unique_inline_image_ids if file_id in deletable_ids),
        tuple(file_id for file_id in unique_attachment_ids if file_id in deletable_ids),
    )


def _cleanup_dataset(cleanup: DeletionIndexCleanup) -> Dataset:
    return Dataset(
        id=cleanup.dataset_id,
        tenant_id=cleanup.tenant_id,
        name="deleted dataset",
        provider="vendor",
        created_by=cleanup.tenant_id,
        indexing_technique=cleanup.indexing_technique,
        index_struct=cleanup.index_struct,
        collection_binding_id=cleanup.collection_binding_id,
        embedding_model_provider=cleanup.embedding_model_provider,
        embedding_model=cleanup.embedding_model,
    )


def _uses_same_vector_target(session: Session, dataset: Dataset, cleanup: DeletionIndexCleanup) -> bool:
    """Return whether current file vectors share the cleanup target."""

    if (
        str(dataset.indexing_technique) != cleanup.indexing_technique
        or dataset.index_struct != cleanup.index_struct
        or dataset.collection_binding_id != cleanup.collection_binding_id
        or dataset.embedding_model_provider != cleanup.embedding_model_provider
        or dataset.embedding_model != cleanup.embedding_model
    ):
        return False
    if cleanup.vector_type is None:
        return True
    try:
        return Vector.resolve_vector_type(dataset, session=session) == cleanup.vector_type
    except ValueError:
        return False


def _delete_keyword_index(
    cleanup: DeletionIndexCleanup,
    *,
    new_session: Callable[[], Session],
    assert_owned: Callable[[], None],
) -> None:
    dataset_ref = DatasetRef(cleanup.tenant_id, cleanup.dataset_id)
    file_key = keyword_file_key(cleanup.tenant_id, cleanup.dataset_id)

    def delete_all() -> None:
        with new_session() as session, session.begin():
            source_type = delete_keyword_table(session, cleanup.dataset_id) or cleanup.keyword_data_source_type
        if source_type and source_type != "database":
            assert_owned()
            with contextlib.suppress(FileNotFoundError):
                storage.delete(file_key)

    if cleanup.delete_all:
        delete_all()
        return
    if not cleanup.keyword_node_ids:
        return

    with new_session() as session:
        owner_exists = tenant_dataset_exists(
            session,
            tenant_id=dataset_ref.tenant_id,
            dataset_id=dataset_ref.dataset_id,
        )
    if not owner_exists:
        delete_all()
        return

    dataset = _cleanup_dataset(cleanup)

    def read() -> tuple[str, str | None]:
        with new_session() as session:
            state = read_keyword_table_state(
                session,
                tenant_id=dataset_ref.tenant_id,
                dataset_id=dataset_ref.dataset_id,
                fallback_storage_type=cleanup.keyword_data_source_type or dify_config.KEYWORD_DATA_SOURCE_TYPE,
            )
            return state.storage_type, state.data

    def write(storage_type: str, data: str, keywords: Mapping[str, Sequence[str]]) -> None:
        with new_session() as session, session.begin():
            persist_keyword_table_for_existing_dataset(
                session,
                tenant_id=dataset_ref.tenant_id,
                dataset_id=dataset_ref.dataset_id,
                storage_type=storage_type,
                data=data,
                keywords=keywords,
            )

    assert_owned()
    Jieba(dataset).update_texts(
        [],
        read=read,
        write=write,
        lock=redis_client.lock(f"keyword_indexing_lock_{cleanup.dataset_id}", timeout=600),
        deleted_ids=cleanup.keyword_node_ids,
    )


def clean_deletion_index(
    cleanup: DeletionIndexCleanup,
    *,
    new_session: Callable[[], Session],
    assert_owned: Callable[[], None],
) -> None:
    """Delete an external index while the caller holds its dataset indexing lease.

    ``assert_owned`` must validate that renewable lease. Keeping acquisition at
    the use-case boundary lets document rebuilds reuse their existing lease,
    while the detached cleanup worker acquires the same canonical lock itself.
    """

    if cleanup.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
        vector_node_ids = cleanup.vector_node_ids
        reference_scoped_node_ids = tuple(dict.fromkeys([*cleanup.inline_image_node_ids, *cleanup.attachment_node_ids]))
        if not cleanup.delete_all and reference_scoped_node_ids:
            with new_session() as session:
                current_dataset = get_current_dataset(
                    session,
                    tenant_id=cleanup.tenant_id,
                    dataset_id=cleanup.dataset_id,
                )
                if current_dataset is not None and _uses_same_vector_target(session, current_dataset, cleanup):
                    deletable_node_ids, _ = filter_file_vector_ids_without_active_references(
                        session,
                        DatasetRef(cleanup.tenant_id, cleanup.dataset_id),
                        inline_image_ids=reference_scoped_node_ids,
                        attachment_ids=reference_scoped_node_ids,
                    )
                    deletable_node_id_set = set(deletable_node_ids)
                    reference_scoped_node_id_set = set(reference_scoped_node_ids)
                    vector_node_ids = tuple(
                        node_id
                        for node_id in vector_node_ids
                        if node_id not in reference_scoped_node_id_set or node_id in deletable_node_id_set
                    )
        if not cleanup.delete_all and not vector_node_ids:
            return
        vector_type = cleanup.vector_type
        if vector_type is None:
            with new_session() as session:
                vector_type = Vector.resolve_vector_type(_cleanup_dataset(cleanup), session=session)
        assert_owned()
        vector = Vector(_cleanup_dataset(cleanup), session=None, vector_type=vector_type)
        if cleanup.delete_all:
            vector.delete()
        else:
            vector.delete_by_ids(list(vector_node_ids))
        return

    if cleanup.indexing_technique == IndexTechniqueType.ECONOMY:
        _delete_keyword_index(cleanup, new_session=new_session, assert_owned=assert_owned)
