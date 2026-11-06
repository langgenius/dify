"""Reject configuration values outside the explicitly wired storage modes."""

import pytest
from pydantic import ValidationError

from configs.feature import WorkflowStorageConfig


@pytest.mark.parametrize("field", ["WORKFLOW_RUN_STORAGE_BACKEND", "WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND"])
@pytest.mark.parametrize("value", ["unittest.mock.MagicMock", "unknown"])
def test_storage_config_rejects_module_paths_and_unknown_modes(field: str, value: str) -> None:
    with pytest.raises(ValidationError):
        WorkflowStorageConfig.model_validate({field: value})
