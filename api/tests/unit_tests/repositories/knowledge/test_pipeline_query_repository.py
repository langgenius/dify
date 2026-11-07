from sqlalchemy.orm import Session

from models.account import Account
from models.dataset import Dataset, Pipeline, PipelineCustomizedTemplate
from models.enums import DataSourceType
from repositories.knowledge.pipeline_query_repository import (
    get_pipeline_dataset,
    get_pipeline_template_creator_name,
    pipeline_dataset_query,
)

_TENANT_ID = "00000000-0000-0000-0000-000000000001"
_OTHER_TENANT_ID = "00000000-0000-0000-0000-000000000002"
_ACCOUNT_ID = "00000000-0000-0000-0000-000000000011"
_PIPELINE_ID = "00000000-0000-0000-0000-000000000021"


def _pipeline(*, tenant_id: str = _TENANT_ID, pipeline_id: str = _PIPELINE_ID) -> Pipeline:
    pipeline = Pipeline(tenant_id=tenant_id, name="pipeline", description="")
    pipeline.id = pipeline_id
    return pipeline


def _dataset(*, dataset_id: str, tenant_id: str, pipeline_id: str) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name=f"dataset-{dataset_id}",
        provider="vendor",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=_ACCOUNT_ID,
        built_in_field_enabled=False,
        pipeline_id=pipeline_id,
    )


def _template(*, created_by: str) -> PipelineCustomizedTemplate:
    return PipelineCustomizedTemplate(
        tenant_id=_TENANT_ID,
        name="template",
        description="description",
        chunk_structure="text_model",
        icon={"type": "emoji", "value": "book"},
        position=1,
        yaml_content="version: 1",
        install_count=0,
        language="en-US",
        created_by=created_by,
    )


def test_pipeline_dataset_query_requires_both_pipeline_and_tenant(sqlite_session: Session) -> None:
    pipeline = _pipeline()
    matching = _dataset(
        dataset_id="00000000-0000-0000-0000-000000000031",
        tenant_id=_TENANT_ID,
        pipeline_id=pipeline.id,
    )
    other_pipeline = _dataset(
        dataset_id="00000000-0000-0000-0000-000000000032",
        tenant_id=_TENANT_ID,
        pipeline_id="00000000-0000-0000-0000-000000000022",
    )
    other_tenant = _dataset(
        dataset_id="00000000-0000-0000-0000-000000000033",
        tenant_id=_OTHER_TENANT_ID,
        pipeline_id=pipeline.id,
    )
    sqlite_session.add_all([pipeline, matching, other_pipeline, other_tenant])
    sqlite_session.flush()

    assert get_pipeline_dataset(pipeline, sqlite_session) is matching
    assert sqlite_session.scalars(pipeline_dataset_query(_TENANT_ID, pipeline.id)).all() == [matching]

    foreign_view = _pipeline(tenant_id=_OTHER_TENANT_ID)
    assert get_pipeline_dataset(foreign_view, sqlite_session) is other_tenant
    unknown = _pipeline(pipeline_id="00000000-0000-0000-0000-000000000099")
    assert get_pipeline_dataset(unknown, sqlite_session) is None


def test_pipeline_template_creator_name_uses_persisted_account(sqlite_session: Session) -> None:
    account = Account(name="Pipeline Owner", email="owner@example.com")
    account.id = _ACCOUNT_ID
    template = _template(created_by=account.id)
    missing_creator = _template(created_by="00000000-0000-0000-0000-000000000012")
    sqlite_session.add_all([account, template, missing_creator])
    sqlite_session.flush()

    assert get_pipeline_template_creator_name(template, sqlite_session) == "Pipeline Owner"
    assert get_pipeline_template_creator_name(missing_creator, sqlite_session) == ""
