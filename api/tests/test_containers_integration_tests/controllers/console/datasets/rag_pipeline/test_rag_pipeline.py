"""Integration coverage for customized pipeline template persistence."""

from collections.abc import Callable
from inspect import unwrap
from typing import cast
from uuid import uuid4

from flask import Flask
from sqlalchemy.orm import Session

from controllers.common.schema import JsonResponseWithStatus
from controllers.console.datasets.rag_pipeline.rag_pipeline import CustomizedPipelineTemplateApi
from models.dataset import PipelineCustomizedTemplate


def test_export_customized_pipeline_template_from_database(
    container_app: Flask,
    container_session: Session,
) -> None:
    api = CustomizedPipelineTemplateApi()
    method = unwrap(cast(Callable[..., JsonResponseWithStatus], api.post))
    template = PipelineCustomizedTemplate(
        tenant_id=str(uuid4()),
        name="Test Template",
        description="Test",
        chunk_structure="hierarchical",
        icon={"icon": "📘"},
        position=0,
        yaml_content="yaml-data",
        install_count=0,
        language="en-US",
        created_by=str(uuid4()),
    )
    container_session.add(template)
    container_session.commit()
    container_session.expire_all()

    with container_app.test_request_context("/"):
        response, status = method(api, template.id)

    assert status == 200
    assert response == {"data": "yaml-data"}
