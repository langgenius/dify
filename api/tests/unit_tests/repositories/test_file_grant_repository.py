from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.tools import ToolFile
from repositories.file_grant_repository import FileGrantRepository
from services.entities.file_grant_entities import FileGrantContext, FileKind, FileRef


def test_resolve_owned_files_uses_one_query_per_file_kind(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    end_user_id = "11111111-1111-4111-8111-111111111111"
    tenant_id = "22222222-2222-4222-8222-222222222222"
    with sqlite_session_factory.begin() as session:
        upload = UploadFile(
            tenant_id=tenant_id,
            storage_type=StorageType.OPENDAL,
            key="upload_files/report.pdf",
            name="report.pdf",
            size=10,
            extension="pdf",
            mime_type="application/pdf",
            created_by=end_user_id,
            created_by_role=CreatorUserRole.END_USER,
            created_at=naive_utc_now(),
            used=False,
        )
        tool_file = ToolFile(
            user_id=end_user_id,
            tenant_id=tenant_id,
            conversation_id=None,
            file_key="tools/chart.png",
            mimetype="image/png",
            name="chart.png",
            size=20,
        )
        session.add_all([upload, tool_file])
        session.flush()
        upload_id = upload.id
        tool_file_id = tool_file.id

    statements: list[str] = []

    def record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        refs = tuple(
            FileRef(id=upload_id, kind=FileKind.UPLOAD)
            if index % 2 == 0
            else FileRef(id=tool_file_id, kind=FileKind.TOOL)
            for index in range(100)
        )
        resolved = FileGrantRepository(session_factory=sqlite_session_factory).resolve_owned_files(
            context=FileGrantContext(tenant_id, "app-1", end_user_id),
            refs=refs,
        )
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)

    assert len(statements) == 2
    assert [file.kind if file is not None else None for file in resolved] == [ref.kind for ref in refs]
