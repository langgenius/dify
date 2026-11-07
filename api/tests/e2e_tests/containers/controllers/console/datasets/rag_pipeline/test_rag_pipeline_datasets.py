"""Integration coverage for persisted empty RAG pipeline dataset responses."""

from collections.abc import Mapping
from dataclasses import dataclass
from inspect import unwrap
from unittest.mock import patch
from uuid import uuid4

from flask import Flask
from sqlalchemy.orm import Session

from controllers.console.datasets.rag_pipeline.rag_pipeline_datasets import CreateEmptyRagPipelineDatasetApi
from machinery.context import RequestContext
from models.account import Account, TenantAccountRole
from models.dataset import Dataset, DatasetPermissionEnum, DatasetRuntimeMode, Pipeline
from services.knowledge.dataset_read_service import load_dataset_detail
from services.knowledge.entities.datasets import DatasetDetailRecord


@dataclass(frozen=True)
class _DatasetCommands:
    result: DatasetDetailRecord

    def create_rag_pipeline_dataset(
        self,
        context: RequestContext,
        *,
        values: Mapping[str, object],
    ) -> DatasetDetailRecord:
        del context, values
        return self.result


@dataclass(frozen=True)
class _KnowledgeServices:
    datasets: _DatasetCommands


@dataclass(frozen=True)
class _ApplicationServices:
    knowledge: _KnowledgeServices


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

    detail = load_dataset_detail(dataset, session=db_session_with_containers)
    app_services = _ApplicationServices(knowledge=_KnowledgeServices(datasets=_DatasetCommands(detail)))
    current_user = Account(name="Dataset Editor", email="dataset-editor@example.com")
    current_user.id = account_id
    current_user.role = TenantAccountRole.EDITOR
    with (
        flask_app_with_containers.test_request_context("/"),
        patch(
            "controllers.console.datasets.rag_pipeline.rag_pipeline_datasets.application_services",
            return_value=app_services,
        ),
    ):
        response, status = unwrap(CreateEmptyRagPipelineDatasetApi().post)(
            CreateEmptyRagPipelineDatasetApi(), tenant_id, current_user
        )

    assert status == 201
    assert response["id"] == dataset.id
    assert response["pipeline_id"] == pipeline.id
    assert response["runtime_mode"] == "rag_pipeline"
