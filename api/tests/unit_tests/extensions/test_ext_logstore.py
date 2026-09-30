from unittest.mock import patch

import pytest

from dify_app import DifyApp
from extensions import ext_logstore
from repositories.workflow.logstore.schema import WORKFLOW_EXECUTION_LOGSTORE, WORKFLOW_NODE_EXECUTION_LOGSTORE
from tests.unit_tests.config_override import apply_config_overrides


@pytest.mark.parametrize(("backend", "enabled"), [("rdbms", False), ("logstore", True)])
def test_extension_uses_configured_storage_and_connection_settings(
    monkeypatch: pytest.MonkeyPatch, backend: str, enabled: bool
) -> None:
    apply_config_overrides(
        monkeypatch,
        WORKFLOW_RUN_STORAGE_BACKEND=backend,
        WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND="rdbms",
        ALIYUN_SLS_ACCESS_KEY_ID="test-id",
        ALIYUN_SLS_ACCESS_KEY_SECRET="test-secret",
        ALIYUN_SLS_ENDPOINT="test-endpoint",
        ALIYUN_SLS_REGION="test-region",
        ALIYUN_SLS_PROJECT_NAME="test-project",
    )
    assert ext_logstore.is_enabled() is enabled

    apply_config_overrides(monkeypatch, ALIYUN_SLS_ENDPOINT="")
    assert ext_logstore.is_enabled() is False


def test_startup_wires_workflow_schema_into_logstore_client() -> None:
    app = DifyApp(__name__)
    with patch("extensions.ext_logstore.AliyunLogStore", autospec=True) as client:
        ext_logstore.init_app(app)

        client.return_value.init_project_logstore.assert_called_once()
        (indexes,) = client.return_value.init_project_logstore.call_args.args
        assert set(indexes) == {WORKFLOW_EXECUTION_LOGSTORE, WORKFLOW_NODE_EXECUTION_LOGSTORE}
        assert indexes[WORKFLOW_EXECUTION_LOGSTORE].key_config_list["log_version"].index_type == "long"
        assert app.extensions["logstore"] is client.return_value
