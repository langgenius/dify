"""Integration coverage for persisted empty RAG pipeline dataset responses."""

from inspect import unwrap
from unittest.mock import MagicMock, patch
from uuid import uuid4

from flask import Flask
from sqlalchemy.orm import Session

from controllers.console.datasets.rag_pipeline.rag_pipeline_datasets import CreateEmptyRagPipelineDatasetApi
from models.dataset import Dataset, DatasetPermissionEnum, DatasetRuntimeMode, Pipeline


def test_create_empty_rag_pipeline_dataset_serializes_persisted_models(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
) -> None:
    tenant_id = str(uuid4())
    account_id = str(uuid4())
    pipeline = Pipeline(
        tenant_id=tenant_id,
        name="Pipeline dataset",
        description="",
        created_by=account_id,
    )
    db_session_with_containers.add(pipeline)
    db_session_with_containers.flush()
    dataset = Dataset(
        tenant_id=tenant_id,
        name="Pipeline dataset",
        description="",
        permission=DatasetPermissionEnum.ONLY_ME,
        provider="vendor",
        runtime_mode=DatasetRuntimeMode.RAG_PIPELINE,
        icon_info={"icon": "📙", "icon_background": "#FFF4ED", "icon_type": "emoji"},
        created_by=account_id,
        pipeline_id=pipeline.id,
    )
    db_session_with_containers.add(dataset)
    db_session_with_containers.commit()
    db_session_with_containers.expire_all()

    with (
        flask_app_with_containers.test_request_context("/"),
        patch(
            "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.DatasetService.create_empty_rag_pipeline_dataset",
            return_value=dataset,
        ),
    ):
        response, status = unwrap(CreateEmptyRagPipelineDatasetApi().post)(
            CreateEmptyRagPipelineDatasetApi(), tenant_id, MagicMock(is_dataset_editor=True)
        )

    assert status == 201
    assert response["id"] == dataset.id
    assert response["pipeline_id"] == pipeline.id
    assert response["runtime_mode"] == "rag_pipeline"
