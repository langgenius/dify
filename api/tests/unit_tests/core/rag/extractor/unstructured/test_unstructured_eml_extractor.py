"""Real MIME files must keep the text already decoded by Unstructured."""

from email.message import EmailMessage
from pathlib import Path

import pytest

from core.rag.extractor.unstructured.unstructured_eml_extractor import UnstructuredEmailExtractor


@pytest.fixture(autouse=True)
def disable_partition_telemetry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DO_NOT_TRACK", "1")


@pytest.mark.parametrize("cte", ["7bit", "base64", "quoted-printable"])
@pytest.mark.parametrize("body", ["YWJj", "MTIz", "This is an ordinary email message."])
def test_extract_preserves_plain_email_body(tmp_path: Path, cte: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = "sender@example.invalid"
    message["To"] = "reader@example.invalid"
    message.set_content(body, cte=cte)
    path = tmp_path / "message.eml"
    path.write_bytes(message.as_bytes())

    docs = UnstructuredEmailExtractor(str(path)).extract()

    assert [doc.page_content for doc in docs] == [body]


@pytest.mark.parametrize("cte", ["7bit", "base64", "quoted-printable"])
def test_extract_still_decodes_html_mime_body(tmp_path: Path, cte: str) -> None:
    message = EmailMessage()
    message.set_content("<html><body><p>Hello Email</p></body></html>", subtype="html", cte=cte)
    path = tmp_path / "html.eml"
    path.write_bytes(message.as_bytes())

    docs = UnstructuredEmailExtractor(str(path)).extract()

    assert [doc.page_content for doc in docs] == ["Hello Email"]


@pytest.mark.parametrize("cte", ["base64", "quoted-printable"])
def test_extract_still_decodes_utf8_mime_body(tmp_path: Path, cte: str) -> None:
    body = "你好，邮件正文。"
    message = EmailMessage()
    message.set_content(body, cte=cte)
    path = tmp_path / "utf8.eml"
    path.write_bytes(message.as_bytes())

    docs = UnstructuredEmailExtractor(str(path)).extract()

    assert [doc.page_content for doc in docs] == [body]
