import pytest
from sqlalchemy.orm import DeclarativeBase

from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
from repositories.workflow.logstore.schema import (
    WORKFLOW_EXECUTION_LOGSTORE,
    WORKFLOW_NODE_EXECUTION_LOGSTORE,
    workflow_logstore_indexes,
)


@pytest.mark.parametrize(
    ("name", "model"),
    [(WORKFLOW_EXECUTION_LOGSTORE, WorkflowRun), (WORKFLOW_NODE_EXECUTION_LOGSTORE, WorkflowNodeExecutionModel)],
)
def test_indexes_cover_owner_fields_and_append_only_versions(name: str, model: type[DeclarativeBase]) -> None:
    config = workflow_logstore_indexes()[name]
    keys = config.key_config_list

    assert set(model.__mapper__.columns.keys()) <= keys.keys()
    assert keys["tenant_id"].index_type == "text"
    assert keys["app_id"].index_type == "text"
    assert keys["log_version"].index_type == "long"
    assert keys["elapsed_time"].index_type == "double"
    assert keys["created_at"].index_type == "text"
    assert all(key.doc_value for key in keys.values())
    assert config.line_config is not None
    assert config.scan_index is True


def test_run_indexes_include_writer_field_names() -> None:
    keys = workflow_logstore_indexes()[WORKFLOW_EXECUTION_LOGSTORE].key_config_list

    assert keys["error_message"].index_type == "text"
    assert keys["started_at"].index_type == "text"
    assert keys["total_tokens"].index_type == "long"
