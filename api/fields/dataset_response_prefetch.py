"""Batch loading for session-backed dataset response fields."""

import json
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session, aliased

from core.rag.index_processor.constant.built_in_field import BuiltInField
from models.account import Account
from models.dataset import (
    AppDatasetJoin,
    Dataset,
    DatasetMetadata,
    Document,
    ExternalKnowledgeApis,
    ExternalKnowledgeBindings,
    Pipeline,
)
from models.model import App, Tag, TagBinding


def _load_app_counts(dataset_ids: Sequence[str], *, session: Session) -> dict[str, int]:
    counts = dict.fromkeys(dataset_ids, 0)
    rows = session.execute(
        select(AppDatasetJoin.dataset_id, func.count(AppDatasetJoin.id))
        .join(App, App.id == AppDatasetJoin.app_id)
        .where(AppDatasetJoin.dataset_id.in_(dataset_ids))
        .group_by(AppDatasetJoin.dataset_id)
    ).all()
    for dataset_id, count in rows:
        counts[str(dataset_id)] = int(count or 0)
    return counts


def _load_document_counts(dataset_ids: Sequence[str], *, session: Session) -> dict[str, int]:
    counts = dict.fromkeys(dataset_ids, 0)
    rows = session.execute(
        select(Document.dataset_id, func.count(Document.id))
        .where(Document.dataset_id.in_(dataset_ids))
        .group_by(Document.dataset_id)
    ).all()
    for dataset_id, count in rows:
        counts[str(dataset_id)] = int(count or 0)
    return counts


def _load_word_counts(dataset_ids: Sequence[str], *, session: Session) -> dict[str, int]:
    counts = dict.fromkeys(dataset_ids, 0)
    rows = session.execute(
        select(Document.dataset_id, func.coalesce(func.sum(Document.word_count), 0))
        .where(Document.dataset_id.in_(dataset_ids))
        .group_by(Document.dataset_id)
    ).all()
    for dataset_id, count in rows:
        counts[str(dataset_id)] = int(count or 0)
    return counts


def _load_available_document_counts(dataset_ids: Sequence[str], *, session: Session) -> dict[str, int]:
    counts = dict.fromkeys(dataset_ids, 0)
    rows = session.execute(
        select(Document.dataset_id, func.count(Document.id))
        .where(
            Document.dataset_id.in_(dataset_ids),
            Document.indexing_status == "completed",
            Document.enabled == True,
            Document.archived == False,
        )
        .group_by(Document.dataset_id)
    ).all()
    for dataset_id, count in rows:
        counts[str(dataset_id)] = int(count or 0)
    return counts


def _load_author_names(datasets: Sequence[Dataset], *, session: Session) -> dict[str, str | None]:
    author_names: dict[str, str | None] = {str(dataset.id): None for dataset in datasets}
    creator_ids = {str(dataset.created_by) for dataset in datasets if dataset.created_by}
    if not creator_ids:
        return author_names

    names_by_creator = {
        str(account_id): name
        for account_id, name in session.execute(
            select(Account.id, Account.name).where(Account.id.in_(creator_ids))
        ).all()
    }
    for dataset in datasets:
        author_names[str(dataset.id)] = names_by_creator.get(str(dataset.created_by))
    return author_names


def _load_tags(datasets: Sequence[Dataset], *, session: Session) -> dict[str, list[Tag]]:
    tags_by_dataset: dict[str, list[Tag]] = defaultdict(list)
    dataset_owner_keys = {(str(dataset.tenant_id), str(dataset.id)) for dataset in datasets}
    if not dataset_owner_keys:
        return {str(dataset.id): [] for dataset in datasets}

    rows = session.execute(
        select(TagBinding.target_id, Tag)
        .join(Tag, Tag.id == TagBinding.tag_id)
        .where(
            tuple_(TagBinding.tenant_id, TagBinding.target_id).in_(dataset_owner_keys),
            TagBinding.tenant_id == Tag.tenant_id,
            Tag.type == "knowledge",
        )
    ).all()
    for dataset_id, tag in rows:
        tags_by_dataset[str(dataset_id)].append(tag)
    return {str(dataset.id): tags_by_dataset[str(dataset.id)] for dataset in datasets}


def _load_doc_forms(datasets: Sequence[Dataset], *, session: Session) -> dict[str, str | None]:
    doc_forms = {str(dataset.id): dataset.chunk_structure for dataset in datasets if dataset.chunk_structure}
    dataset_owner_keys = {
        (str(dataset.tenant_id), str(dataset.id)) for dataset in datasets if not dataset.chunk_structure
    }
    if not dataset_owner_keys:
        return {str(dataset.id): doc_forms.get(str(dataset.id)) for dataset in datasets}

    document_alias = aliased(Document)
    doc_form_subquery = (
        select(document_alias.doc_form)
        .where(
            document_alias.dataset_id == Dataset.id,
            document_alias.tenant_id == Dataset.tenant_id,
        )
        .limit(1)
        .correlate(Dataset)
        .scalar_subquery()
    )
    rows = session.execute(
        select(Dataset.id, doc_form_subquery).where(tuple_(Dataset.tenant_id, Dataset.id).in_(dataset_owner_keys))
    ).all()
    for dataset_id, doc_form in rows:
        doc_forms.setdefault(str(dataset_id), doc_form)
    return {str(dataset.id): doc_forms.get(str(dataset.id)) for dataset in datasets}


def _load_external_knowledge_infos(
    datasets: Sequence[Dataset], *, session: Session
) -> dict[str, dict[str, Any] | None]:
    infos: dict[str, dict[str, Any] | None] = {str(dataset.id): None for dataset in datasets}
    external_datasets = [dataset for dataset in datasets if dataset.provider == "external"]
    dataset_owner_keys = {(str(dataset.tenant_id), str(dataset.id)) for dataset in external_datasets}
    if not dataset_owner_keys:
        return infos

    binding_alias = aliased(ExternalKnowledgeBindings)
    binding_id_subquery = (
        select(binding_alias.id)
        .where(
            binding_alias.tenant_id == Dataset.tenant_id,
            binding_alias.dataset_id == Dataset.id,
        )
        .limit(1)
        .correlate(Dataset)
        .scalar_subquery()
    )
    dataset_bindings = (
        select(Dataset.id.label("dataset_id"), binding_id_subquery.label("binding_id"))
        .where(tuple_(Dataset.tenant_id, Dataset.id).in_(dataset_owner_keys))
        .subquery()
    )
    binding_rows = session.execute(
        select(dataset_bindings.c.dataset_id, ExternalKnowledgeBindings).join(
            ExternalKnowledgeBindings, ExternalKnowledgeBindings.id == dataset_bindings.c.binding_id
        )
    ).all()
    bindings_by_dataset = {str(dataset_id): binding_row for dataset_id, binding_row in binding_rows}

    api_owner_keys = {
        (str(binding.tenant_id), str(binding.external_knowledge_api_id)) for binding in bindings_by_dataset.values()
    }
    apis_by_owner_key: dict[tuple[str, str], ExternalKnowledgeApis] = {}
    if api_owner_keys:
        apis = session.scalars(
            select(ExternalKnowledgeApis).where(
                tuple_(ExternalKnowledgeApis.tenant_id, ExternalKnowledgeApis.id).in_(api_owner_keys)
            )
        ).all()
        apis_by_owner_key = {(str(api.tenant_id), str(api.id)): api for api in apis}

    for dataset in external_datasets:
        binding = bindings_by_dataset.get(str(dataset.id))
        if binding is None:
            continue
        api = apis_by_owner_key.get((str(binding.tenant_id), str(binding.external_knowledge_api_id)))
        if api is None or api.settings is None:
            continue
        infos[str(dataset.id)] = {
            "external_knowledge_id": binding.external_knowledge_id,
            "external_knowledge_api_id": api.id,
            "external_knowledge_api_name": api.name,
            "external_knowledge_api_endpoint": json.loads(api.settings).get("endpoint", ""),
        }
    return infos


def _load_doc_metadatas(datasets: Sequence[Dataset], *, session: Session) -> dict[str, list[dict[str, str]]]:
    metadatas_by_dataset: dict[str, list[dict[str, str]]] = defaultdict(list)
    dataset_ids = [str(dataset.id) for dataset in datasets]
    rows = session.scalars(select(DatasetMetadata).where(DatasetMetadata.dataset_id.in_(dataset_ids))).all()
    for metadata in rows:
        metadatas_by_dataset[str(metadata.dataset_id)].append(
            {
                "id": metadata.id,
                "name": metadata.name,
                "type": metadata.type,
            }
        )

    for dataset in datasets:
        dataset_id = str(dataset.id)
        if dataset.built_in_field_enabled:
            metadatas_by_dataset[dataset_id].extend(
                [
                    {"id": "built-in", "name": BuiltInField.document_name, "type": "string"},
                    {"id": "built-in", "name": BuiltInField.uploader, "type": "string"},
                    {"id": "built-in", "name": BuiltInField.upload_date, "type": "time"},
                    {"id": "built-in", "name": BuiltInField.last_update_date, "type": "time"},
                    {"id": "built-in", "name": BuiltInField.source, "type": "string"},
                ]
            )
    return {str(dataset.id): metadatas_by_dataset[str(dataset.id)] for dataset in datasets}


def _load_published_statuses(datasets: Sequence[Dataset], *, session: Session) -> dict[str, bool]:
    statuses = {str(dataset.id): False for dataset in datasets}
    pipeline_ids = {str(dataset.pipeline_id) for dataset in datasets if dataset.pipeline_id}
    if not pipeline_ids:
        return statuses

    published_by_pipeline = {
        str(pipeline_id): bool(is_published)
        for pipeline_id, is_published in session.execute(
            select(Pipeline.id, Pipeline.is_published).where(Pipeline.id.in_(pipeline_ids))
        ).all()
    }
    for dataset in datasets:
        if dataset.pipeline_id:
            statuses[str(dataset.id)] = published_by_pipeline.get(str(dataset.pipeline_id), False)
    return statuses


@dataclass(frozen=True)
class DatasetResponsePrefetch:
    """Session-backed response fields loaded in batches for a dataset page."""

    app_counts: Mapping[str, int]
    document_counts: Mapping[str, int]
    word_counts: Mapping[str, int]
    author_names: Mapping[str, str | None]
    tags: Mapping[str, Sequence[Tag]]
    doc_forms: Mapping[str, str | None]
    external_knowledge_infos: Mapping[str, dict[str, Any] | None]
    doc_metadatas: Mapping[str, list[dict[str, str]]]
    published_statuses: Mapping[str, bool]
    available_document_counts: Mapping[str, int]

    @classmethod
    def load(cls, datasets: Sequence[Dataset], *, session: Session) -> "DatasetResponsePrefetch":
        if not datasets:
            return cls({}, {}, {}, {}, {}, {}, {}, {}, {}, {})

        dataset_ids = [str(dataset.id) for dataset in datasets]
        document_counts = _load_document_counts(dataset_ids, session=session)
        return cls(
            app_counts=_load_app_counts(dataset_ids, session=session),
            document_counts=document_counts,
            word_counts=_load_word_counts(dataset_ids, session=session),
            author_names=_load_author_names(datasets, session=session),
            tags=_load_tags(datasets, session=session),
            doc_forms=_load_doc_forms(datasets, session=session),
            external_knowledge_infos=_load_external_knowledge_infos(datasets, session=session),
            doc_metadatas=_load_doc_metadatas(datasets, session=session),
            published_statuses=_load_published_statuses(datasets, session=session),
            available_document_counts=_load_available_document_counts(dataset_ids, session=session),
        )
