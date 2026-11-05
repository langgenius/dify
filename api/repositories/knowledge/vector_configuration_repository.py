"""Resolve vector backend inputs in the caller's transaction, without external I/O."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.rag.datasource.vdb.vector_type import VectorType
from models.dataset import Dataset, Whitelist
from models.vector import VectorConfiguration
from repositories.knowledge.collection_binding_repository import DatasetCollectionBindingRepository


def resolve_vector_type(dataset: Dataset, *, session: Session) -> str:
    vector_type = dify_config.VECTOR_STORE
    if dataset.index_struct_dict:
        vector_type = dataset.index_struct_dict["type"]
    elif dify_config.VECTOR_STORE_WHITELIST_ENABLE:
        whitelist = session.scalar(
            select(Whitelist).where(Whitelist.tenant_id == dataset.tenant_id, Whitelist.category == "vector_db")
        )
        if whitelist:
            vector_type = VectorType.TIDB_ON_QDRANT
    if not vector_type:
        raise ValueError("Vector store must be specified.")
    return vector_type


def resolve_vector_configuration(dataset: Dataset, *, session: Session) -> VectorConfiguration:
    vector_type = resolve_vector_type(dataset, session=session)
    collection_name = None
    if vector_type == VectorType.QDRANT and dataset.collection_binding_id:
        binding = DatasetCollectionBindingRepository.get_dataset_collection_binding_by_id_and_type(
            dataset.collection_binding_id, session, collection_type=None
        )
        collection_name = binding.collection_name
    return VectorConfiguration(vector_type, collection_name)
