import pytest

from models import model as model_module
from models.model import Message


@pytest.fixture
def patch_file_signers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        model_module.file_helpers,
        "get_signed_file_url",
        lambda file_id: f"https://files.example/{file_id}",
    )
    monkeypatch.setattr(
        model_module,
        "sign_tool_file",
        lambda tool_file_id, extension: (
            f"https://files.example/tools/{tool_file_id}{extension}?timestamp=999&nonce=new&sign=new"
        ),
    )


def test_bare_file_preview_url_is_re_signed(patch_file_signers: None) -> None:
    upload_id = "bare-1"
    url = f"http://api:5001/files/{upload_id}/file-preview?timestamp=111&nonce=222&sign=333"
    message = Message(answer=f"Download:\n{url}")

    result = message.re_sign_file_url_answer

    assert result == f"Download:\nhttps://files.example/{upload_id}"
    assert "http://api:5001" not in result


def test_backticked_tool_file_url_is_re_signed(patch_file_signers: None) -> None:
    tool_file_id = "5c465079-d1ee-c17e-f8fd-000000000001"
    url = f"http://api:5001/files/tools/{tool_file_id}.py?timestamp=111&nonce=222&sign=333"
    message = Message(answer=f"Download:\n`{url}`")

    result = message.re_sign_file_url_answer

    assert result == (
        "Download:\n`https://files.example/tools/"
        f"{tool_file_id}.py?timestamp=999&nonce=new&sign=new`"
    )


def test_multiple_bare_file_urls_are_re_signed_independently(patch_file_signers: None) -> None:
    first = "/files/multi-a/file-preview?timestamp=1&nonce=2&sign=3"
    second = "/files/multi-b/file-preview?timestamp=4&nonce=5&sign=6"
    message = Message(answer=f"first {first} then {second}")

    result = message.re_sign_file_url_answer

    assert result == "first https://files.example/multi-a then https://files.example/multi-b"
