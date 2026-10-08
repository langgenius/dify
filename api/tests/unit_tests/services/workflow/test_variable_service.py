"""Debug execution uses injected stores, with file I/O outside transactions."""

from collections.abc import Callable, Iterator, Sequence
from uuid import UUID

import pytest
from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.application_services.workflow_variables import build_workflow_variable_service
from extensions.ext_storage import storage
from graphon.nodes import BuiltinNodeTypes
from graphon.variables import SegmentType, StringVariable
from machinery.context import RequestContext
from models import UploadFile
from models.account import TenantAccountJoin, TenantAccountRole
from models.workflow import WorkflowDraftVariable, WorkflowDraftVariableFile
from repositories.factory import DifyAPIRepositoryFactory
from repositories.workflow.draft_variable_repository import WorkflowDraftVariableRepository
from services.app.generation.input_adapter import AppInputAdapter
from services.file_service import FileService
from services.workflow.variable_service import WorkflowVariableService
from tasks.workflow_draft_var_tasks import cleanup_draft_variable_files_task, recover_draft_variable_file_cleanup_task
from tests.unit_tests.model_factories import make_account, make_app, make_tenant, make_upload_file, make_workflow


@pytest.fixture
def tracked_sessions(
    sqlite_engine: Engine, config_overrides: Callable[..., None]
) -> Iterator[tuple[sessionmaker[Session], list[Session]]]:
    config_overrides(
        WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH=128,
        WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE=256,
    )
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    opened: list[Session] = []

    def track(session: Session, _transaction: object, _connection: object) -> None:
        opened.append(session)

    event.listen(factory, "after_begin", track)
    yield factory, opened
    event.remove(factory, "after_begin", track)


def test_core_saver_and_loader_use_injected_database_without_open_transactions_during_file_io(
    tracked_sessions: tuple[sessionmaker[Session], list[Session]], monkeypatch: pytest.MonkeyPatch
) -> None:
    factory, opened = tracked_sessions
    contents: dict[str, bytes] = {}

    def upload(key: str, data: bytes) -> None:
        assert all(not session.in_transaction() for session in opened)
        contents[key] = data

    def download(key: str) -> bytes:
        assert all(not session.in_transaction() for session in opened)
        return contents[key]

    def delete(key: str) -> None:
        assert all(not session.in_transaction() for session in opened)
        contents.pop(key, None)

    monkeypatch.setattr(storage, "save", upload)
    monkeypatch.setattr(storage, "load", download)
    monkeypatch.setattr(storage, "delete", delete)
    variables = build_workflow_variable_service(database_client=factory)
    generator = AppInputAdapter(
        draft_variable_loader=variables.workflow_loader, draft_variable_saver=variables.saver_factory
    )
    account = make_account()
    workflow = make_workflow()
    workflow.conversation_variables = [StringVariable(name="greeting", value="hello")]
    loader = variables.workflow_loader(workflow, account.id)
    assert loader.load_variables([["conversation", "greeting"]])[0].value == "hello"

    saver_factory = generator._get_draft_var_saver_factory(InvokeFrom.DEBUGGER, account, tenant_id=workflow.tenant_id)
    saver = saver_factory(workflow.app_id, "node", BuiltinNodeTypes.LLM, "execution")
    content = "large value " * 2000
    saver.save(process_data=None, outputs={"text": content})
    assert contents
    assert loader.load_variables([["node", "text"]])[0].value == content
    assert all(not session.in_transaction() for session in opened)
    with factory() as session:
        variable = session.scalars(select(WorkflowDraftVariable).where(WorkflowDraftVariable.node_id == "node")).one()
        assert variable.file_id is not None
        metadata = session.get(WorkflowDraftVariableFile, variable.file_id)
        assert metadata is not None
        assert metadata.tenant_id == workflow.tenant_id
        upload_id = metadata.upload_file_id
    variables.cleanup_files([upload_id])
    assert contents  # Live variables protect their uploads from delayed cleanup.
    variables.delete_node_variables(workflow.app_id, "node", account.id)
    assert not contents
    with factory() as session:
        assert session.get(UploadFile, upload_id) is None
        assert session.scalar(select(func.count()).select_from(WorkflowDraftVariableFile)) == 0


@pytest.mark.parametrize("failure", ["variable_insert", "metadata_insert", "commit", "second_upload"])
@pytest.mark.parametrize("cleanup_fails", [False, True])
def test_failed_save_reclaims_uploads_or_retries_from_persisted_upload_records(
    tracked_sessions: tuple[sessionmaker[Session], list[Session]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
    cleanup_fails: bool,
) -> None:
    factory, opened = tracked_sessions
    engine = factory.kw["bind"]
    contents: dict[str, bytes] = {}
    uploaded: list[str] = []
    queued: list[list[str]] = []

    def assert_closed() -> None:
        assert all(not session.in_transaction() for session in opened)

    def upload(key: str, data: bytes) -> None:
        assert_closed()
        if failure == "second_upload" and uploaded:
            raise RuntimeError("save failed")
        uploaded.append(key)
        contents[key] = data

    def delete(key: str) -> None:
        assert_closed()
        if cleanup_fails:
            raise OSError("storage unavailable")
        contents.pop(key, None)

    failure_injected = False

    def fail_insert(
        _connection: object, _cursor: object, statement: str, _parameters: object, _context: object, _many: bool
    ) -> None:
        nonlocal failure_injected
        table = {"variable_insert": "workflow_draft_variables", "metadata_insert": "workflow_draft_variable_files"}
        if not failure_injected and failure in table and statement.startswith(f"INSERT INTO {table[failure]} "):
            failure_injected = True
            raise RuntimeError("save failed")

    def fail_commit(session: Session) -> None:
        nonlocal failure_injected
        if (
            not failure_injected
            and failure == "commit"
            and any(isinstance(item, WorkflowDraftVariableFile) for item in session.identity_map.values())
        ):
            failure_injected = True
            raise RuntimeError("save failed")

    monkeypatch.setattr(storage, "save", upload)
    monkeypatch.setattr(storage, "delete", delete)
    monkeypatch.setattr(cleanup_draft_variable_files_task, "delay", queued.append)
    variables = build_workflow_variable_service(database_client=factory)
    saver = variables.saver_factory("tenant-1", make_account())("app-1", "node", BuiltinNodeTypes.LLM, "execution")
    event.listen(engine, "before_cursor_execute", fail_insert)
    event.listen(factory, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError, match="save failed"):
            saver.save(outputs={"text": "x" * 20000, "other": "y" * 20000}, process_data=None)
    finally:
        event.remove(engine, "before_cursor_execute", fail_insert)
        event.remove(factory, "before_commit", fail_commit)
    assert uploaded
    assert_closed()
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(WorkflowDraftVariableFile)) == (
            len(uploaded) if cleanup_fails else 0
        )
        assert session.scalar(select(func.count()).select_from(WorkflowDraftVariable)) == 0
        remaining = list(session.scalars(select(UploadFile)))
        if cleanup_fails:
            assert {item.key for item in remaining} == set(uploaded) == set(contents)
            assert len(queued) == 1
            assert set(queued[0]) == {item.id for item in remaining}
        else:
            assert remaining == []
            assert contents == {}
            assert queued == []

    if cleanup_fails:
        cleanup_fails = False
        # Exercise recovery with a newly composed service using only retained
        # orphan metadata; no successful message delivery or saver state is needed.
        recover_draft_variable_file_cleanup_task.run()
        recover_draft_variable_file_cleanup_task.run()
        assert contents == {}
        with sqlite_session_factory() as session:
            assert session.scalar(select(func.count()).select_from(UploadFile)) == 0


def test_failed_save_keeps_retry_information_when_cleanup_cannot_be_queued(
    tracked_sessions: tuple[sessionmaker[Session], list[Session]], monkeypatch: pytest.MonkeyPatch
) -> None:
    factory, opened = tracked_sessions
    contents: dict[str, bytes] = {}
    queued: list[list[str]] = []
    monkeypatch.setattr(storage, "save", lambda key, data: contents.__setitem__(key, data))

    def fail_write(
        _self: WorkflowDraftVariableRepository,
        _variables: Sequence[WorkflowDraftVariable],
        _files: Sequence[WorkflowDraftVariableFile],
    ) -> None:
        raise RuntimeError("original write failure")

    def fail_delete(_key: str) -> None:
        assert all(not session.in_transaction() for session in opened)
        raise OSError("storage unavailable")

    def fail_queue(ids: list[str]) -> None:
        queued.append(ids)
        raise OSError("queue unavailable")

    monkeypatch.setattr(WorkflowDraftVariableRepository, "save", fail_write)
    monkeypatch.setattr(storage, "delete", fail_delete)
    monkeypatch.setattr(cleanup_draft_variable_files_task, "delay", fail_queue)
    saver = build_workflow_variable_service(database_client=factory).saver_factory("tenant-1", make_account())(
        "app-1", "node", BuiltinNodeTypes.LLM, "execution"
    )
    with pytest.raises(RuntimeError, match="original write failure"):
        saver.save(process_data=None, outputs={"text": "x" * 20000})
    with factory() as session:
        upload = session.scalars(select(UploadFile)).one()
        assert queued == [[upload.id]]
        assert upload.key in contents
        assert session.scalar(select(func.count()).select_from(WorkflowDraftVariableFile)) == 1
    # Persisted upload metadata supports retry even when both external systems failed.
    monkeypatch.setattr(storage, "delete", lambda key: contents.pop(key, None))
    recover_draft_variable_file_cleanup_task.run()
    assert not contents
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(UploadFile)) == 0


def test_failed_cleanup_batch_does_not_starve_later_uploads(
    tracked_sessions: tuple[sessionmaker[Session], list[Session]], monkeypatch: pytest.MonkeyPatch
) -> None:
    factory, opened = tracked_sessions
    uploads = [make_upload_file(file_id=str(UUID(int=i + 1)), key=f"upload-{i}") for i in range(101)]
    with factory.begin() as session:
        session.add_all(uploads)
        session.add_all(
            WorkflowDraftVariableFile(
                upload_file_id=upload.id,
                tenant_id=upload.tenant_id,
                app_id="app-1",
                user_id=upload.created_by,
                size=upload.size,
                length=None,
                value_type=SegmentType.STRING,
            )
            for upload in uploads
        )
    attempted: list[str] = []
    failing = True

    def delete(key: str) -> None:
        assert all(not session.in_transaction() for session in opened)
        attempted.append(key)
        if failing and key != uploads[-1].key:
            raise OSError("storage unavailable for this object")

    monkeypatch.setattr(storage, "delete", delete)
    build_workflow_variable_service(database_client=factory).retry_file_cleanup(limit=100)
    assert attempted == [upload.key for upload in uploads]
    # A second sweep retries failures without losing the healthy last page.
    build_workflow_variable_service(database_client=factory).retry_file_cleanup(limit=100)
    assert attempted == [upload.key for upload in uploads] + [upload.key for upload in uploads[:100]]
    with factory() as session:
        assert session.get(UploadFile, uploads[-1].id) is None
        pending = list(session.scalars(select(WorkflowDraftVariableFile)))
        assert len(pending) == 100
    failing = False
    build_workflow_variable_service(database_client=factory).retry_file_cleanup(limit=100)
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(UploadFile)) == 0
        assert session.scalar(select(func.count()).select_from(WorkflowDraftVariableFile)) == 0


@pytest.mark.parametrize("loader_entry", ["workflow", "console"])
def test_offloaded_variables_use_injected_storage_outside_transactions(
    tracked_sessions: tuple[sessionmaker[Session], list[Session]],
    monkeypatch: pytest.MonkeyPatch,
    loader_entry: str,
) -> None:
    factory, opened = tracked_sessions
    contents: dict[str, bytes] = {}
    downloads: list[str] = []

    class IsolatedStorage:
        def load(self, filename: str) -> bytes:
            assert all(not session.in_transaction() for session in opened)
            downloads.append(filename)
            return contents[filename]

        def delete(self, filename: str) -> None:
            pytest.fail(f"loading variables must not delete {filename}")

    def unexpected_global_read(_filename: str) -> bytes:
        pytest.fail("variable loading must use the injected storage")

    # FileService owns uploading; the loader must honor its own injected reader.
    monkeypatch.setattr(storage, "save", lambda key, data: contents.__setitem__(key, data))
    monkeypatch.setattr(storage, "load", unexpected_global_read)
    variables = WorkflowVariableService(
        repository=WorkflowDraftVariableRepository(sessions=factory),
        files=FileService(factory),
        executions=DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(factory),
        storage=IsolatedStorage(),
        defer_file_cleanup=lambda _file_ids: None,
    )
    account = make_account()
    workflow = make_workflow()
    with factory.begin() as session:
        session.add_all(
            [
                account,
                workflow,
                make_app(),
                make_tenant(),
                TenantAccountJoin(tenant_id=workflow.tenant_id, account_id=account.id, role=TenantAccountRole.OWNER),
            ]
        )
    outputs = {"text": "large value " * 2000, "object": {"nested": ["value " * 1000]}}
    variables.saver_factory(workflow.tenant_id, account)(
        workflow.app_id, "node", BuiltinNodeTypes.LLM, "execution"
    ).save(process_data=None, outputs=outputs)
    assert len(contents) == 2

    loader = (
        variables.workflow_loader(workflow, account.id)
        if loader_entry == "workflow"
        else variables.loader(RequestContext("request", None, account.id, workflow.tenant_id), workflow.app_id, [])
    )
    loaded = loader.load_variables([["node", "text"], ["node", "object"]])
    assert {variable.name: variable.value for variable in loaded} == outputs
    assert sorted(downloads) == sorted(contents)
    assert all(not session.in_transaction() for session in opened)
