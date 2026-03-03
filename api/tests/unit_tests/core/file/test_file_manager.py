from unittest.mock import Mock

from dify_graph.file import File, FileTransferMethod, FileType
from dify_graph.file.file_manager import file_manager


def test_download_falls_back_to_signed_url_when_storage_key_missing(monkeypatch):
    file = File(
        tenant_id="tenant-1",
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="11111111-1111-1111-1111-111111111111",
        filename="input.txt",
        extension=".txt",
        mime_type="text/plain",
        size=10,
    )

    response = Mock()
    response.content = b"file-bytes"
    response.raise_for_status = Mock()

    runtime = Mock()
    runtime.http_get = Mock(return_value=response)
    runtime.storage_load = Mock(side_effect=AssertionError("storage_load should not be called for missing storage_key"))

    monkeypatch.setattr("dify_graph.file.file_manager.get_workflow_file_runtime", lambda: runtime)
    monkeypatch.setattr(File, "generate_url", lambda self, for_external=True: "http://internal/files/preview")

    content = file_manager.download(file)

    assert content == b"file-bytes"
    runtime.http_get.assert_called_once_with("http://internal/files/preview", follow_redirects=True)
