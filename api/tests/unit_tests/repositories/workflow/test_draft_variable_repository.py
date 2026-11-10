"""Plain draft-variable contracts are converted only inside the repository."""

from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from factories.variable_factory import build_segment
from graphon.variables.types import SegmentType
from models.workflow import WorkflowDraftVariable, WorkflowDraftVariableFile
from repositories.workflow.draft_variable_repository import WorkflowDraftVariableRepository
from services.workflow.draft_variable_contracts import (
    DraftVariableFileWriteCommand,
    DraftVariableRecord,
    DraftVariableWriteCommand,
)
from tests.helpers.unit.model_factories import make_upload_file


def _ids() -> tuple[str, str, str, str, str, str]:
    return str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4())


def test_selector_read_maps_models_to_detached_records(sqlite_session_factory: sessionmaker[Session]) -> None:
    tenant_id, app_id, user_id, upload_id, variable_file_id, variable_id = _ids()
    upload = make_upload_file(file_id=upload_id, tenant_id=tenant_id, key="draft/large-value.json")
    variable_file = WorkflowDraftVariableFile(
        tenant_id=tenant_id,
        app_id=app_id,
        user_id=user_id,
        upload_file_id=upload_id,
        size=128,
        length=2,
        value_type=SegmentType.OBJECT,
    )
    variable_file.id = variable_file_id
    variable = WorkflowDraftVariable.new_node_variable(
        app_id=app_id,
        user_id=user_id,
        node_id="node-1",
        name="result",
        value=build_segment({"truncated": True}),
        node_execution_id=str(uuid4()),
        file_id=variable_file_id,
    )
    variable.id = variable_id
    variable.description = "Node result"
    with sqlite_session_factory.begin() as session:
        session.add_all([upload, variable_file, variable])

    records = WorkflowDraftVariableRepository(sessions=sqlite_session_factory).get_draft_variables_by_selectors(
        app_id, [["node-1", "result"]], user_id
    )

    assert len(records) == 1
    assert isinstance(records[0], DraftVariableRecord)
    assert records[0].id == variable_id
    assert records[0].node_id == "node-1"
    assert records[0].name == "result"
    assert records[0].description == "Node result"
    assert records[0].selector == ("node-1", "result")
    assert records[0].value_type == SegmentType.OBJECT
    assert records[0].value == variable.value
    assert records[0].file_id == variable_file_id
    assert records[0].variable_file is not None
    assert records[0].variable_file.id == variable_file_id
    assert records[0].variable_file.upload_file_id == upload_id
    assert records[0].variable_file.value_type == SegmentType.OBJECT
    assert records[0].variable_file.storage_key == "draft/large-value.json"


def test_save_materializes_commands_and_replaces_the_existing_scope(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant_id, app_id, user_id, upload_id, variable_file_id, variable_id = _ids()
    with sqlite_session_factory.begin() as session:
        session.add(make_upload_file(file_id=upload_id, tenant_id=tenant_id))

    file_command = DraftVariableFileWriteCommand(
        id=variable_file_id,
        tenant_id=tenant_id,
        app_id=app_id,
        user_id=user_id,
        upload_file_id=upload_id,
        size=12,
        length=None,
        value_type=SegmentType.STRING,
    )
    variable_command = DraftVariableWriteCommand(
        id=variable_id,
        app_id=app_id,
        user_id=user_id,
        node_id="node-1",
        name="answer",
        description="Generated answer",
        value=build_segment("truncated"),
        node_execution_id=str(uuid4()),
        visible=False,
        editable=False,
        file_id=variable_file_id,
    )

    WorkflowDraftVariableRepository(sessions=sqlite_session_factory).save([variable_command], [file_command])

    with sqlite_session_factory() as session:
        stored_file = session.get(WorkflowDraftVariableFile, variable_file_id)
        stored_variable = session.get(WorkflowDraftVariable, variable_id)
        assert stored_file is not None
        assert stored_file.upload_file_id == upload_id
        assert stored_file.value_type == SegmentType.STRING
        assert stored_variable is not None
        assert stored_variable.app_id == app_id
        assert stored_variable.user_id == user_id
        assert stored_variable.description == "Generated answer"
        assert stored_variable.get_value() == build_segment("truncated")
        assert stored_variable.file_id == variable_file_id
        assert stored_variable.visible is False
        assert stored_variable.editable is False
        assert stored_variable.created_at is not None
        assert stored_variable.updated_at is not None

    replacement = DraftVariableWriteCommand(
        app_id=app_id,
        user_id=user_id,
        node_id="node-1",
        name="answer",
        description="Replacement answer",
        value=build_segment("complete"),
        node_execution_id=str(uuid4()),
        visible=True,
        editable=True,
    )
    WorkflowDraftVariableRepository(sessions=sqlite_session_factory).save([replacement], [])

    with sqlite_session_factory() as session:
        stored_variables = list(
            session.scalars(
                select(WorkflowDraftVariable).where(
                    WorkflowDraftVariable.app_id == app_id,
                    WorkflowDraftVariable.user_id == user_id,
                    WorkflowDraftVariable.node_id == "node-1",
                    WorkflowDraftVariable.name == "answer",
                )
            )
        )
        assert len(stored_variables) == 1
        stored_variable = stored_variables[0]
        assert stored_variable.id == variable_id
        assert stored_variable.description == "Replacement answer"
        assert stored_variable.get_value() == build_segment("complete")
        assert stored_variable.file_id is None
        assert stored_variable.visible is True
        assert stored_variable.editable is True


def test_prefill_preserves_an_existing_edited_value(sqlite_session_factory: sessionmaker[Session]) -> None:
    _, app_id, user_id, _, _, variable_id = _ids()
    repository = WorkflowDraftVariableRepository(sessions=sqlite_session_factory)
    repository.prefill(
        [
            DraftVariableWriteCommand(
                id=variable_id,
                app_id=app_id,
                user_id=user_id,
                node_id="conversation",
                name="greeting",
                description="Original default",
                value=build_segment("hello"),
                node_execution_id=None,
            )
        ]
    )
    edited_at = datetime(2026, 1, 2, 3, 4, 5)
    with sqlite_session_factory.begin() as session:
        stored = session.get(WorkflowDraftVariable, variable_id)
        assert stored is not None
        stored.set_value(build_segment("edited"))
        stored.last_edited_at = edited_at

    repository.prefill(
        [
            DraftVariableWriteCommand(
                app_id=app_id,
                user_id=user_id,
                node_id="conversation",
                name="greeting",
                description="Changed default",
                value=build_segment("new default"),
                node_execution_id=None,
            )
        ]
    )

    with sqlite_session_factory() as session:
        stored = session.get(WorkflowDraftVariable, variable_id)
        assert stored is not None
        assert stored.get_value() == build_segment("edited")
        assert stored.description == "Original default"
        assert stored.last_edited_at == edited_at
        assert session.scalar(select(func.count()).select_from(WorkflowDraftVariable)) == 1


def test_failed_save_rolls_back_file_then_retain_records_it_for_cleanup(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant_id, app_id, user_id, upload_id, variable_file_id, variable_id = _ids()
    with sqlite_session_factory.begin() as session:
        session.add(make_upload_file(file_id=upload_id, tenant_id=tenant_id))

    file_command = DraftVariableFileWriteCommand(
        id=variable_file_id,
        tenant_id=tenant_id,
        app_id=app_id,
        user_id=user_id,
        upload_file_id=upload_id,
        size=12,
        length=None,
        value_type=SegmentType.STRING,
    )
    variable_command = DraftVariableWriteCommand(
        id=variable_id,
        app_id=app_id,
        user_id=user_id,
        node_id="node-1",
        name="answer",
        value=build_segment("truncated"),
        node_execution_id=str(uuid4()),
        file_id=variable_file_id,
    )

    repository = WorkflowDraftVariableRepository(sessions=sqlite_session_factory)
    engine = sqlite_session_factory.kw["bind"]
    variable_insert_seen = False

    def fail_variable_insert(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        nonlocal variable_insert_seen
        if statement.lstrip().startswith("INSERT INTO workflow_draft_variables "):
            variable_insert_seen = True
            raise RuntimeError("variable insert failed")

    event.listen(engine, "before_cursor_execute", fail_variable_insert)
    try:
        with pytest.raises(RuntimeError, match="variable insert failed"):
            repository.save([variable_command], [file_command])
    finally:
        event.remove(engine, "before_cursor_execute", fail_variable_insert)
    assert variable_insert_seen
    with sqlite_session_factory() as session:
        assert session.get(WorkflowDraftVariableFile, variable_file_id) is None
        assert session.get(WorkflowDraftVariable, variable_id) is None

    repository.retain_files_for_cleanup([file_command])

    with sqlite_session_factory() as session:
        retained = session.get(WorkflowDraftVariableFile, variable_file_id)
        assert retained is not None
        assert retained.upload_file_id == upload_id
    assert repository.pending_file_cleanup(10, after=None) == [upload_id]
