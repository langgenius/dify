import pytest
from pydantic import ValidationError

from services.rag_pipeline.entity.pipeline_service_api_entities import (
    DatasourceNodeRunApiEntity,
    PipelineRunApiEntity,
)


def test_datasource_node_run_api_entity_valid_payload() -> None:
    entity = DatasourceNodeRunApiEntity(
        pipeline_id="pipeline-1",
        node_id="node-1",
        inputs={"q": "hello"},
        datasource_type="local_file",
        credential_id="cred-1",
        is_published=True,
    )

    assert entity.pipeline_id == "pipeline-1"
    assert entity.credential_id == "cred-1"


def test_pipeline_run_api_entity_requires_start_node_id() -> None:
    with pytest.raises(ValidationError):
        PipelineRunApiEntity.model_validate(
            {
                "inputs": {"q": "hello"},
                "datasource_type": "local_file",
                "datasource_info_list": [{"id": "ds-1"}],
                "is_published": True,
                "response_mode": "streaming",
            }
        )
