import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.tools import ToolFile
from repositories.file_grant_repository import FileGrantRepository
from services.entities.file_grant_entities import FileGrantContext, FileKind, FileRef, ResolvedFile

_TENANT_ID = "22222222-2222-4222-8222-222222222222"
_USER_ID = "11111111-1111-4111-8111-111111111111"
_FILE_ID = "33333333-3333-4333-8333-333333333333"
_OTHER_FILE_ID = "44444444-4444-4444-8444-444444444444"


def _upload(
    *, file_id: str, tenant_id: str, owner_id: str, role: CreatorUserRole = CreatorUserRole.END_USER
) -> UploadFile:
    """Build an unpersisted upload with the supplied identity and owner, without writing storage."""
    upload = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.OPENDAL,
        key=f"upload_files/{file_id}",
        name="report.pdf",
        size=10,
        extension="pdf",
        mime_type="application/pdf",
        created_by=owner_id,
        created_by_role=role,
        created_at=naive_utc_now(),
        used=False,
    )
    upload.id = file_id
    return upload


@pytest.mark.parametrize(
    ("kind", "tenant_id", "owner_id", "role"),
    [
        pytest.param(FileKind.UPLOAD, "other-tenant", _USER_ID, CreatorUserRole.END_USER, id="upload-tenant"),
        pytest.param(FileKind.UPLOAD, _TENANT_ID, "other-user", CreatorUserRole.END_USER, id="upload-owner"),
        pytest.param(FileKind.UPLOAD, _TENANT_ID, _USER_ID, CreatorUserRole.ACCOUNT, id="upload-role"),
        pytest.param(FileKind.TOOL, "other-tenant", _USER_ID, CreatorUserRole.END_USER, id="tool-tenant"),
        pytest.param(FileKind.TOOL, _TENANT_ID, "other-user", CreatorUserRole.END_USER, id="tool-owner"),
    ],
)
def test_resolve_owned_files_rejects_each_mismatched_owner_dimension(
    sqlite_session_factory: sessionmaker[Session],
    kind: FileKind,
    tenant_id: str,
    owner_id: str,
    role: CreatorUserRole,
) -> None:
    """Given committed files differing in one owner dimension, return only the caller's file."""
    with sqlite_session_factory.begin() as session:
        session.add(_upload(file_id=_FILE_ID, tenant_id=_TENANT_ID, owner_id=_USER_ID))
        if kind == FileKind.UPLOAD:
            session.add(_upload(file_id=_OTHER_FILE_ID, tenant_id=tenant_id, owner_id=owner_id, role=role))
        else:
            tool_file = ToolFile(
                tenant_id=tenant_id,
                user_id=owner_id,
                conversation_id=None,
                file_key="tools/private.png",
                mimetype="image/png",
                name="private.png",
                size=20,
            )
            tool_file.id = _OTHER_FILE_ID
            session.add(tool_file)

    resolved = FileGrantRepository(session_factory=sqlite_session_factory).resolve_owned_files(
        context=FileGrantContext(_TENANT_ID, "app-1", _USER_ID),
        refs=(FileRef(_OTHER_FILE_ID, kind), FileRef(_FILE_ID, FileKind.UPLOAD)),
    )

    assert resolved == [
        None,
        ResolvedFile(_FILE_ID, FileKind.UPLOAD, "report.pdf", 10, "pdf", "application/pdf"),
    ]


def test_resolve_owned_files_preserves_order_duplicates_and_file_kind(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Resolve overlapping table IDs without mixing kinds, losing missing slots or deduplicating results."""
    with sqlite_session_factory.begin() as session:
        session.add(_upload(file_id=_FILE_ID, tenant_id=_TENANT_ID, owner_id=_USER_ID))
        tool_file = ToolFile(
            tenant_id=_TENANT_ID,
            user_id=_USER_ID,
            conversation_id=None,
            file_key="tools/chart.PNG",
            mimetype="image/png",
            name="chart.PNG",
            size=20,
        )
        tool_file.id = _FILE_ID
        session.add(tool_file)

    resolved = FileGrantRepository(session_factory=sqlite_session_factory).resolve_owned_files(
        context=FileGrantContext(_TENANT_ID, "app-1", _USER_ID),
        refs=(
            FileRef(_FILE_ID, FileKind.TOOL),
            FileRef(_OTHER_FILE_ID, FileKind.UPLOAD),
            FileRef(_FILE_ID, FileKind.UPLOAD),
            FileRef(_FILE_ID, FileKind.TOOL),
        ),
    )

    tool = ResolvedFile(_FILE_ID, FileKind.TOOL, "chart.PNG", 20, "png", "image/png")
    assert resolved == [
        tool,
        None,
        ResolvedFile(_FILE_ID, FileKind.UPLOAD, "report.pdf", 10, "pdf", "application/pdf"),
        tool,
    ]


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
