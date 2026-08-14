from threading import Event, Thread
from unittest.mock import patch

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.orm import Session

from models import AppMode, Conversation, ToolFile
from models.agent import AgentDriveFile, AgentDriveFileKind
from models.enums import ConversationFromSource, ConversationStatus
from tasks.delete_conversation_task import _cleanup_conversation_related_data

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"
CONVERSATION_ID = "44444444-4444-4444-4444-444444444444"
AGENT_ID = "55555555-5555-5555-5555-555555555555"


def test_cleanup_deletes_owned_storage_and_preserves_drive_file(
    db_session_with_containers: Session,
) -> None:
    conversation = Conversation(
        id=CONVERSATION_ID,
        app_id=APP_ID,
        mode=AppMode.CHAT,
        name="Deleted conversation",
        inputs={},
        status=ConversationStatus.NORMAL,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=ACCOUNT_ID,
        is_deleted=True,
    )
    owned_file = ToolFile(
        user_id=ACCOUNT_ID,
        tenant_id=TENANT_ID,
        conversation_id=CONVERSATION_ID,
        file_key=f"tools/{TENANT_ID}/owned.txt",
        mimetype="text/plain",
        name="owned.txt",
        size=5,
    )
    drive_file = ToolFile(
        user_id=ACCOUNT_ID,
        tenant_id=TENANT_ID,
        conversation_id=CONVERSATION_ID,
        file_key=f"tools/{TENANT_ID}/drive.txt",
        mimetype="text/plain",
        name="drive.txt",
        size=5,
    )
    db_session_with_containers.add_all([conversation, owned_file, drive_file])
    db_session_with_containers.flush()
    drive_entry = AgentDriveFile(
        tenant_id=TENANT_ID,
        agent_id=AGENT_ID,
        key="drive.txt",
        file_kind=AgentDriveFileKind.TOOL_FILE,
        file_id=drive_file.id,
        value_owned_by_drive=False,
        is_skill=False,
    )
    db_session_with_containers.add(drive_entry)
    db_session_with_containers.commit()
    owned_file_id = owned_file.id
    drive_file_id = drive_file.id

    with patch("tasks.delete_conversation_task.storage") as storage_mock:
        assert _cleanup_conversation_related_data(CONVERSATION_ID) is True

    storage_mock.delete.assert_called_once_with(f"tools/{TENANT_ID}/owned.txt")
    db_session_with_containers.expire_all()
    assert db_session_with_containers.get(Conversation, CONVERSATION_ID) is None
    assert db_session_with_containers.get(ToolFile, owned_file_id) is None
    preserved = db_session_with_containers.get(ToolFile, drive_file_id)
    assert preserved is not None
    assert preserved.conversation_id is None
    preserved_drive_entry = db_session_with_containers.scalar(
        select(AgentDriveFile).where(AgentDriveFile.file_id == drive_file_id)
    )
    assert preserved_drive_entry is not None
    assert preserved_drive_entry.value_owned_by_drive is True


def test_cleanup_preserves_drive_file_committed_while_waiting_for_tool_file_lock(
    db_session_with_containers: Session,
) -> None:
    conversation = Conversation(
        id=CONVERSATION_ID,
        app_id=APP_ID,
        mode=AppMode.CHAT,
        name="Deleted conversation",
        inputs={},
        status=ConversationStatus.NORMAL,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=ACCOUNT_ID,
        is_deleted=True,
    )
    drive_file = ToolFile(
        user_id=ACCOUNT_ID,
        tenant_id=TENANT_ID,
        conversation_id=CONVERSATION_ID,
        file_key=f"tools/{TENANT_ID}/concurrent-drive.txt",
        mimetype="text/plain",
        name="concurrent-drive.txt",
        size=5,
    )
    db_session_with_containers.add_all([conversation, drive_file])
    db_session_with_containers.commit()
    drive_file_id = drive_file.id

    engine = db_session_with_containers.get_bind()
    drive_session = Session(engine)
    locked_file = drive_session.scalar(select(ToolFile).where(ToolFile.id == drive_file_id).with_for_update())
    assert locked_file is not None
    drive_session.add(
        AgentDriveFile(
            tenant_id=TENANT_ID,
            agent_id=AGENT_ID,
            key="concurrent-drive.txt",
            file_kind=AgentDriveFileKind.TOOL_FILE,
            file_id=drive_file_id,
            value_owned_by_drive=False,
            is_skill=False,
        )
    )
    drive_session.flush()

    cleanup_result: list[bool] = []
    cleanup_errors: list[BaseException] = []

    def run_cleanup() -> None:
        try:
            cleanup_result.append(_cleanup_conversation_related_data(CONVERSATION_ID))
        except BaseException as error:
            cleanup_errors.append(error)

    tool_file_lock_started = Event()

    def signal_tool_file_lock(
        _connection,
        _cursor,
        statement: str,
        _parameters,
        _context,
        _executemany,
    ) -> None:
        normalized_statement = statement.lower()
        if "from tool_files" in normalized_statement and "for update" in normalized_statement:
            tool_file_lock_started.set()

    sa.event.listen(engine, "before_cursor_execute", signal_tool_file_lock)
    cleanup_thread = Thread(target=run_cleanup)
    try:
        with patch("tasks.delete_conversation_task.storage") as storage_mock:
            cleanup_thread.start()
            assert tool_file_lock_started.wait(timeout=5)
            drive_session.commit()
            cleanup_thread.join(timeout=5)
    finally:
        sa.event.remove(engine, "before_cursor_execute", signal_tool_file_lock)
        drive_session.rollback()
        drive_session.close()
        cleanup_thread.join(timeout=5)

    assert not cleanup_thread.is_alive()
    assert cleanup_errors == []
    assert cleanup_result == [True]
    storage_mock.delete.assert_not_called()

    db_session_with_containers.expire_all()
    preserved = db_session_with_containers.get(ToolFile, drive_file_id)
    assert preserved is not None
    assert preserved.conversation_id is None
    preserved_drive_entry = db_session_with_containers.scalar(
        select(AgentDriveFile).where(AgentDriveFile.file_id == drive_file_id)
    )
    assert preserved_drive_entry is not None
    assert preserved_drive_entry.value_owned_by_drive is True
