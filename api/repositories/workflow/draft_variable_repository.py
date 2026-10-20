"""Persistence for workflow draft variables and their stored-file metadata."""

from collections.abc import Sequence, Set
from datetime import datetime
from enum import StrEnum
from typing import NotRequired, TypedDict

from sqlalchemy import Select, delete, orm, select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql.expression import and_, or_

from configs import dify_config
from graphon.variables import Segment
from graphon.variables.consts import SELECTORS_LENGTH
from graphon.variables.types import SegmentType
from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from models import Account, Conversation, UploadFile
from models.workflow import WorkflowDraftVariable, WorkflowDraftVariableFile
from repositories.app.console_repository import console_app_actor, require_console_app
from services.workflow.variable_contracts import DraftVariableChangedError, WorkflowDraftVariableList


class WorkflowDraftVariableRepository:
    """Draft variable persistence with a short session per operation; no file I/O."""

    def __init__(self, *, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def get_variable(self, variable_id: str, *, app_id: str, user_id: str) -> WorkflowDraftVariable | None:
        with self._sessions() as session:
            return session.scalar(
                select(WorkflowDraftVariable)
                .options(
                    orm.selectinload(WorkflowDraftVariable.variable_file).selectinload(
                        WorkflowDraftVariableFile.upload_file
                    )
                )
                .where(
                    WorkflowDraftVariable.id == variable_id,
                    WorkflowDraftVariable.app_id == app_id,
                    WorkflowDraftVariable.user_id == user_id,
                )
            )

    def list_variables_without_values(
        self,
        app_id: str,
        page: int,
        limit: int,
        user_id: str,
        *,
        exclude_node_ids: Set[str] | None = None,
    ) -> WorkflowDraftVariableList:
        with self._sessions() as session:
            criteria = [
                WorkflowDraftVariable.app_id == app_id,
                WorkflowDraftVariable.user_id == user_id,
            ]
            if exclude_node_ids:
                criteria.append(WorkflowDraftVariable.node_id.notin_(list(exclude_node_ids)))
            total = None
            base_stmt = select(WorkflowDraftVariable).where(*criteria)
            if page == 1:
                from sqlalchemy import func as sa_func

                total = session.scalar(select(sa_func.count()).select_from(base_stmt.subquery()))
            variables = list(
                session.scalars(
                    # Do not load the `value` field
                    base_stmt.options(
                        orm.defer(WorkflowDraftVariable.value, raiseload=True),
                    )
                    .order_by(WorkflowDraftVariable.created_at.desc())
                    .limit(limit)
                    .offset((page - 1) * limit)
                )
            )

            return WorkflowDraftVariableList(variables=variables, total=total)

    def list_node_variables(self, app_id: str, node_id: str, user_id: str) -> WorkflowDraftVariableList:
        with self._sessions() as session:
            criteria = [
                WorkflowDraftVariable.app_id == app_id,
                WorkflowDraftVariable.node_id == node_id,
                WorkflowDraftVariable.user_id == user_id,
            ]
            variables = list(
                session.scalars(
                    select(WorkflowDraftVariable)
                    .options(orm.selectinload(WorkflowDraftVariable.variable_file))
                    .where(*criteria)
                    .order_by(WorkflowDraftVariable.created_at.desc())
                )
            )
            return WorkflowDraftVariableList(variables=variables)

    def get_node_variable(self, app_id: str, node_id: str, name: str, user_id: str) -> WorkflowDraftVariable | None:
        with self._sessions() as session:
            return session.scalar(
                select(WorkflowDraftVariable)
                .options(orm.selectinload(WorkflowDraftVariable.variable_file))
                .where(
                    WorkflowDraftVariable.app_id == app_id,
                    WorkflowDraftVariable.node_id == node_id,
                    WorkflowDraftVariable.name == name,
                    WorkflowDraftVariable.user_id == user_id,
                )
            )

    def conversation_exists(self, app_id: str, conversation_id: str) -> bool:
        with self._sessions() as session:
            return (
                session.scalar(
                    select(Conversation.id).where(Conversation.app_id == app_id, Conversation.id == conversation_id)
                )
                is not None
            )

    def add_conversation(self, conversation: Conversation) -> str:
        with self._sessions(expire_on_commit=False) as session, session.begin():
            session.add(conversation)
            session.flush()
            return conversation.id

    @staticmethod
    def _lock_variable(session: Session, snapshot: WorkflowDraftVariable) -> WorkflowDraftVariable | None:
        variable = session.scalar(
            select(WorkflowDraftVariable)
            .where(
                WorkflowDraftVariable.id == snapshot.id,
                WorkflowDraftVariable.app_id == snapshot.app_id,
                WorkflowDraftVariable.user_id == snapshot.user_id,
            )
            .with_for_update()
        )
        if variable is not None:
            if (
                variable.node_execution_id != snapshot.node_execution_id
                or variable.updated_at != snapshot.updated_at
                or variable.last_edited_at != snapshot.last_edited_at
                or variable.name != snapshot.name
                or variable.value != snapshot.value
                or variable.file_id != snapshot.file_id
                or variable.editable != snapshot.editable
            ):
                raise DraftVariableChangedError(snapshot.id)
        return variable

    def update_variable(
        self, snapshot: WorkflowDraftVariable, *, name: str | None, value: Segment | None
    ) -> WorkflowDraftVariable:
        with self._sessions(expire_on_commit=False) as session, session.begin():
            variable = self._lock_variable(session, snapshot)
            if variable is None:
                raise DraftVariableChangedError(snapshot.id)
            if name is not None:
                variable.set_name(name)
            if value is not None:
                variable.set_value(value)
                variable.file_id = None
            variable.last_edited_at = naive_utc_now()
            session.flush()
            session.refresh(variable)
            # Materialize metadata needed by response serialization after the session ends.
            session.refresh(variable, ["variable_file"])
            return variable

    def delete_variables(self, app_id: str, *, user_id: str, node_id: str | None) -> list[str]:
        with self._sessions.begin() as session:
            return delete_workflow_variables(session, app_id=app_id, user_id=user_id, node_id=node_id)

    def reset_variable(self, snapshot: WorkflowDraftVariable, value: Segment | None) -> WorkflowDraftVariable | None:
        """Apply a reset only if its detached source snapshot is still current."""
        with self._sessions(expire_on_commit=False) as session, session.begin():
            variable = self._lock_variable(session, snapshot)
            if variable is None:
                raise DraftVariableChangedError(snapshot.id)
            if value is None:
                session.delete(variable)
                return None
            variable.set_value(value)
            variable.last_edited_at = None
            variable.file_id = None
            session.flush()
            session.refresh(variable)
            return variable

    def delete_variable(self, snapshot: WorkflowDraftVariable) -> list[str]:
        """Commit the variable deletion, retaining file metadata until storage cleanup succeeds."""
        with self._sessions.begin() as session:
            variable = self._lock_variable(session, snapshot)
            if variable is None:
                return []
            upload_id = (
                session.scalar(
                    select(WorkflowDraftVariableFile.upload_file_id).where(
                        WorkflowDraftVariableFile.id == variable.file_id
                    )
                )
                if variable.file_id is not None
                else None
            )
            session.delete(variable)
        return [upload_id] if upload_id is not None else []

    def retain_files_for_cleanup(self, files: Sequence[WorkflowDraftVariableFile]) -> None:
        """Retain failed-save metadata after rollback, without replacing a committed reference."""
        with self._sessions.begin() as session:
            uploads = set(
                session.scalars(
                    select(UploadFile.id)
                    .where(UploadFile.id.in_([file.upload_file_id for file in files]))
                    .order_by(UploadFile.id)
                    .with_for_update()
                )
            )
            for file in files:
                if file.upload_file_id in uploads and session.get(WorkflowDraftVariableFile, file.id) is None:
                    session.add(file)

    def pending_file_cleanup(self, limit: int, *, after: str | None) -> list[str]:
        """Orphaned metadata is the durable work list; paginate past failures without a new table."""
        with self._sessions() as session:
            stmt = self._orphan_uploads(None).with_only_columns(UploadFile.id).order_by(UploadFile.id).limit(limit)
            if after is not None:
                stmt = stmt.where(UploadFile.id > after)
            return list(session.scalars(stmt))

    @staticmethod
    def _orphan_uploads(upload_file_ids: Sequence[str] | None) -> Select[tuple[UploadFile]]:
        """A missing ID list discovers orphans through retained draft-file metadata."""
        # These IDs belong to uploads created for draft variables, never arbitrary
        # user files. A successful/ambiguous commit must protect referenced uploads.
        return select(UploadFile).where(
            UploadFile.id.in_(
                upload_file_ids if upload_file_ids is not None else select(WorkflowDraftVariableFile.upload_file_id)
            ),
            ~select(WorkflowDraftVariable.id)
            .join(WorkflowDraftVariableFile, WorkflowDraftVariable.file_id == WorkflowDraftVariableFile.id)
            .where(WorkflowDraftVariableFile.upload_file_id == UploadFile.id)
            .exists(),
        )

    def get_orphan_uploads(self, upload_file_ids: Sequence[str]) -> list[UploadFile]:
        with self._sessions() as session:
            return list(session.scalars(self._orphan_uploads(upload_file_ids)))

    def delete_orphan_upload(self, upload_file_id: str) -> None:
        with self._sessions.begin() as session:
            upload = session.scalar(self._orphan_uploads([upload_file_id]).with_for_update())
            if upload is not None:
                files = session.scalars(
                    select(WorkflowDraftVariableFile).where(WorkflowDraftVariableFile.upload_file_id == upload.id)
                )
                for variable_file in files:
                    session.delete(variable_file)
                session.delete(upload)

    def get_draft_variables_by_selectors(
        self,
        app_id: str,
        selectors: Sequence[list[str]],
        user_id: str,
    ) -> list[WorkflowDraftVariable]:
        """
        Retrieve WorkflowDraftVariable instances based on app_id and selectors.

        The returned WorkflowDraftVariable objects are guaranteed to have their
        associated variable_file and variable_file.upload_file relationships preloaded.
        """
        if not selectors:
            return []
        with self._sessions() as session:
            ors = []
            for selector in selectors:
                assert len(selector) >= SELECTORS_LENGTH, f"Invalid selector to get: {selector}"
                node_id, name = selector[:2]
                ors.append(and_(WorkflowDraftVariable.node_id == node_id, WorkflowDraftVariable.name == name))

            # NOTE(QuantumGhost): Although the number of `or` expressions may be large, as long as
            # each expression includes conditions on both `node_id` and `name` (which are covered by the unique index),
            # PostgreSQL can efficiently retrieve the results using a bitmap index scan.
            #
            # Alternatively, a `SELECT` statement could be constructed for each selector and
            # combined using `UNION` to fetch all rows.
            # Benchmarking indicates that both approaches yield comparable performance.
            return list(
                session.scalars(
                    select(WorkflowDraftVariable)
                    .options(
                        orm.selectinload(WorkflowDraftVariable.variable_file).selectinload(
                            WorkflowDraftVariableFile.upload_file
                        )
                    )
                    .where(
                        WorkflowDraftVariable.app_id == app_id,
                        WorkflowDraftVariable.user_id == user_id,
                        or_(*ors),
                    )
                )
            )

    def save(self, variables: Sequence[WorkflowDraftVariable], files: Sequence[WorkflowDraftVariableFile]) -> None:
        with self._sessions.begin() as session:
            session.add_all(files)
            session.flush()
            _batch_upsert_draft_variable(session, variables)

    def prefill(self, variables: Sequence[WorkflowDraftVariable]) -> None:
        with self._sessions.begin() as session:
            _batch_upsert_draft_variable(session, variables, policy=_UpsertPolicy.IGNORE)

    def actor(self, context: RequestContext, app_id: str) -> Account:
        with self._sessions() as session:
            require_console_app(session, context, app_id)
            return console_app_actor(session, context)


def delete_workflow_variables(session: Session, *, app_id: str, user_id: str | None, node_id: str | None) -> list[str]:
    """Delete one scope; a missing actor is reserved for an atomic whole-app import."""
    criteria = [WorkflowDraftVariable.app_id == app_id]
    if user_id is not None:
        criteria.append(WorkflowDraftVariable.user_id == user_id)
    if node_id is not None:
        criteria.append(WorkflowDraftVariable.node_id == node_id)
    rows = session.execute(
        select(WorkflowDraftVariable.id, WorkflowDraftVariable.file_id).where(*criteria).with_for_update()
    ).all()
    upload_ids = list(
        session.scalars(
            select(WorkflowDraftVariableFile.upload_file_id).where(
                WorkflowDraftVariableFile.id.in_({row.file_id for row in rows if row.file_id is not None})
            )
        )
    )
    if rows:
        session.execute(delete(WorkflowDraftVariable).where(WorkflowDraftVariable.id.in_([row.id for row in rows])))
    return upload_ids


class _UpsertPolicy(StrEnum):
    IGNORE = "ignore"
    OVERWRITE = "overwrite"


def _batch_upsert_draft_variable(
    session: Session,
    draft_vars: Sequence[WorkflowDraftVariable],
    policy: _UpsertPolicy = _UpsertPolicy.OVERWRITE,
):
    if not draft_vars:
        return None
    # Although we could use SQLAlchemy ORM operations here, we choose not to for several reasons:
    #
    # 1. The variable saving process involves writing multiple rows to the
    #    `workflow_draft_variables` table. Batch insertion significantly improves performance.
    # 2. Using the ORM would require either:
    #
    #    a. Checking for the existence of each variable before insertion,
    #      resulting in 2n SQL statements for n variables and potential concurrency issues.
    #    b. Attempting insertion first, then updating if a unique index violation occurs,
    #      which still results in n to 2n SQL statements.
    #
    #    Both approaches are inefficient and suboptimal.
    # 3. We do not need to retrieve the results of the SQL execution or populate ORM
    #    model instances with the returned values.
    # 4. Batch insertion with `ON CONFLICT DO UPDATE` allows us to insert or update all
    #    variables in a single SQL statement, avoiding the issues above.
    #
    # For these reasons, we use the SQLAlchemy query builder and rely on dialect-specific
    # insert operations instead of the ORM layer.

    # Use different insert statements based on database type
    if dify_config.SQLALCHEMY_DATABASE_URI_SCHEME == "postgresql":
        stmt = pg_insert(WorkflowDraftVariable).values([_model_to_insertion_dict(v) for v in draft_vars])
        if policy == _UpsertPolicy.OVERWRITE:
            stmt = stmt.on_conflict_do_update(
                index_elements=WorkflowDraftVariable.unique_app_id_user_id_node_id_name(),
                set_={
                    # Refresh creation timestamp to ensure updated variables
                    # appear first in chronologically sorted result sets.
                    "created_at": stmt.excluded.created_at,
                    "updated_at": stmt.excluded.updated_at,
                    "last_edited_at": stmt.excluded.last_edited_at,
                    "description": stmt.excluded.description,
                    "value_type": stmt.excluded.value_type,
                    "value": stmt.excluded.value,
                    "visible": stmt.excluded.visible,
                    "editable": stmt.excluded.editable,
                    "node_execution_id": stmt.excluded.node_execution_id,
                    "file_id": stmt.excluded.file_id,
                },
            )
        elif policy == _UpsertPolicy.IGNORE:
            stmt = stmt.on_conflict_do_nothing(
                index_elements=WorkflowDraftVariable.unique_app_id_user_id_node_id_name()
            )
    else:
        stmt = mysql_insert(WorkflowDraftVariable).values([_model_to_insertion_dict(v) for v in draft_vars])  # type: ignore[assignment]
        if policy == _UpsertPolicy.OVERWRITE:
            stmt = stmt.on_duplicate_key_update(  # type: ignore[attr-defined]
                # Refresh creation timestamp to ensure updated variables
                # appear first in chronologically sorted result sets.
                created_at=stmt.inserted.created_at,  # type: ignore[attr-defined]
                updated_at=stmt.inserted.updated_at,  # type: ignore[attr-defined]
                last_edited_at=stmt.inserted.last_edited_at,  # type: ignore[attr-defined]
                description=stmt.inserted.description,  # type: ignore[attr-defined]
                value_type=stmt.inserted.value_type,  # type: ignore[attr-defined]
                value=stmt.inserted.value,  # type: ignore[attr-defined]
                visible=stmt.inserted.visible,  # type: ignore[attr-defined]
                editable=stmt.inserted.editable,  # type: ignore[attr-defined]
                node_execution_id=stmt.inserted.node_execution_id,  # type: ignore[attr-defined]
                file_id=stmt.inserted.file_id,  # type: ignore[attr-defined]
            )
        elif policy == _UpsertPolicy.IGNORE:
            stmt = stmt.prefix_with("IGNORE")

    if policy not in [_UpsertPolicy.OVERWRITE, _UpsertPolicy.IGNORE]:
        raise Exception("Invalid value for update policy.")
    session.execute(stmt)


class _InsertionDict(TypedDict):
    id: str
    app_id: str
    user_id: str | None
    last_edited_at: datetime | None
    node_id: str
    name: str
    selector: str
    value_type: SegmentType
    value: str
    node_execution_id: str | None
    file_id: str | None
    visible: NotRequired[bool]
    editable: NotRequired[bool]
    is_default_value: NotRequired[bool]
    created_at: NotRequired[datetime]
    updated_at: NotRequired[datetime]
    description: NotRequired[str]


def _model_to_insertion_dict(model: WorkflowDraftVariable) -> _InsertionDict:
    d: _InsertionDict = {
        "id": model.id,
        "app_id": model.app_id,
        "user_id": model.user_id,
        "last_edited_at": None,
        "node_id": model.node_id,
        "name": model.name,
        "selector": model.selector,
        "value_type": model.value_type,
        "value": model.value,
        "node_execution_id": model.node_execution_id,
        "file_id": model.file_id,
    }
    if model.visible is not None:
        d["visible"] = model.visible
    if model.editable is not None:
        d["editable"] = model.editable
    if model.created_at is not None:
        d["created_at"] = model.created_at
    if model.updated_at is not None:
        d["updated_at"] = model.updated_at
    if model.description is not None:
        d["description"] = model.description
    if model.is_default_value is not None:
        d["is_default_value"] = model.is_default_value
    return d
