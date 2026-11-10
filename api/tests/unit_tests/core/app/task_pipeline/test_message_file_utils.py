from types import SimpleNamespace
from typing import cast

from core.app.task_pipeline.message_file_utils import prepare_file_dict
from graphon.file import FileTransferMethod
from models.model import MessageFile, UploadFile


def _message_file(url: str, transfer_method: FileTransferMethod) -> MessageFile:
    return cast(
        MessageFile,
        SimpleNamespace(
            id="message-file-1",
            type="document",
            transfer_method=transfer_method,
            url=url,
            upload_file_id=None,
        ),
    )


def _remote_file(url: str) -> MessageFile:
    return _message_file(url, FileTransferMethod.REMOTE_URL)


def test_prepare_file_dict_decodes_percent_encoded_remote_filename() -> None:
    upload_files_map: dict[str, UploadFile] = {}
    info = prepare_file_dict(_remote_file("https://example.com/files/report%20final.csv?token=abc"), upload_files_map)

    assert info["filename"] == "report final.csv"
    assert info["extension"] == ".csv"


def test_prepare_file_dict_decodes_non_ascii_remote_filename() -> None:
    upload_files_map: dict[str, UploadFile] = {}
    info = prepare_file_dict(_remote_file("https://example.com/files/%E6%8A%A5%E5%91%8A.csv"), upload_files_map)

    assert info["filename"] == "报告.csv"
    assert info["extension"] == ".csv"


def test_prepare_file_dict_drops_fragment_from_remote_filename() -> None:
    upload_files_map: dict[str, UploadFile] = {}
    info = prepare_file_dict(_remote_file("https://example.com/files/report.csv#page=2"), upload_files_map)

    assert info["filename"] == "report.csv"
    assert info["extension"] == ".csv"


def test_prepare_file_dict_decodes_http_tool_file_filename() -> None:
    upload_files_map: dict[str, UploadFile] = {}
    info = prepare_file_dict(
        _message_file("https://example.com/files/plot%20final.png#zoom", FileTransferMethod.TOOL_FILE),
        upload_files_map,
    )

    assert info["filename"] == "plot final.png"
    assert info["extension"] == ".png"


def test_prepare_file_dict_keeps_plain_remote_filename() -> None:
    """Regression: an ordinary URL keeps its filename, extension and remote_url."""
    upload_files_map: dict[str, UploadFile] = {}
    info = prepare_file_dict(_remote_file("https://example.com/files/report.csv?token=abc"), upload_files_map)

    assert info["filename"] == "report.csv"
    assert info["extension"] == ".csv"
    assert info["remote_url"] == "https://example.com/files/report.csv?token=abc"
