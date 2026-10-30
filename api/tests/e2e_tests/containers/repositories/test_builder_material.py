"""Real PostgreSQL row-lock intake limits, watermark CAS and Task fences."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session as SqlSession
from sqlalchemy.orm import sessionmaker

from core.dify_builder.errors import BadRequestError, ConflictError
from core.dify_builder.models import Actor, DifyBuilderContext, EntryMode, Session
from core.dify_builder.state import PcState
from extensions.storage.storage_type import StorageType
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.dify_builder.attachment_extraction import ExtractedContext
from services.dify_builder.attachment_intake import (
    BuilderAttachmentIntake,
    MaterialReceipt,
    MaterialResult,
    NativeContextUpload,
)
from services.dify_builder.repository import SqlDifyBuilderRepository


def seed(sql: SqlSession) -> tuple[SqlDifyBuilderRepository, Actor, Session, DifyBuilderContext, str]:
    actor = Actor(tenant_id=str(uuid4()), account_id=str(uuid4()))
    factory = sessionmaker(bind=sql.get_bind(), expire_on_commit=False)
    repo = SqlDifyBuilderRepository(factory)
    session = Session(
        app_id=str(uuid4()),
        tenant_id=actor.tenant_id,
        owner_account_id=actor.account_id,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_CAPABILITY_CHECK,
    )
    context = DifyBuilderContext(goal_text="Preserve task constraints")
    repo.create_session(session, context, [])
    upload = UploadFile(
        tenant_id=actor.tenant_id,
        created_by=actor.account_id,
        created_by_role=CreatorUserRole.ACCOUNT,
        storage_type=StorageType.LOCAL,
        key="native-context-fixture",
        name="rules.txt",
        size=5,
        extension="txt",
        mime_type="text/plain",
        created_at=datetime.now(),
        used=False,
    )
    sql.add(upload)
    sql.commit()
    return repo, actor, session, context, upload.id


def queue(repo: SqlDifyBuilderRepository, actor: Actor, session: Session, upload_id: str, turn: str) -> MaterialReceipt:
    return repo.queue_builder_material(
        session.id,
        actor,
        expected_generation=0,
        task_id=f"{session.id}:0",
        client_turn_id=turn,
        text="",
        upload_file_ids=[upload_id],
    )


def test_concurrent_intake_respects_twenty_reference_limit_under_session_lock(
    db_session_with_containers: SqlSession,
) -> None:
    repo, actor, session, _, upload_id = seed(db_session_with_containers)
    for index in range(19):
        queue(repo, actor, session, upload_id, str(index))
    barrier = Barrier(2)

    def submit(turn: str) -> str:
        barrier.wait(timeout=10)
        try:
            queue(repo, actor, session, upload_id, turn)
            return "accepted"
        except BadRequestError:
            return "limit"

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(submit, ["race-a", "race-b"]))
    assert sorted(outcomes) == ["accepted", "limit"]
    receipts = repo.list_builder_material(session.id, actor)
    assert [receipt.seq for receipt in receipts] == list(range(1, 21))
    assert repo.get_session(session.id)[0].version == 1


def test_watermark_cas_survives_checkpoint_update_and_rejects_stopped_results(
    db_session_with_containers: SqlSession,
) -> None:
    repo, actor, session, context, upload_id = seed(db_session_with_containers)
    first = queue(repo, actor, session, upload_id, "first")
    context.checkpoint_seq = 42
    session.version = repo.compare_and_advance(session.id, 1, session.current_state, context, [])
    second = queue(repo, actor, session, upload_id, "second")
    session.version = repo.consume_builder_material(
        session.id,
        actor,
        base_version=session.version,
        expected_generation=0,
        task_id=f"{session.id}:0",
        watermark=first.seq,
        results=[MaterialResult(first.id, [{"upload_file_id": upload_id, "status": "consumed", "text": "Rules"}])],
        context=context,
        next_state=session.current_state,
    )
    assert [(row.seq, row.status) for row in repo.list_builder_material(session.id, actor)] == [
        (first.seq, "consumed"),
        (second.seq, "pending"),
    ]

    def extract(_upload: NativeContextUpload) -> ExtractedContext:
        stopped = DifyBuilderContext(goal_text=context.goal_text, paused=True, task_control={"generation": 1})
        repo.compare_and_advance(session.id, session.version, session.current_state, stopped, [])
        return ExtractedContext("ready", "Late results")

    with pytest.raises(ConflictError):
        BuilderAttachmentIntake(repo, extract).consume(session, context, actor)
    _, stopped = repo.get_session(session.id)
    assert stopped.attachment_material == []
    assert all(row.status == "superseded" for row in repo.list_builder_material(session.id, actor))
