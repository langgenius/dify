import pytest
from pydantic import ValidationError

from fields.service_api.rag_pipeline import DatasourceNodeRunPayload, PipelineRunPayload


def test_datasource_node_run_payload_accepts_documented_enum() -> None:
    entity = DatasourceNodeRunPayload(
        inputs={"q": "hello"},
        datasource_type="local_file",
        credential_id="cred-1",
        is_published=True,
    )

    assert entity.datasource_type == "local_file"
    assert entity.credential_id == "cred-1"


def test_pipeline_run_payload_requires_start_node_id() -> None:
    with pytest.raises(ValidationError):
        PipelineRunPayload.model_validate(
            {
                "inputs": {"q": "hello"},
                "datasource_type": "local_file",
                "datasource_info_list": [{"id": "ds-1"}],
                "is_published": True,
                "response_mode": "streaming",
            }
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("datasource_type", "private_datasource"),
        ("response_mode", "sync"),
    ],
)
def test_pipeline_run_payload_rejects_undocumented_enum_values(field: str, value: str) -> None:
    payload: dict[str, object] = {
        "inputs": {},
        "datasource_type": "local_file",
        "datasource_info_list": [],
        "start_node_id": "node-1",
        "is_published": False,
        "response_mode": "blocking",
    }
    payload[field] = value

    with pytest.raises(ValidationError):
        PipelineRunPayload.model_validate(payload)
