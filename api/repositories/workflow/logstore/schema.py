"""Workflow log names and field indexes, kept with their persistence models."""

import sqlalchemy as sa
from aliyun.log import IndexConfig, IndexKeyConfig, IndexLineConfig  # type: ignore[import-untyped]
from sqlalchemy.orm import DeclarativeBase

from extensions.logstore.aliyun_logstore import AliyunLogStore
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun

WORKFLOW_EXECUTION_LOGSTORE = "workflow_execution"
WORKFLOW_NODE_EXECUTION_LOGSTORE = "workflow_node_execution"


def _index_type(column_type: sa.types.TypeEngine) -> str:
    if isinstance(column_type, (sa.Integer, sa.Boolean)):
        return "long"
    if isinstance(column_type, (sa.Float, sa.Numeric)):
        return "double"
    if isinstance(column_type, sa.JSON):
        return "json"
    # Strings, timestamps (serialized as ISO strings), and custom types use text.
    return "text"


def _text_index() -> IndexKeyConfig:
    return IndexKeyConfig(
        index_type="text",
        case_sensitive=False,
        doc_value=True,
        token_list=AliyunLogStore.DEFAULT_TOKEN_LIST,
        chinese=True,
    )


def _model_index_keys(model: type[DeclarativeBase]) -> dict[str, IndexKeyConfig]:
    """Pick up mapped column changes at startup, including append-only log versions."""
    keys = {}
    for name, column in model.__mapper__.columns.items():
        index_type = _index_type(column.type)
        keys[name] = _text_index() if index_type == "text" else IndexKeyConfig(index_type=index_type, doc_value=True)
    keys["log_version"] = IndexKeyConfig(index_type="long", doc_value=True)
    return keys


def workflow_logstore_indexes() -> dict[str, IndexConfig]:
    run_keys = _model_index_keys(WorkflowRun)
    # The writer uses these names for the relational error and created_at fields.
    run_keys["error_message"] = _text_index()
    run_keys["started_at"] = _text_index()
    return {
        name: IndexConfig(
            line_config=IndexLineConfig(
                token_list=AliyunLogStore.DEFAULT_TOKEN_LIST, case_sensitive=False, chinese=True
            ),
            key_config_list=keys,
            scan_index=True,
        )
        for name, keys in (
            (WORKFLOW_EXECUTION_LOGSTORE, run_keys),
            (WORKFLOW_NODE_EXECUTION_LOGSTORE, _model_index_keys(WorkflowNodeExecutionModel)),
        )
    }
