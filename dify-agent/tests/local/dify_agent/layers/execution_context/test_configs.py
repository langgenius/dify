import pytest
from pydantic import ValidationError

import dify_agent.layers.execution_context as execution_context_exports
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


def test_execution_context_package_exports_client_safe_config_symbols_only() -> None:
    assert execution_context_exports.__all__ == [
        "DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID",
        "DifyExecutionContextInvokeFrom",
        "DifyExecutionContextLayerConfig",
    ]
    assert execution_context_exports.DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID == "dify.execution_context"
    assert not hasattr(execution_context_exports, "DifyExecutionContextLayer")


def test_execution_context_layer_config_forbids_runtime_settings_and_unknown_fields() -> None:
    config = DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        user_id="user-1",
        workflow_id="workflow-1",
        invoke_from="workflow_run",
    )

    assert config.tenant_id == "tenant-1"
    assert config.user_id == "user-1"
    assert config.workflow_id == "workflow-1"
    assert config.invoke_from == "workflow_run"

    with pytest.raises(ValidationError):
        _ = DifyExecutionContextLayerConfig.model_validate(
            {
                "tenant_id": "tenant-1",
                "invoke_from": "workflow_run",
                "daemon_url": "http://daemon",
            }
        )

    with pytest.raises(ValidationError):
        _ = DifyExecutionContextLayerConfig.model_validate(
            {
                "tenant_id": "tenant-1",
                "invoke_from": "workflow_run",
                "unknown": "value",
            }
        )
