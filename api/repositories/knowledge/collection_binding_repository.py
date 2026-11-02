"""Shared collection binding persistence within the caller's transaction."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.dataset import Dataset, DatasetCollectionBinding


class DatasetCollectionBindingRepository:
    @classmethod
    def get_dataset_collection_binding(
        cls, provider_name: str, model_name: str, session: Session, collection_type: str = "dataset"
    ) -> DatasetCollectionBinding:
        dataset_collection_binding = session.scalar(
            select(DatasetCollectionBinding)
            .where(
                DatasetCollectionBinding.provider_name == provider_name,
                DatasetCollectionBinding.model_name == model_name,
                DatasetCollectionBinding.type == collection_type,
            )
            .order_by(DatasetCollectionBinding.created_at)
            .limit(1)
        )

        if not dataset_collection_binding:
            dataset_collection_binding = DatasetCollectionBinding(
                provider_name=provider_name,
                model_name=model_name,
                collection_name=Dataset.gen_collection_name_by_id(str(uuid.uuid4())),
                type=collection_type,
            )
            session.add(dataset_collection_binding)
            session.flush()
        return dataset_collection_binding

    @classmethod
    def get_dataset_collection_binding_by_id_and_type(
        cls, collection_binding_id: str, session: Session, collection_type: str | None = "dataset"
    ) -> DatasetCollectionBinding:
        # A vector backend resolves either a dataset or annotation binding by ID.
        # Callers performing type-specific operations retain the type predicate.
        statement = select(DatasetCollectionBinding).where(DatasetCollectionBinding.id == collection_binding_id)
        if collection_type is not None:
            statement = statement.where(DatasetCollectionBinding.type == collection_type)
        dataset_collection_binding = session.scalar(statement.order_by(DatasetCollectionBinding.created_at).limit(1))
        if not dataset_collection_binding:
            raise ValueError("Dataset collection binding not found")

        return dataset_collection_binding
