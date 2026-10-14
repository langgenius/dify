"""Restore Console detail files through real database and HTTP boundaries."""

from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from typing import override
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from pydantic import JsonValue
from sqlalchemy import Connection, event
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from core.helper.http_client_pooling import close_all_pooled_clients
from core.tools.signature import verify_tool_file_signature
from core.workflow.file_reference import build_file_reference, resolve_file_record_id
from extensions.storage.storage_type import StorageType
from fields.conversation_fields import ConversationMessageDetail
from fields.conversation_fields import MessageFile as MessageFileResponse
from graphon.file import FILE_MODEL_IDENTITY, File, FileTransferMethod, FileType
from machinery.context import RequestContext
from models import MessageFile, ToolFile, UploadFile
from models.enums import ConversationFromSource, CreatorUserRole, MessageFileBelongsTo
from models.model import AppMode, Conversation, Message
from models.utils.file_input_compat import restore_input_files
from repositories.conversation_repository import ConversationRepository
from services.conversation_query_service import ConversationQueryService
from services.entities.conversation_entities import ConsoleCompletionConversationDetail
from services.message_query_adapters import MessageFileResolver
from tests.unit_tests.model_factories import make_account, make_app, make_conversation, make_message


@pytest.fixture(autouse=True)
def file_configuration(config_overrides: Callable[..., None]) -> Iterator[None]:
    config_overrides(
        FILES_URL="https://files.example.test",
        SECRET_KEY="conversation-detail-file-test",
        SSRF_PROXY_HTTP_URL="",
        SSRF_PROXY_HTTPS_URL="",
        SSRF_PROXY_ALL_URL="",
    )
    close_all_pooled_clients()
    yield
    close_all_pooled_clients()


@dataclass(frozen=True)
class DetailData:
    context: RequestContext
    app_id: str
    conversation_id: str
    message_id: str
    upload_id: str
    tool_id: str
    legacy_file_id: str
    inputs: dict[str, JsonValue]


def _file_input(record_id: str, method: str) -> dict[str, JsonValue]:
    return {
        "dify_model_identity": FILE_MODEL_IDENTITY,
        "transfer_method": method,
        "reference": build_file_reference(record_id=record_id),
        "type": "document",
        "filename": "stale.json",
        "mime_type": "application/json",
        "size": 999,
    }


@pytest.fixture
def detail_data(sqlite_session_factory: sessionmaker[Session]) -> DetailData:
    tenant_id, account_id, app_id = str(uuid4()), str(uuid4()), str(uuid4())
    conversation_id, message_id = str(uuid4()), str(uuid4())
    with sqlite_session_factory.begin() as session:
        upload = UploadFile(
            tenant_id=tenant_id,
            storage_type=StorageType.LOCAL,
            key="uploads/canonical.txt",
            name="canonical.txt",
            size=17,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account_id,
            created_at=datetime(2026, 10, 13),
            used=True,
        )
        tool = ToolFile(
            user_id=account_id,
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            file_key="tools/result.pdf",
            mimetype="application/pdf",
            name="result.pdf",
            size=23,
        )
        session.add_all([upload, tool])
        session.flush()
        mapping = _file_input(upload.id, "local_file")
        inputs: dict[str, JsonValue] = {
            "upload": mapping,
            "tools": [_file_input(tool.id, "tool_file")],
            "mixed": [mapping, "leave unchanged"],
            "empty": [],
            "zero": 0,
            "false": False,
            "none": None,
        }
        session.add_all(
            [
                make_account(account_id=account_id),
                make_app(app_id=app_id, tenant_id=tenant_id, mode=AppMode.COMPLETION),
                make_conversation(
                    conversation_id=conversation_id,
                    app_id=app_id,
                    mode=AppMode.COMPLETION,
                    inputs={},
                    from_source=ConversationFromSource.CONSOLE,
                    from_account_id=account_id,
                ),
                make_message(
                    message_id=message_id,
                    app_id=app_id,
                    conversation_id=conversation_id,
                    inputs=inputs,
                    query="Files",
                    message={"text": "Prompt"},
                    answer="Answer",
                    message_unit_price=Decimal(0),
                    answer_unit_price=Decimal(0),
                    currency="USD",
                    from_source=ConversationFromSource.CONSOLE,
                    from_account_id=account_id,
                ),
            ]
        )
        legacy = MessageFile(
            message_id=message_id,
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.TOOL_FILE,
            url=f"https://old.example/files/tools/{tool.id}.pdf",
            upload_file_id=None,
            belongs_to=MessageFileBelongsTo.ASSISTANT,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account_id,
        )
        session.add_all(
            [
                legacy,
                MessageFile(
                    message_id=message_id,
                    type=FileType.DOCUMENT,
                    transfer_method=FileTransferMethod.LOCAL_FILE,
                    upload_file_id=upload.id,
                    belongs_to=MessageFileBelongsTo.USER,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=account_id,
                ),
            ]
        )
        session.flush()
        return DetailData(
            context=RequestContext(
                request_id="detail-test", trace_id=None, account_id=account_id, active_workspace_id=tenant_id
            ),
            app_id=app_id,
            conversation_id=conversation_id,
            message_id=message_id,
            upload_id=upload.id,
            tool_id=tool.id,
            legacy_file_id=legacy.id,
            inputs=inputs,
        )


def _detail(factory: sessionmaker[Session], data: DetailData) -> ConsoleCompletionConversationDetail:
    result = ConversationQueryService(
        conversations=ConversationRepository(session_factory=factory),
        restore_inputs=restore_input_files,
        files=MessageFileResolver(),
    ).get_console_detail(data.context, data.app_id, data.conversation_id, kind="completion")
    assert isinstance(result, ConsoleCompletionConversationDetail)
    return result


@dataclass
class DatabaseReads:
    sessions: list[Session] = field(default_factory=list)
    active_counts: list[int] = field(default_factory=list)
    commits: list[Session] = field(default_factory=list)


@contextmanager
def _observe_reads(factory: sessionmaker[Session]) -> Generator[DatabaseReads]:
    observed = DatabaseReads()

    def begin(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        observed.sessions.append(session)
        observed.active_counts.append(sum(item.in_transaction() for item in observed.sessions))

    def committed(session: Session) -> None:
        observed.commits.append(session)

    event.listen(factory, "after_begin", begin)
    event.listen(factory, "after_commit", committed)
    try:
        yield observed
    finally:
        event.remove(factory, "after_begin", begin)
        event.remove(factory, "after_commit", committed)


def test_detail_restores_files_without_overlapping_sessions_or_persisting_legacy_fallback(
    sqlite_session_factory: sessionmaker[Session], detail_data: DetailData
) -> None:
    with _observe_reads(sqlite_session_factory) as reads:
        detail = _detail(sqlite_session_factory, detail_data)
        response = ConversationMessageDetail.model_validate(detail)
    assert len(reads.sessions) > 1
    assert set(reads.active_counts) == {1}
    assert reads.commits == []
    assert all(not session.in_transaction() and not session.identity_map for session in reads.sessions)
    message = detail.first_message
    assert message is not None
    upload = message.inputs["upload"]
    assert isinstance(upload, File)
    assert (upload.filename, upload.mime_type, upload.size) == ("canonical.txt", "text/plain", 17)
    assert resolve_file_record_id(upload.reference) == detail_data.upload_id
    tools = message.inputs["tools"]
    assert isinstance(tools, list)
    assert isinstance(tools[0], File)
    assert tools[0].filename == "result.pdf"
    assert message.inputs["mixed"] == detail_data.inputs["mixed"]
    assert message.inputs["empty"] == []
    assert message.inputs["zero"] == 0
    assert message.inputs["false"] is False
    assert message.inputs["none"] is None
    attachments = {attachment.filename: attachment for attachment in message.message_files}
    assert attachments["canonical.txt"].belongs_to == "user"
    assert attachments["canonical.txt"].size == 17
    assert attachments["result.pdf"].belongs_to == "assistant"
    assert attachments["result.pdf"].upload_file_id == detail_data.tool_id
    assert response.message is not None
    assert response.message.inputs["upload"]["filename"] == "canonical.txt"
    with sqlite_session_factory() as session:
        assert session.get_one(MessageFile, detail_data.legacy_file_id).upload_file_id is None
        assert session.get_one(Message, detail_data.message_id)._inputs == detail_data.inputs
        assert session.get_one(Conversation, detail_data.conversation_id).read_at is None


def test_remote_head_occurs_after_conversation_and_file_lookup_transactions_close(
    sqlite_session_factory: sessionmaker[Session], detail_data: DetailData
) -> None:
    requests: list[tuple[str, str, bool]] = []
    with _observe_reads(sqlite_session_factory) as reads:

        class Handler(BaseHTTPRequestHandler):
            @override
            def log_message(self, format: str, *args: object) -> None:
                pass

            def do_HEAD(self) -> None:
                requests.append((self.command, self.path, any(session.in_transaction() for session in reads.sessions)))
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", "29")
                self.send_header("Content-Disposition", "attachment; filename*=UTF-8''server%20report.txt")
                self.end_headers()

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sqlite_session_factory.begin() as session:
                session.add(
                    MessageFile(
                        message_id=detail_data.message_id,
                        type=FileType.DOCUMENT,
                        transfer_method=FileTransferMethod.REMOTE_URL,
                        url=f"http://127.0.0.1:{server.server_port}/download.bin",
                        belongs_to=MessageFileBelongsTo.USER,
                        created_by_role=CreatorUserRole.ACCOUNT,
                        created_by=detail_data.context.account_id,
                    )
                )
            reads.sessions.clear()
            reads.active_counts.clear()
            reads.commits.clear()
            detail = _detail(sqlite_session_factory, detail_data)
            assert requests == [("HEAD", "/download.bin", False)]
            assert reads.sessions
            assert set(reads.active_counts) == {1}
            assert reads.commits == []
            assert all(not session.in_transaction() and not session.identity_map for session in reads.sessions)
            assert detail.first_message is not None
            remote = next(file for file in detail.first_message.message_files if file.filename == "server report.txt")
            assert (remote.mime_type, remote.size, remote.belongs_to) == ("text/plain", 29, "user")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


def test_detail_attachment_fields_match_the_legacy_model_projection(
    sqlite_session_factory: sessionmaker[Session], detail_data: DetailData
) -> None:
    detail = _detail(sqlite_session_factory, detail_data)
    assert detail.first_message is not None
    actual = {
        file.id: MessageFileResponse.model_validate(file).model_dump(exclude={"url"})
        for file in detail.first_message.message_files
    }
    with sqlite_session_factory() as session:
        message = session.get_one(Message, detail_data.message_id)
        expected = {
            file["id"]: MessageFileResponse.model_validate(file).model_dump(exclude={"url"})
            for file in message.message_files_with_session(session=session)
        }
    assert actual == expected


@pytest.mark.parametrize("shape", ["{}", "`{}`", "[download]({})"])
@pytest.mark.parametrize("kind", ["tool", "file-preview", "image-preview"])
def test_detail_signs_answer_urls_without_rewriting_stored_answer(
    sqlite_session_factory: sessionmaker[Session], detail_data: DetailData, shape: str, kind: str
) -> None:
    file_id = detail_data.tool_id if kind == "tool" else detail_data.upload_id
    path = f"/files/tools/{file_id}.pdf" if kind == "tool" else f"/files/{file_id}/{kind}"
    original = shape.format(f"http://internal.example{path}?timestamp=1&nonce=old&sign=old&as_attachment=true")
    with sqlite_session_factory.begin() as session:
        session.get_one(Message, detail_data.message_id).answer = original
    detail = _detail(sqlite_session_factory, detail_data)
    assert detail.first_message is not None
    signed = detail.first_message.answer.removeprefix("[download](").removesuffix(")").strip("`")
    parsed = urlsplit(signed)
    query = parse_qs(parsed.query)
    assert parsed.netloc == "files.example.test"
    assert parsed.path == (f"/files/tools/{file_id}.pdf" if kind == "tool" else f"/files/{file_id}/file-preview")
    assert query["as_attachment"] == ["true"]
    assert query["nonce"] != ["old"]
    assert query["timestamp"] != ["1"]
    assert verify_tool_file_signature(file_id, query["timestamp"][0], query["nonce"][0], query["sign"][0])
    with sqlite_session_factory() as session:
        assert session.get_one(Message, detail_data.message_id).answer == original
