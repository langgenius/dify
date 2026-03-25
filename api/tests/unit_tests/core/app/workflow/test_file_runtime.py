from unittest.mock import patch

from core.app.workflow.file_runtime import DifyWorkflowFileRuntime, bind_dify_workflow_file_runtime


class TestDifyWorkflowFileRuntime:
    def test_runtime_properties_and_helpers(self, monkeypatch):
        monkeypatch.setattr("core.app.workflow.file_runtime.dify_config.FILES_URL", "http://files")
        monkeypatch.setattr("core.app.workflow.file_runtime.dify_config.INTERNAL_FILES_URL", "http://internal")
        monkeypatch.setattr("core.app.workflow.file_runtime.dify_config.SECRET_KEY", "secret")
        monkeypatch.setattr("core.app.workflow.file_runtime.dify_config.FILES_ACCESS_TIMEOUT", 123)
        monkeypatch.setattr("core.app.workflow.file_runtime.dify_config.MULTIMODAL_SEND_FORMAT", "url")

        runtime = DifyWorkflowFileRuntime()

        assert runtime.files_url == "http://files"
        assert runtime.internal_files_url == "http://internal"
        assert runtime.secret_key == "secret"
        assert runtime.files_access_timeout == 123
        assert runtime.multimodal_send_format == "url"

        with patch("core.app.workflow.file_runtime.ssrf_proxy.get") as mock_get:
            mock_get.return_value = "response"
            assert runtime.http_get("http://example", follow_redirects=False) == "response"
            mock_get.assert_called_once_with("http://example", follow_redirects=False)

        with patch("core.app.workflow.file_runtime.storage.load") as mock_load:
            mock_load.return_value = b"data"
            assert runtime.storage_load("path", stream=True) == b"data"
            mock_load.assert_called_once_with("path", stream=True)

        with patch("core.app.workflow.file_runtime.sign_tool_file") as mock_sign:
            mock_sign.return_value = "signed"
            assert runtime.sign_tool_file(tool_file_id="id", extension=".txt", for_external=False) == "signed"
            mock_sign.assert_called_once_with(tool_file_id="id", extension=".txt", for_external=False)

    def test_bind_runtime_registers_instance(self):
        with patch("core.app.workflow.file_runtime.set_workflow_file_runtime") as mock_set:
            bind_dify_workflow_file_runtime()

        mock_set.assert_called_once()
        runtime = mock_set.call_args[0][0]
        assert isinstance(runtime, DifyWorkflowFileRuntime)
