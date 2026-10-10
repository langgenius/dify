"""Exercise detached file restoration against real SQLAlchemy and HTTP transports."""

from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from typing import override
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from pydantic import JsonValue
from sqlalchemy import Connection, event, select
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope
from core.helper import http_client_pooling
from core.tools.signature import verify_tool_file_signature
from core.workflow.file_reference import build_file_reference, resolve_file_record_id
from extensions.storage.storage_type import StorageType
from graphon.file import FILE_MODEL_IDENTITY, File, FileTransferMethod, FileType
from models import AppModelConfig, MessageFile, ToolFile, UploadFile
from models.enums import CreatorUserRole, MessageFileBelongsTo
from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository
from services.entities.message_entities import MessageFileReference, MessageInputValue
from services.message_query_adapters import ExecutionExtraContentReader, MessageFileResolver
from tests.test_containers_integration_tests.helpers.execution_extra_content import create_human_input_message_fixture


@pytest.fixture(autouse=True)
def file_configuration(config_overrides: Callable[..., None]) -> None:
    config_overrides(
        FILES_URL="https://files.example.test",
        SECRET_KEY="message-file-test-key",
        SSRF_PROXY_HTTP_URL="",
        SSRF_PROXY_HTTPS_URL="",
        SSRF_PROXY_ALL_URL="",
    )


@dataclass(frozen=True)
class _StoredFiles:
    tenant_id: str
    user_id: str
    upload_id: str
    tool_id: str
    legacy: MessageFileReference


@pytest.fixture
def stored_files(sqlite_session_factory: sessionmaker[Session]) -> _StoredFiles:
    tenant_id, user_id = str(uuid4()), str(uuid4())
    with sqlite_session_factory.begin() as session:
        upload = UploadFile(
            tenant_id=tenant_id,
            storage_type=StorageType.LOCAL,
            key="uploads/canonical.txt",
            name="canonical.txt",
            size=17,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.END_USER,
            created_by=user_id,
            created_at=datetime(2026, 10, 9),
            used=True,
        )
        tool = ToolFile(
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=None,
            file_key="tools/result.pdf",
            mimetype="application/pdf",
            name="result.pdf",
            size=23,
        )
        session.add_all([upload, tool])
        session.flush()
        legacy = MessageFile(
            message_id=str(uuid4()),
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.TOOL_FILE,
            url=f"https://old.example/files/tools/{tool.id}.pdf",
            upload_file_id=None,
            belongs_to=MessageFileBelongsTo.ASSISTANT,
            created_by_role=CreatorUserRole.END_USER,
            created_by=user_id,
        )
        session.add(legacy)
        session.flush()
        return _StoredFiles(tenant_id, user_id, upload.id, tool.id, _reference(legacy))


def _reference(row: MessageFile) -> MessageFileReference:
    return MessageFileReference(
        id=row.id,
        type=row.type.value,
        transfer_method=row.transfer_method.value,
        url=row.url,
        upload_file_id=row.upload_file_id,
        belongs_to=row.belongs_to.value if row.belongs_to else None,
    )


def _upload_reference(upload_id: str) -> MessageFileReference:
    return MessageFileReference(
        id=str(uuid4()),
        type="document",
        transfer_method="local_file",
        url=None,
        upload_file_id=upload_id,
        belongs_to="user",
    )


def _input_mapping(record_id: str, transfer_method: str = "local_file") -> dict[str, JsonValue]:
    return {
        "dify_model_identity": FILE_MODEL_IDENTITY,
        "transfer_method": transfer_method,
        "reference": build_file_reference(record_id=record_id),
        "type": "document",
        "filename": "stale.json",
        "mime_type": "application/json",
        "size": 999,
    }


def test_remote_head_runs_after_query_and_file_sessions_close(
    sqlite_session_factory: sessionmaker[Session], stored_files: _StoredFiles, monkeypatch: pytest.MonkeyPatch
) -> None:
    sessions: list[Session] = []
    commits: list[Session] = []
    requests: list[tuple[str, str, bool]] = []

    def observe(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    def committed(session: Session) -> None:
        commits.append(session)

    class Handler(BaseHTTPRequestHandler):
        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

        def do_HEAD(self) -> None:
            requests.append((self.command, self.path, any(session.in_transaction() for session in sessions)))
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", "29")
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''server%20report.txt")
            self.end_headers()

    http_pool = http_client_pooling.HttpClientPoolFactory()
    monkeypatch.setattr(http_client_pooling, "_factory", http_pool)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    event.listen(sqlite_session_factory, "after_begin", observe)
    event.listen(sqlite_session_factory, "after_commit", committed)
    try:
        with sqlite_session_factory() as session:
            row = session.scalar(select(MessageFile).where(MessageFile.id == stored_files.legacy.id))
            assert row is not None
            source = _reference(row)
        remote = replace(
            source,
            id=str(uuid4()),
            transfer_method="remote_url",
            url=f"http://127.0.0.1:{server.server_port}/download.bin",
            belongs_to="user",
        )
        result = MessageFileResolver().resolve(
            tenant_id=stored_files.tenant_id,
            inputs={"upload": _input_mapping(stored_files.upload_id)},
            answer="Answer",
            files=[source, remote],
        )
        assert requests == [("HEAD", "/download.bin", False)]
        assert not commits
        assert sessions
        assert all(not session.in_transaction() and not session.identity_map for session in sessions)
        assert result.files[1].filename == "server report.txt"
        assert result.files[1].mime_type == "text/plain"
        assert result.files[1].size == 29
    finally:
        event.remove(sqlite_session_factory, "after_begin", observe)
        event.remove(sqlite_session_factory, "after_commit", committed)
        server.shutdown()
        server.server_close()
        thread.join()
        http_pool.close_all()


def test_canonical_files_and_legacy_tool_fallback_do_not_write(
    sqlite_session_factory: sessionmaker[Session], stored_files: _StoredFiles
) -> None:
    inputs: dict[str, MessageInputValue] = {
        "upload": _input_mapping(stored_files.upload_id),
        "tools": [_input_mapping(stored_files.tool_id, "tool_file")],
        "empty": [],
        "mixed": [_input_mapping(stored_files.upload_id), "leave unchanged"],
        "zero": 0,
        "false": False,
        "none": None,
    }
    with sqlite_session_factory() as pending:
        config = AppModelConfig(app_id=str(uuid4()), opening_statement="Unrelated pending write")
        pending.add(config)
        result = MessageFileResolver().resolve(
            tenant_id=stored_files.tenant_id,
            inputs=inputs,
            answer="Answer",
            files=[_upload_reference(stored_files.upload_id), stored_files.legacy],
        )
        assert config in pending.new
    assert [file.belongs_to for file in result.files] == ["user", "assistant"]
    assert [file.filename for file in result.files] == ["canonical.txt", "result.pdf"]
    assert [file.size for file in result.files] == [17, 23]
    assert result.files[1].upload_file_id == stored_files.tool_id
    assert stored_files.legacy.upload_file_id is None
    upload = result.inputs["upload"]
    assert isinstance(upload, File)
    assert (upload.filename, upload.mime_type, upload.size) == ("canonical.txt", "text/plain", 17)
    assert resolve_file_record_id(upload.reference) == stored_files.upload_id
    tools = result.inputs["tools"]
    assert isinstance(tools, list)
    assert isinstance(tools[0], File)
    assert tools[0].filename == "result.pdf"
    assert result.inputs["empty"] == []
    assert result.inputs["mixed"] == inputs["mixed"]
    assert result.inputs["zero"] == 0
    assert result.inputs["false"] is False
    assert result.inputs["none"] is None
    assert isinstance(inputs["upload"], dict)
    assert inputs["upload"]["filename"] == "stale.json"
    with sqlite_session_factory() as session:
        row = session.get(MessageFile, stored_files.legacy.id)
        assert row is not None
        assert row.upload_file_id is None
        assert session.scalar(select(AppModelConfig.id).where(AppModelConfig.id == config.id)) is None


def test_input_external_urls_and_embedded_legacy_tenant_are_preserved(stored_files: _StoredFiles) -> None:
    mapping = _input_mapping(stored_files.upload_id)
    mapping["tenant_id"] = stored_files.tenant_id
    remote: dict[str, JsonValue] = {
        "dify_model_identity": FILE_MODEL_IDENTITY,
        "type": "document",
        "transfer_method": "remote_url",
        "url": "http://127.0.0.1:1/never-probed.txt",
        "filename": "stored.txt",
        "extension": ".txt",
        "mime_type": "text/plain",
        "size": 31,
    }
    result = MessageFileResolver().resolve(
        tenant_id=str(uuid4()), inputs={"local": mapping, "remote": remote}, answer="", files=[]
    )
    local = result.inputs["local"]
    assert isinstance(local, File)
    assert local.filename == "canonical.txt"
    external = result.inputs["remote"]
    assert isinstance(external, File)
    assert (external.remote_url, external.filename, external.size) == (remote["url"], "stored.txt", 31)


@pytest.mark.parametrize("kind", ["upload", "tool"])
def test_file_restoration_keeps_tenant_and_end_user_filters(stored_files: _StoredFiles, kind: str) -> None:
    source = _upload_reference(stored_files.upload_id) if kind == "upload" else stored_files.legacy
    resolver = MessageFileResolver()
    with pytest.raises(ValueError, match="Invalid upload file|ToolFile .* not found"):
        resolver.resolve(tenant_id=str(uuid4()), inputs={}, answer="", files=[source])
    denied_scope = FileAccessScope(
        tenant_id=stored_files.tenant_id,
        user_id=str(uuid4()),
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )
    with bind_file_access_scope(denied_scope):
        with pytest.raises(ValueError, match="Invalid upload file|ToolFile .* not found"):
            resolver.resolve(tenant_id=stored_files.tenant_id, inputs={}, answer="", files=[source])
    with bind_file_access_scope(replace(denied_scope, user_id=stored_files.user_id)):
        result = resolver.resolve(tenant_id=stored_files.tenant_id, inputs={}, answer="", files=[source])
        assert len(result.files) == 1


@pytest.mark.parametrize(
    ("transfer_method", "upload_file_id", "url", "error", "message"),
    [
        ("local_file", None, None, ValueError, "is a local file but has no upload_file_id"),
        ("local_file", "malformed", None, ValueError, "Invalid upload file id format"),
        ("local_file", "10000000-0000-4000-8000-000000000001", None, ValueError, "Invalid upload file"),
        ("remote_url", None, None, ValueError, "is a remote url but has no url"),
        ("tool_file", None, None, AssertionError, "^$"),
        ("tool_file", "missing", None, ValueError, "ToolFile missing not found"),
        ("datasource_file", None, None, ValueError, "has an invalid transfer_method datasource_file"),
    ],
)
def test_missing_and_invalid_file_references_keep_existing_errors(
    transfer_method: str, upload_file_id: str | None, url: str | None, error: type[Exception], message: str
) -> None:
    source = MessageFileReference(str(uuid4()), "document", transfer_method, url, upload_file_id, None)
    with pytest.raises(error, match=message):
        MessageFileResolver().resolve(tenant_id=str(uuid4()), inputs={}, answer="", files=[source])


@pytest.mark.parametrize("shape", ["{}", "`{}`", "[download]({})"])
@pytest.mark.parametrize("kind", ["tool", "file-preview", "image-preview"])
def test_answer_signing_preserves_legacy_url_shapes(shape: str, kind: str) -> None:
    file_id = str(uuid4())
    path = f"/files/tools/{file_id}.pdf" if kind == "tool" else f"/files/{file_id}/{kind}"
    original = f"http://internal.example{path}?timestamp=1&nonce=old&sign=old&as_attachment=true"
    result = MessageFileResolver().resolve(tenant_id=str(uuid4()), inputs={}, answer=shape.format(original), files=[])
    signed = result.answer.removeprefix("[download](").removesuffix(")").strip("`")
    parsed = urlsplit(signed)
    query = parse_qs(parsed.query)
    assert parsed.netloc == "files.example.test"
    assert query["as_attachment"] == ["true"]
    assert query["nonce"] != ["old"]
    assert query["timestamp"] != ["1"]
    assert verify_tool_file_signature(file_id, query["timestamp"][0], query["nonce"][0], query["sign"][0])
    assert parsed.path == (f"/files/tools/{file_id}.pdf" if kind == "tool" else f"/files/{file_id}/file-preview")


def test_extra_content_reader_serializes_real_database_content(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        fixture = create_human_input_message_fixture(session)
    reader = ExecutionExtraContentReader(
        repository=SQLAlchemyExecutionExtraContentRepository(session_maker=sqlite_session_factory)
    )
    result = reader.get_by_message_ids(["missing", fixture.message.id])
    assert result[0] == []
    assert result[1][0]["type"] == "human_input"
    assert result[1][0]["workflow_run_id"] == fixture.message.workflow_run_id
    assert result[1][0]["submitted"] is True
    definition = result[1][0]["form_definition"]
    assert isinstance(definition, dict)
    assert "form_token" not in definition
    submission = result[1][0]["form_submission_data"]
    assert isinstance(submission, dict)
    assert submission["submitted_data"] == {"name": "Alice"}
