# import uuid

# from sqlalchemy import Engine, select
# from sqlalchemy.orm import selectinload, sessionmaker

# from core.workflow.enums import WorkflowExecutionStatus
# from extensions.ext_storage import storage
# from libs.datetime_utils import naive_utc_now
# from libs.uuid_utils import uuidv7
# from models import WorkflowPause as WorkflowPauseModel
# from models.model import UploadFile
# from models.workflow import WorkflowRun
# from services.file_service import FileService


# class _PauseStateError(Exception):
#     pass


# class _WorkflowRunNotFoundError(_PauseStateError):
#     pass


# class _StateFileNotExistError(_PauseStateError):
#     pass


# class WorkflowPauseEntity:
#     """
#     WorkflowPauseState is the domain model for pause state management.
#     """

#     def __init__(self, model: WorkflowPauseModel, upload_file: UploadFile) -> None:
#         self._model = model
#         self._upload_file = upload_file

#     @property
#     def id(self) -> str:
#         return self._model.id

#     @property
#     def workflow_id(self) -> str:
#         return self._model.workflow_id

#     @property
#     def workflow_run_id(self) -> str:
#         """Get the workflow run ID from the model."""
#         return self._model.workflow_run_id

#     def get_state(self) -> str:
#         return storage.load(self._upload_file.key).decode()


# class PauseService:
#     _session_factory: sessionmaker
#     _file_srv: FileService

#     def __init__(self, session_factory: Engine | sessionmaker, file_service: FileService | None = None):
#         if isinstance(session_factory, Engine):
#             session_factory = sessionmaker(bind=session_factory)
#         self._session_factory = session_factory
#         if file_service is None:
#             file_service = FileService(self._session_factory)
#         self._file_srv = file_service

#     def get_pause_state(self, workflow_run_id: str) -> WorkflowPauseEntity | None:
#         query = (
#             select(WorkflowRun)
#             .options(selectinload(WorkflowRun.pause).options(selectinload(WorkflowPauseModel.state_file)))
#             .where(WorkflowRun.id == workflow_run_id)
#         )
#         with self._session_factory(expire_on_commit=False) as session:
#             run: WorkflowRun | None = session.scalars(query).first()
#         if run is None:
#             raise _WorkflowRunNotFoundError(f"WorkflowRun not found, id={workflow_run_id}")
#         pause_model = run.pause

#         if pause_model is None:
#             return None
#         if pause_model.state_file is None:
#             msg = (
#                 "StateFile not exists for PauseState, workflow_run_id={}, "
#                 "pause_state_id={}, upload_file_id={}"
#                 ).format(
#                     run.id, pause_model.id, pause_model.state_file_id
#                 )
#             )
#             raise _StateFileNotExistError(msg)
#         return WorkflowPauseEntity(model=pause_model, upload_file=pause_model.state_file)

#     def save_pause_state(self, workflow_run: WorkflowRun, workflow_owner_id: str, state: str) -> WorkflowPauseEntity:
#         upload_file = self._file_srv.upload_text(
#             text=state,
#             text_name=f"workflow-state-{uuid.uuid4()}",
#             #
#             user_id=workflow_owner_id,
#             tenant_id=workflow_run.tenant_id,
#         )
#         with self._session_factory(expire_on_commit=False) as session, session.begin():
#             state_model = WorkflowPauseModel()
#             state_model.id = str(uuidv7())
#             state_model.tenant_id = workflow_run.tenant_id
#             state_model.app_id = workflow_run.app_id
#             state_model.workflow_id = workflow_run.workflow_id
#             state_model.workflow_run_id = workflow_run.id
#             state_model.state_file_id = upload_file.id
#             session.add(state_model)
#             session.flush()
#             db_run = session.get(WorkflowRun, workflow_run.id)
#             db_run.pause_id = state_model.id
#             session.add(db_run)
#         return WorkflowPauseEntity(
#             model=state_model,
#             upload_file=upload_file,
#         )

#     def mark_as_resumed(self, pause_entity: WorkflowPauseEntity):
#         with self._session_factory() as session, session.begin():
#             pause_model = session.get(WorkflowPauseModel, pause_entity.id)
#             pause_model.resumed_at = naive_utc_now()
#             workflow_run = session.get(WorkflowRun, pause_entity.workflow_run_id)
#             workflow_run.pause_id = None
#             workflow_run.status = WorkflowExecutionStatus.RUNNING
#             session.add(workflow_run)
#             session.add(pause_model)
