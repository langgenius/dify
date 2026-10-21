"""PostgreSQL/MySQL concurrency coverage for knowledge upload-file cleanup."""

import json
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier, Event, Lock, current_thread
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy import event, select, text
from sqlalchemy.engine import Connection, Engine, ExecutionContext
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql.elements import ColumnElement, TextClause

from graphon.file import FileTransferMethod, FileType
from models.account import Account
from models.agent import Agent, AgentConfigDraft, AgentConfigDraftType, AgentKind, AgentScope, AgentSource
from models.agent_config_entities import AgentConfigFileRefConfig, AgentSoulConfig
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import ConversationFromSource, CreatorUserRole, DataSourceType
from models.human_input import HumanInputFormUploadFile
from models.model import App, IconType, KnowledgeUploadFileReference, MessageFile, UploadFile
from models.tools import ToolFile
from repositories.knowledge.upload_file_repository import (
    AgentConfigToolFileCleanup,
    AgentConfigToolFilePendingDeletionError,
    claim_orphan_agent_config_tool_files,
    claim_orphan_upload_files,
    delete_orphan_upload_files,
    find_orphan_upload_files,
    register_upload_file_reference_guards,
    remove_document_upload_file_references,
    remove_segment_upload_file_references,
    replace_document_upload_file_references,
)
from services.knowledge.indexing.cleanup import UploadFileCleanup, UploadFilePendingDeletionError
from tests.unit_tests.model_factories import (
    make_account,
    make_app,
    make_conversation,
    make_dataset,
    make_document,
    make_message,
    make_upload_file,
)

_ICON_OWNER_TABLE_NAMES = (
    "upload_files",
    "datasets",
    "segment_attachment_bindings",
    "knowledge_upload_file_references",
    "workflow_draft_variable_upload_file_references",
    "workflow_draft_variables",
    "workflows",
    "documents",
    "document_segments",
    "apps",
    "sites",
    "accounts",
    "tenants",
    "pipeline_customized_templates",
    "agents",
    "agent_config_drafts",
    "agent_config_snapshots",
    "agent_config_upload_file_references",
    "agent_config_tool_file_references",
    "tool_files",
    "conversations",
    "customized_snippets",
    "tool_mcp_providers",
    "message_files",
    "messages",
    "workflow_node_execution_offload",
    "workflow_draft_variable_files",
    "human_input_form_upload_files",
)


def _create_icon_owner_schema(engine: Engine) -> sa.MetaData:
    """Create the owner tables used by the global orphan fence, without unrelated FKs."""

    metadata = sa.MetaData()
    application_metadata = UploadFile.metadata
    for table_name in _ICON_OWNER_TABLE_NAMES:
        source = application_metadata.tables[table_name]
        columns: list[sa.Column[object]] = []
        for source_column in source.columns:
            default_clause = source_column.server_default
            server_default: ColumnElement[object] | TextClause | str | None = None
            if isinstance(default_clause, sa.schema.DefaultClause) and isinstance(
                default_clause.arg, (ColumnElement, TextClause, str)
            ):
                server_default = default_clause.arg
            columns.append(
                sa.Column(
                    source_column.name,
                    source_column.type,
                    primary_key=source_column.primary_key,
                    nullable=source_column.nullable,
                    server_default=server_default,
                )
            )
        sa.Table(table_name, metadata, *columns)
    metadata.create_all(engine)
    return metadata


@pytest.fixture(params=("postgresql", "mysql"), scope="module")
def icon_lifecycle_engine(request: pytest.FixtureRequest) -> Generator[Engine]:
    if request.param == "postgresql":
        testcontainers_postgres = pytest.importorskip("testcontainers.postgres")
        container = testcontainers_postgres.PostgresContainer("postgres:15-alpine")
    else:
        testcontainers_mysql = pytest.importorskip("testcontainers.mysql")
        container = testcontainers_mysql.MySqlContainer("mysql:8.0")

    container.start()
    engine = sa.create_engine(container.get_connection_url().replace("mysql://", "mysql+pymysql://", 1))
    _create_icon_owner_schema(engine)
    try:
        yield engine
    finally:
        engine.dispose()
        container.stop()


@pytest.fixture
def icon_lifecycle_sessions(icon_lifecycle_engine: Engine) -> sessionmaker[Session]:
    application_metadata = UploadFile.metadata
    with icon_lifecycle_engine.begin() as connection:
        for table_name in reversed(_ICON_OWNER_TABLE_NAMES):
            connection.execute(application_metadata.tables[table_name].delete())
    register_upload_file_reference_guards()
    return sessionmaker(bind=icon_lifecycle_engine, expire_on_commit=False)


def _image_icon(upload_file_id: str) -> dict[str, str]:
    return {"icon_type": IconType.IMAGE.value, "icon": upload_file_id}


def _seed_icon_files(
    sessions: sessionmaker[Session],
    *,
    tenant_id: str,
    file_ids: tuple[str, ...],
) -> None:
    with sessions.begin() as session:
        session.add_all(
            make_upload_file(
                file_id=file_id,
                tenant_id=tenant_id,
                key=f"dataset-icons/{file_id}.png",
                extension="png",
                mime_type="image/png",
                created_by=tenant_id,
            )
            for file_id in file_ids
        )


def _seed_icon_datasets(
    sessions: sessionmaker[Session],
    *,
    tenant_id: str,
    assignments: tuple[tuple[str, str], ...],
) -> None:
    with sessions.begin() as session:
        session.add_all(
            make_dataset(
                dataset_id=dataset_id,
                tenant_id=tenant_id,
                name=dataset_id,
                created_by=tenant_id,
                icon_info=_image_icon(upload_file_id),
            )
            for dataset_id, upload_file_id in assignments
        )


def _set_finite_lock_timeout(session: Session) -> None:
    if session.get_bind().dialect.name == "postgresql":
        session.execute(text("SET LOCAL lock_timeout = '5s'"))
    else:
        session.execute(text("SET SESSION innodb_lock_wait_timeout = 5"))


def test_account_avatar_owner_check_supports_uuid_upload_ids(
    icon_lifecycle_sessions: sessionmaker[Session],
) -> None:
    tenant_id = str(uuid4())
    account = make_account(account_id=str(uuid4()))
    avatar = make_upload_file(
        tenant_id=tenant_id,
        key=f"avatars/{uuid4()}.png",
        extension="png",
        mime_type="image/png",
        created_by=account.id,
    )
    with icon_lifecycle_sessions.begin() as session:
        session.add_all([account, avatar])
    with icon_lifecycle_sessions.begin() as session:
        stored_account = session.get_one(Account, account.id)
        stored_account.avatar = avatar.id
    with icon_lifecycle_sessions.begin() as session:
        assert (
            find_orphan_upload_files(
                session,
                tenant_id=tenant_id,
                files=(UploadFileCleanup(id=avatar.id, key=avatar.key),),
            )
            == ()
        )


def test_concurrent_last_reference_deletes_produce_one_cleanup_claim(
    db_session_with_containers: Session,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    document_ids = (str(uuid4()), str(uuid4()))
    upload = make_upload_file(tenant_id=tenant_id, key=f"knowledge/{uuid4()}.txt")
    db_session_with_containers.add(upload)
    db_session_with_containers.flush()
    for document_id in document_ids:
        replace_document_upload_file_references(
            db_session_with_containers,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            data_source_type="upload_file",
            data_source_info={"upload_file_id": upload.id},
        )
    db_session_with_containers.commit()

    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    ready = Barrier(2)

    def delete_reference(document_id: str) -> tuple[UploadFileCleanup, ...]:
        with sessions.begin() as session:
            ready.wait(timeout=30)
            remove_document_upload_file_references(
                session,
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_ids=(document_id,),
            )
            return claim_orphan_upload_files(
                session,
                tenant_id=tenant_id,
                files=(UploadFileCleanup(id=upload.id, key=upload.key),),
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(delete_reference, document_id) for document_id in document_ids]
        claims = [future.result(timeout=30) for future in futures]

    claimed = [file for claim in claims for file in claim]
    assert claimed == [UploadFileCleanup(id=upload.id, key=upload.key)]
    with sessions.begin() as session:
        delete_orphan_upload_files(session, tenant_id=tenant_id, files=claimed)
    db_session_with_containers.expire_all()
    assert db_session_with_containers.get(UploadFile, upload.id) is None


def test_local_message_reference_waits_for_cleanup_claim_and_rejects_pending_file(
    db_session_with_containers: Session,
) -> None:
    register_upload_file_reference_guards()
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    conversation_id = str(uuid4())
    message_id = str(uuid4())
    upload = make_upload_file(tenant_id=tenant_id, key=f"messages/{uuid4()}.txt")
    db_session_with_containers.add_all(
        [
            make_app(app_id=app_id, tenant_id=tenant_id),
            make_conversation(
                conversation_id=conversation_id,
                app_id=app_id,
                inputs={},
                from_source=ConversationFromSource.API,
            ),
            make_message(
                message_id=message_id,
                app_id=app_id,
                conversation_id=conversation_id,
                inputs={},
                query="question",
                message={},
                answer="answer",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
            ),
            upload,
        ]
    )
    db_session_with_containers.commit()

    engine = db_session_with_containers.get_bind()
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    writer_reached_file_lock = Event()

    def observe_writer_file_lock(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        normalized = " ".join(statement.lower().replace('"', "").replace("`", "").split())
        if (
            current_thread().name.startswith("message-file-writer")
            and " from upload_files " in normalized
            and " for update" in normalized
        ):
            writer_reached_file_lock.set()

    event.listen(engine, "before_cursor_execute", observe_writer_file_lock)
    cleanup_session = sessions()
    cleanup_transaction = cleanup_session.begin()
    try:
        claimed = claim_orphan_upload_files(
            cleanup_session,
            tenant_id=tenant_id,
            files=(UploadFileCleanup(id=upload.id, key=upload.key),),
        )
        assert claimed == (UploadFileCleanup(id=upload.id, key=upload.key),)

        def create_message_reference() -> bool:
            with sessions.begin() as session:
                session.add(
                    MessageFile(
                        message_id=message_id,
                        type=FileType.DOCUMENT,
                        transfer_method=FileTransferMethod.LOCAL_FILE,
                        upload_file_id=upload.id,
                        created_by_role=CreatorUserRole.ACCOUNT,
                        created_by=str(uuid4()),
                    )
                )
                try:
                    session.flush()
                except UploadFilePendingDeletionError:
                    return False
            return True

        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="message-file-writer") as executor:
            future = executor.submit(create_message_reference)
            assert writer_reached_file_lock.wait(timeout=30)
            cleanup_transaction.commit()
            assert future.result(timeout=30) is False
    finally:
        if cleanup_transaction.is_active:
            cleanup_transaction.rollback()
        cleanup_session.close()
        event.remove(engine, "before_cursor_execute", observe_writer_file_lock)

    with sessions() as session:
        assert session.scalar(select(MessageFile).where(MessageFile.message_id == message_id)) is None


def test_app_icon_reference_waits_for_cleanup_claim_and_rejects_pending_file(
    db_session_with_containers: Session,
) -> None:
    register_upload_file_reference_guards()
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    upload = make_upload_file(tenant_id=tenant_id, key=f"app-icons/{uuid4()}.png")
    db_session_with_containers.add(upload)
    db_session_with_containers.commit()

    engine = db_session_with_containers.get_bind()
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    writer_reached_file_lock = Event()

    def observe_writer_file_lock(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        normalized = " ".join(statement.lower().replace('"', "").replace("`", "").split())
        if (
            current_thread().name.startswith("app-icon-writer")
            and " from upload_files " in normalized
            and " for update" in normalized
        ):
            writer_reached_file_lock.set()

    event.listen(engine, "before_cursor_execute", observe_writer_file_lock)
    cleanup_session = sessions()
    cleanup_transaction = cleanup_session.begin()
    try:
        claimed = claim_orphan_upload_files(
            cleanup_session,
            tenant_id=tenant_id,
            files=(UploadFileCleanup(id=upload.id, key=upload.key),),
        )
        assert claimed == (UploadFileCleanup(id=upload.id, key=upload.key),)

        def create_app_icon_reference() -> bool:
            with sessions.begin() as session:
                session.add(
                    make_app(
                        app_id=app_id,
                        tenant_id=tenant_id,
                        icon_type=IconType.IMAGE,
                        icon=f"/files/{upload.id}/file-preview",
                    )
                )
                try:
                    session.flush()
                except UploadFilePendingDeletionError:
                    return False
            return True

        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="app-icon-writer") as executor:
            future = executor.submit(create_app_icon_reference)
            assert writer_reached_file_lock.wait(timeout=30)
            cleanup_transaction.commit()
            assert future.result(timeout=30) is False
    finally:
        if cleanup_transaction.is_active:
            cleanup_transaction.rollback()
        cleanup_session.close()
        event.remove(engine, "before_cursor_execute", observe_writer_file_lock)

    with sessions() as session:
        assert session.get(App, app_id) is None


def test_agent_config_writer_waits_for_cleanup_claim_and_rejects_pending_file(
    icon_lifecycle_sessions: sessionmaker[Session],
    icon_lifecycle_engine: Engine,
) -> None:
    tenant_id = str(uuid4())
    agent_id = str(uuid4())
    upload = make_upload_file(tenant_id=tenant_id, key=f"agent-config/{uuid4()}.txt")
    with icon_lifecycle_sessions.begin() as session:
        session.add_all(
            [
                upload,
                Agent(
                    id=agent_id,
                    tenant_id=tenant_id,
                    name="Agent",
                    agent_kind=AgentKind.DIFY_AGENT,
                    scope=AgentScope.ROSTER,
                    source=AgentSource.ROSTER,
                ),
            ]
        )

    writer_reached_file_lock = Event()

    def observe_writer_file_lock(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        normalized = " ".join(statement.lower().replace('"', "").replace("`", "").split())
        if (
            current_thread().name.startswith("agent-config-writer")
            and " from upload_files " in normalized
            and " for update" in normalized
        ):
            writer_reached_file_lock.set()

    event.listen(icon_lifecycle_engine, "before_cursor_execute", observe_writer_file_lock)
    cleanup_session = icon_lifecycle_sessions()
    cleanup_transaction = cleanup_session.begin()
    try:
        candidate = (UploadFileCleanup(id=upload.id, key=upload.key),)
        assert claim_orphan_upload_files(cleanup_session, tenant_id=tenant_id, files=candidate) == candidate

        def create_config_reference() -> bool:
            with icon_lifecycle_sessions.begin() as session:
                session.add(
                    AgentConfigDraft(
                        tenant_id=tenant_id,
                        agent_id=agent_id,
                        draft_type=AgentConfigDraftType.DRAFT,
                        account_id=None,
                        draft_owner_key="",
                        config_snapshot=AgentSoulConfig(
                            config_files=[
                                AgentConfigFileRefConfig(
                                    name="guide.txt",
                                    file_kind="upload_file",
                                    file_id=upload.id,
                                )
                            ]
                        ),
                    )
                )
                try:
                    session.flush()
                except UploadFilePendingDeletionError:
                    return False
            return True

        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="agent-config-writer") as executor:
            future = executor.submit(create_config_reference)
            assert writer_reached_file_lock.wait(timeout=30)
            cleanup_transaction.commit()
            assert future.result(timeout=30) is False
    finally:
        if cleanup_transaction.is_active:
            cleanup_transaction.rollback()
        cleanup_session.close()
        event.remove(icon_lifecycle_engine, "before_cursor_execute", observe_writer_file_lock)

    with icon_lifecycle_sessions() as session:
        assert session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.agent_id == agent_id)) is None


def test_agent_config_tool_file_writer_waits_for_cleanup_claim_and_rejects_pending_file(
    icon_lifecycle_sessions: sessionmaker[Session],
    icon_lifecycle_engine: Engine,
) -> None:
    tenant_id = str(uuid4())
    agent_id = str(uuid4())
    tool_file = ToolFile(
        tenant_id=tenant_id,
        user_id=str(uuid4()),
        conversation_id=None,
        file_key=f"tools/{uuid4()}.txt",
        mimetype="text/plain",
        name="guide.txt",
        size=5,
    )
    with icon_lifecycle_sessions.begin() as session:
        session.add_all(
            [
                tool_file,
                Agent(
                    id=agent_id,
                    tenant_id=tenant_id,
                    name="Agent",
                    agent_kind=AgentKind.DIFY_AGENT,
                    scope=AgentScope.ROSTER,
                    source=AgentSource.ROSTER,
                ),
            ]
        )

    writer_reached_file_lock = Event()

    def observe_writer_file_lock(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        normalized = " ".join(statement.lower().replace('"', "").replace("`", "").split())
        if (
            current_thread().name.startswith("agent-tool-file-writer")
            and " from tool_files " in normalized
            and " for update" in normalized
        ):
            writer_reached_file_lock.set()

    event.listen(icon_lifecycle_engine, "before_cursor_execute", observe_writer_file_lock)
    cleanup_session = icon_lifecycle_sessions()
    cleanup_transaction = cleanup_session.begin()
    try:
        candidate = (AgentConfigToolFileCleanup(id=tool_file.id, key=tool_file.file_key),)
        assert claim_orphan_agent_config_tool_files(cleanup_session, tenant_id=tenant_id, files=candidate) == candidate

        def create_config_reference() -> bool:
            with icon_lifecycle_sessions.begin() as session:
                session.add(
                    AgentConfigDraft(
                        tenant_id=tenant_id,
                        agent_id=agent_id,
                        draft_type=AgentConfigDraftType.DRAFT,
                        account_id=None,
                        draft_owner_key="",
                        config_snapshot=AgentSoulConfig(
                            config_files=[
                                AgentConfigFileRefConfig(
                                    name="guide.txt",
                                    file_kind="tool_file",
                                    file_id=tool_file.id,
                                )
                            ]
                        ),
                    )
                )
                try:
                    session.flush()
                except AgentConfigToolFilePendingDeletionError:
                    return False
            return True

        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="agent-tool-file-writer") as executor:
            future = executor.submit(create_config_reference)
            assert writer_reached_file_lock.wait(timeout=30)
            cleanup_transaction.commit()
            assert future.result(timeout=30) is False
    finally:
        if cleanup_transaction.is_active:
            cleanup_transaction.rollback()
        cleanup_session.close()
        event.remove(icon_lifecycle_engine, "before_cursor_execute", observe_writer_file_lock)

    with icon_lifecycle_sessions() as session:
        assert session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.agent_id == agent_id)) is None
        assert session.get_one(ToolFile, tool_file.id).cleanup_started_at is not None


def test_normalized_owner_writer_waits_for_cleanup_and_rejects_the_claimed_file(
    db_session_with_containers: Session,
) -> None:
    register_upload_file_reference_guards()
    tenant_id = str(uuid4())
    upload = make_upload_file(tenant_id=tenant_id, key=f"human-input/{uuid4()}.txt")
    db_session_with_containers.add(upload)
    db_session_with_containers.commit()

    engine = db_session_with_containers.get_bind()
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    writer_reached_file_lock = Event()

    def observe_writer_file_lock(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        normalized = " ".join(statement.lower().replace('"', "").replace("`", "").split())
        if (
            current_thread().name.startswith("human-input-writer")
            and " from upload_files " in normalized
            and " for update" in normalized
        ):
            writer_reached_file_lock.set()

    event.listen(engine, "before_cursor_execute", observe_writer_file_lock)
    cleanup_session = sessions()
    cleanup_transaction = cleanup_session.begin()
    try:
        candidate = (UploadFileCleanup(id=upload.id, key=upload.key),)
        assert (
            claim_orphan_upload_files(
                cleanup_session,
                tenant_id=tenant_id,
                files=candidate,
            )
            == candidate
        )

        def create_human_input_reference() -> bool:
            with sessions.begin() as session:
                session.add(
                    HumanInputFormUploadFile(
                        tenant_id=tenant_id,
                        app_id=str(uuid4()),
                        form_id=str(uuid4()),
                        upload_file_id=upload.id,
                        upload_token_id=str(uuid4()),
                    )
                )
                try:
                    session.flush()
                except UploadFilePendingDeletionError:
                    return False
            return True

        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="human-input-writer") as executor:
            future = executor.submit(create_human_input_reference)
            assert writer_reached_file_lock.wait(timeout=30)
            cleanup_transaction.commit()
            assert future.result(timeout=30) is False
    finally:
        if cleanup_transaction.is_active:
            cleanup_transaction.rollback()
        cleanup_session.close()
        event.remove(engine, "before_cursor_execute", observe_writer_file_lock)

    with sessions() as session:
        assert (
            session.scalar(select(HumanInputFormUploadFile).where(HumanInputFormUploadFile.upload_file_id == upload.id))
            is None
        )


def test_cleanup_waits_for_normalized_owner_writer_and_releases_its_candidate(
    db_session_with_containers: Session,
) -> None:
    register_upload_file_reference_guards()
    tenant_id = str(uuid4())
    upload = make_upload_file(tenant_id=tenant_id, key=f"human-input/{uuid4()}.txt")
    db_session_with_containers.add(upload)
    db_session_with_containers.commit()

    engine = db_session_with_containers.get_bind()
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    writer = sessions()
    writer.begin()
    owner = HumanInputFormUploadFile(
        tenant_id=tenant_id,
        app_id=str(uuid4()),
        form_id=str(uuid4()),
        upload_file_id=upload.id,
        upload_token_id=str(uuid4()),
    )
    writer.add(owner)
    writer.flush()

    cleanup_reached_file_lock = Event()

    def observe_cleanup_file_lock(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        normalized = " ".join(statement.lower().replace('"', "").replace("`", "").split())
        if (
            current_thread().name.startswith("upload-cleaner")
            and " from upload_files " in normalized
            and " for update" in normalized
        ):
            cleanup_reached_file_lock.set()

    event.listen(engine, "before_cursor_execute", observe_cleanup_file_lock)
    try:

        def claim_candidate() -> tuple[UploadFileCleanup, ...]:
            with sessions.begin() as session:
                return claim_orphan_upload_files(
                    session,
                    tenant_id=tenant_id,
                    files=(UploadFileCleanup(id=upload.id, key=upload.key),),
                )

        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="upload-cleaner") as executor:
            future = executor.submit(claim_candidate)
            assert cleanup_reached_file_lock.wait(timeout=30)
            assert not future.done()
            writer.commit()
            assert future.result(timeout=30) == ()
    finally:
        if writer.in_transaction():
            writer.rollback()
        writer.close()
        event.remove(engine, "before_cursor_execute", observe_cleanup_file_lock)

    with sessions() as session:
        retained = session.get_one(UploadFile, upload.id)
        assert retained.knowledge_cleanup_started_at is None
        assert (
            session.scalar(select(HumanInputFormUploadFile).where(HumanInputFormUploadFile.upload_file_id == upload.id))
            is not None
        )


def _seed_knowledge_owner_race(
    sessions: sessionmaker[Session],
    *,
    owner_kind: str,
) -> tuple[str, str, str, str | None]:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    segment_id = str(uuid4()) if owner_kind == "segment" else None
    upload_id = str(uuid4())
    with sessions.begin() as session:
        owners: list[object] = [
            make_dataset(dataset_id=dataset_id, tenant_id=tenant_id, created_by=tenant_id),
            make_upload_file(
                file_id=upload_id,
                tenant_id=tenant_id,
                key=f"knowledge/{upload_id}.png",
                extension="png",
                mime_type="image/png",
                created_by=tenant_id,
            ),
        ]
        if owner_kind == "segment":
            owners.append(
                make_document(
                    document_id=document_id,
                    tenant_id=tenant_id,
                    dataset_id=dataset_id,
                    data_source_type=DataSourceType.NOTION_IMPORT,
                    data_source_info="{}",
                    created_by=tenant_id,
                )
            )
        session.add_all(owners)
    return tenant_id, dataset_id, document_id, segment_id


def _add_knowledge_file_owner(
    session: Session,
    *,
    owner_kind: str,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    segment_id: str | None,
    upload_id: str,
) -> None:
    if owner_kind == "document":
        session.add(
            make_document(
                document_id=document_id,
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                data_source_type=DataSourceType.UPLOAD_FILE,
                data_source_info=json.dumps({"upload_file_id": upload_id}),
                created_by=tenant_id,
            )
        )
        return
    assert segment_id is not None
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content=f"![image](/files/{upload_id}/image-preview)",
        word_count=1,
        tokens=1,
        created_by=tenant_id,
    )
    segment.id = segment_id
    session.add(segment)


@pytest.mark.parametrize("owner_kind", ["document", "segment"])
def test_knowledge_owner_writer_waits_for_cleanup_and_rejects_claimed_file(
    icon_lifecycle_engine: Engine,
    icon_lifecycle_sessions: sessionmaker[Session],
    owner_kind: str,
) -> None:
    tenant_id, dataset_id, document_id, segment_id = _seed_knowledge_owner_race(
        icon_lifecycle_sessions,
        owner_kind=owner_kind,
    )
    with icon_lifecycle_sessions() as session:
        upload = session.scalar(select(UploadFile).where(UploadFile.tenant_id == tenant_id))
        assert upload is not None
        candidate = UploadFileCleanup(id=upload.id, key=upload.key)

    writer_reached_file_lock = Event()

    def observe_writer_file_lock(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        normalized = " ".join(statement.lower().replace('"', "").replace("`", "").split())
        if (
            current_thread().name.startswith("knowledge-owner-writer")
            and " from upload_files " in normalized
            and " for update" in normalized
        ):
            writer_reached_file_lock.set()

    event.listen(icon_lifecycle_engine, "before_cursor_execute", observe_writer_file_lock)
    cleanup = icon_lifecycle_sessions()
    cleanup_transaction = cleanup.begin()
    try:
        assert claim_orphan_upload_files(cleanup, tenant_id=tenant_id, files=(candidate,)) == (candidate,)

        def create_owner() -> bool:
            with icon_lifecycle_sessions.begin() as session:
                _set_finite_lock_timeout(session)
                _add_knowledge_file_owner(
                    session,
                    owner_kind=owner_kind,
                    tenant_id=tenant_id,
                    dataset_id=dataset_id,
                    document_id=document_id,
                    segment_id=segment_id,
                    upload_id=candidate.id,
                )
                try:
                    session.flush()
                except UploadFilePendingDeletionError:
                    return False
            return True

        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="knowledge-owner-writer") as executor:
            future = executor.submit(create_owner)
            assert writer_reached_file_lock.wait(timeout=30)
            cleanup_transaction.commit()
            assert future.result(timeout=30) is False
    finally:
        if cleanup_transaction.is_active:
            cleanup_transaction.rollback()
        cleanup.close()
        event.remove(icon_lifecycle_engine, "before_cursor_execute", observe_writer_file_lock)

    with icon_lifecycle_sessions() as session:
        assert session.scalar(select(KnowledgeUploadFileReference)) is None
        if owner_kind == "document":
            assert session.get(Document, document_id) is None
        else:
            assert session.get(DocumentSegment, segment_id) is None


@pytest.mark.parametrize("owner_kind", ["document", "segment"])
def test_cleanup_waits_for_knowledge_owner_writer_and_releases_candidate(
    icon_lifecycle_engine: Engine,
    icon_lifecycle_sessions: sessionmaker[Session],
    owner_kind: str,
) -> None:
    tenant_id, dataset_id, document_id, segment_id = _seed_knowledge_owner_race(
        icon_lifecycle_sessions,
        owner_kind=owner_kind,
    )
    with icon_lifecycle_sessions() as session:
        upload = session.scalar(select(UploadFile).where(UploadFile.tenant_id == tenant_id))
        assert upload is not None
        candidate = UploadFileCleanup(id=upload.id, key=upload.key)

    writer = icon_lifecycle_sessions()
    writer.begin()
    _set_finite_lock_timeout(writer)
    _add_knowledge_file_owner(
        writer,
        owner_kind=owner_kind,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        segment_id=segment_id,
        upload_id=candidate.id,
    )
    writer.flush()
    cleanup_reached_file_lock = Event()

    def observe_cleanup_file_lock(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        normalized = " ".join(statement.lower().replace('"', "").replace("`", "").split())
        if (
            current_thread().name.startswith("knowledge-owner-cleaner")
            and " from upload_files " in normalized
            and " for update" in normalized
        ):
            cleanup_reached_file_lock.set()

    event.listen(icon_lifecycle_engine, "before_cursor_execute", observe_cleanup_file_lock)
    try:

        def claim_candidate() -> tuple[UploadFileCleanup, ...]:
            with icon_lifecycle_sessions.begin() as session:
                _set_finite_lock_timeout(session)
                return claim_orphan_upload_files(session, tenant_id=tenant_id, files=(candidate,))

        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="knowledge-owner-cleaner") as executor:
            future = executor.submit(claim_candidate)
            assert cleanup_reached_file_lock.wait(timeout=30)
            assert not future.done()
            writer.commit()
            assert future.result(timeout=30) == ()
    finally:
        if writer.in_transaction():
            writer.rollback()
        writer.close()
        event.remove(icon_lifecycle_engine, "before_cursor_execute", observe_cleanup_file_lock)

    with icon_lifecycle_sessions() as session:
        retained = session.get_one(UploadFile, candidate.id)
        assert retained.knowledge_cleanup_started_at is None
        reference = session.scalar(select(KnowledgeUploadFileReference))
        assert reference is not None
        assert reference.upload_file_id == candidate.id


@pytest.mark.parametrize("owner_kind", ["document", "segment"])
def test_cleanup_owner_current_read_fails_fast_behind_parent_first_writer(
    icon_lifecycle_sessions: sessionmaker[Session],
    owner_kind: str,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    segment_id = str(uuid4())
    old_upload = make_upload_file(
        file_id=str(uuid4()),
        tenant_id=tenant_id,
        key=f"knowledge/{uuid4()}.png",
        extension="png",
        mime_type="image/png",
        created_by=tenant_id,
    )
    new_upload = make_upload_file(
        file_id=str(uuid4()),
        tenant_id=tenant_id,
        key=f"knowledge/{uuid4()}.png",
        extension="png",
        mime_type="image/png",
        created_by=tenant_id,
    )
    document = make_document(
        document_id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        data_source_type=DataSourceType.UPLOAD_FILE if owner_kind == "document" else DataSourceType.NOTION_IMPORT,
        data_source_info=json.dumps({"upload_file_id": old_upload.id}) if owner_kind == "document" else "{}",
        created_by=tenant_id,
    )
    segment: DocumentSegment | None = None
    if owner_kind == "segment":
        segment = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            position=1,
            content=f"![old](/files/{old_upload.id}/image-preview)",
            word_count=1,
            tokens=1,
            created_by=tenant_id,
        )
        segment.id = segment_id
    with icon_lifecycle_sessions.begin() as session:
        session.add_all(
            [
                make_dataset(dataset_id=dataset_id, tenant_id=tenant_id, created_by=tenant_id),
                old_upload,
                new_upload,
            ]
        )
        session.flush()
        session.add(document)
        session.flush()
        if segment is not None:
            session.add(segment)
            session.flush()

    writer = icon_lifecycle_sessions()
    writer.begin()
    _set_finite_lock_timeout(writer)
    writer.scalar(select(Dataset.id).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id).with_for_update())
    locked_document = writer.scalar(
        select(Document)
        .where(Document.id == document_id, Document.dataset_id == dataset_id, Document.tenant_id == tenant_id)
        .with_for_update()
    )
    assert locked_document is not None
    if owner_kind == "document":
        locked_document.data_source_info = json.dumps({"upload_file_id": new_upload.id})
    else:
        locked_segment = writer.scalar(
            select(DocumentSegment)
            .where(
                DocumentSegment.id == segment_id,
                DocumentSegment.document_id == document_id,
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.tenant_id == tenant_id,
            )
            .with_for_update()
        )
        assert locked_segment is not None
        locked_segment.content = f"![new](/files/{new_upload.id}/image-preview)"
    try:

        def detach_reference() -> None:
            with icon_lifecycle_sessions.begin() as session:
                _set_finite_lock_timeout(session)
                if owner_kind == "document":
                    remove_document_upload_file_references(
                        session,
                        tenant_id=tenant_id,
                        dataset_id=dataset_id,
                        document_ids=(document_id,),
                    )
                else:
                    remove_segment_upload_file_references(
                        session,
                        tenant_id=tenant_id,
                        dataset_id=dataset_id,
                        segment_ids=(segment_id,),
                    )

        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(detach_reference)
            with pytest.raises(OperationalError):
                future.result(timeout=30)
        writer.flush()
        writer.commit()
    finally:
        if writer.in_transaction():
            writer.rollback()
        writer.close()

    with icon_lifecycle_sessions() as session:
        reference = session.scalar(select(KnowledgeUploadFileReference))
        assert reference is not None
        assert reference.upload_file_id == new_upload.id
        assert session.get_one(UploadFile, old_upload.id).knowledge_cleanup_started_at is not None
        assert session.get_one(UploadFile, new_upload.id).knowledge_cleanup_started_at is None


def test_dataset_icon_replacement_claims_old_file_in_owner_transaction(
    icon_lifecycle_sessions: sessionmaker[Session],
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    old_file_id = "00000000-0000-0000-0000-000000000101"
    new_file_id = "00000000-0000-0000-0000-000000000102"
    _seed_icon_files(icon_lifecycle_sessions, tenant_id=tenant_id, file_ids=(old_file_id, new_file_id))
    _seed_icon_datasets(
        icon_lifecycle_sessions,
        tenant_id=tenant_id,
        assignments=((dataset_id, old_file_id),),
    )

    session = icon_lifecycle_sessions()
    transaction = session.begin()
    try:
        dataset = session.get_one(Dataset, dataset_id)
        dataset.icon_info = _image_icon(new_file_id)
        session.flush()

        assert dataset.icon_info == _image_icon(new_file_id)
        assert (
            session.scalar(select(UploadFile.knowledge_cleanup_started_at).where(UploadFile.id == old_file_id))
            is not None
        )
        assert (
            session.scalar(select(UploadFile.knowledge_cleanup_started_at).where(UploadFile.id == new_file_id)) is None
        )
        transaction.commit()
    finally:
        if transaction.is_active:
            transaction.rollback()
        session.close()

    with icon_lifecycle_sessions() as verification:
        assert verification.get_one(Dataset, dataset_id).icon_info == _image_icon(new_file_id)
        assert (
            verification.scalar(select(UploadFile.knowledge_cleanup_started_at).where(UploadFile.id == old_file_id))
            is not None
        )


def test_dataset_icon_replacement_retains_old_file_with_shared_owner(
    icon_lifecycle_sessions: sessionmaker[Session],
) -> None:
    tenant_id = str(uuid4())
    old_file_id = "00000000-0000-0000-0000-000000000111"
    new_file_id = "00000000-0000-0000-0000-000000000112"
    replaced_dataset_id = str(uuid4())
    retaining_dataset_id = str(uuid4())
    _seed_icon_files(icon_lifecycle_sessions, tenant_id=tenant_id, file_ids=(old_file_id, new_file_id))
    _seed_icon_datasets(
        icon_lifecycle_sessions,
        tenant_id=tenant_id,
        assignments=((replaced_dataset_id, old_file_id), (retaining_dataset_id, old_file_id)),
    )

    with icon_lifecycle_sessions.begin() as session:
        session.get_one(Dataset, replaced_dataset_id).icon_info = _image_icon(new_file_id)

    with icon_lifecycle_sessions() as verification:
        assert verification.get_one(Dataset, retaining_dataset_id).icon_info == _image_icon(old_file_id)
        assert (
            verification.scalar(select(UploadFile.knowledge_cleanup_started_at).where(UploadFile.id == old_file_id))
            is None
        )


def test_dataset_icon_replacement_rollback_restores_owner_and_marker(
    icon_lifecycle_sessions: sessionmaker[Session],
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    old_file_id = "00000000-0000-0000-0000-000000000121"
    new_file_id = "00000000-0000-0000-0000-000000000122"
    _seed_icon_files(icon_lifecycle_sessions, tenant_id=tenant_id, file_ids=(old_file_id, new_file_id))
    _seed_icon_datasets(
        icon_lifecycle_sessions,
        tenant_id=tenant_id,
        assignments=((dataset_id, old_file_id),),
    )

    with icon_lifecycle_sessions() as session:
        dataset = session.get_one(Dataset, dataset_id)
        dataset.icon_info = _image_icon(new_file_id)
        session.flush()
        assert (
            session.scalar(select(UploadFile.knowledge_cleanup_started_at).where(UploadFile.id == old_file_id))
            is not None
        )
        session.rollback()

    with icon_lifecycle_sessions() as verification:
        assert verification.get_one(Dataset, dataset_id).icon_info == _image_icon(old_file_id)
        markers = tuple(
            verification.scalars(
                select(UploadFile.knowledge_cleanup_started_at)
                .where(UploadFile.id.in_((old_file_id, new_file_id)))
                .order_by(UploadFile.id)
            )
        )
        assert markers == (None, None)


def test_reverse_dataset_icon_swaps_lock_uploads_in_stable_order(
    icon_lifecycle_engine: Engine,
    icon_lifecycle_sessions: sessionmaker[Session],
) -> None:
    tenant_id = str(uuid4())
    first_file_id = "00000000-0000-0000-0000-000000000131"
    second_file_id = "00000000-0000-0000-0000-000000000132"
    first_dataset_id = str(uuid4())
    second_dataset_id = str(uuid4())
    retaining_first_id = str(uuid4())
    retaining_second_id = str(uuid4())
    _seed_icon_files(icon_lifecycle_sessions, tenant_id=tenant_id, file_ids=(first_file_id, second_file_id))
    _seed_icon_datasets(
        icon_lifecycle_sessions,
        tenant_id=tenant_id,
        assignments=(
            (first_dataset_id, first_file_id),
            (second_dataset_id, second_file_id),
            (retaining_first_id, first_file_id),
            (retaining_second_id, second_file_id),
        ),
    )

    lock_attempts_aligned = Barrier(2)
    lock_sql_by_thread: dict[int, str] = {}
    seen_threads_lock = Lock()

    def align_first_upload_lock(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        sql = " ".join(statement.lower().replace('"', "").replace("`", "").split())
        thread_id = current_thread().ident
        if (
            thread_id is not None
            and current_thread().name.startswith("icon-swap")
            and "from upload_files" in sql
            and "for update" in sql
        ):
            with seen_threads_lock:
                first_visit = thread_id not in lock_sql_by_thread
                lock_sql_by_thread.setdefault(thread_id, sql)
            if first_visit:
                lock_attempts_aligned.wait(timeout=20)

    def swap_icon(dataset_id: str, upload_file_id: str) -> None:
        with icon_lifecycle_sessions.begin() as session:
            _set_finite_lock_timeout(session)
            session.get_one(Dataset, dataset_id).icon_info = _image_icon(upload_file_id)

    event.listen(icon_lifecycle_engine, "before_cursor_execute", align_first_upload_lock)
    try:
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="icon-swap") as executor:
            futures = (
                executor.submit(swap_icon, first_dataset_id, second_file_id),
                executor.submit(swap_icon, second_dataset_id, first_file_id),
            )
            for future in futures:
                future.result(timeout=30)
    finally:
        event.remove(icon_lifecycle_engine, "before_cursor_execute", align_first_upload_lock)

    assert len(lock_sql_by_thread) == 2
    assert all("order by upload_files.id" in sql for sql in lock_sql_by_thread.values())
    with icon_lifecycle_sessions() as verification:
        assert verification.get_one(Dataset, first_dataset_id).icon_info == _image_icon(second_file_id)
        assert verification.get_one(Dataset, second_dataset_id).icon_info == _image_icon(first_file_id)
        markers = tuple(
            verification.scalars(
                select(UploadFile.knowledge_cleanup_started_at)
                .where(UploadFile.id.in_((first_file_id, second_file_id)))
                .order_by(UploadFile.id)
            )
        )
        assert markers == (None, None)
