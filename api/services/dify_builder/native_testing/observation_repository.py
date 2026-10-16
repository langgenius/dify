"""Bound native diagnostic rows, never C03/current-claim or replay authority."""

import hashlib
import json
import math
from contextlib import closing, contextmanager
from copy import deepcopy
from datetime import datetime, timezone
from types import GeneratorType
from typing import Any
from uuid import UUID

from configs import dify_config
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from libs.sensitive_http_telemetry import sensitive_http_telemetry
from models import CreatorUserRole, WorkflowRun
from models.enums import ExecutionOffLoadType, WorkflowRunTriggeredFrom
from models.model import UploadFile
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload, WorkflowNodeExecutionTriggeredFrom
from models.workflow import WorkflowType as ModelWorkflowType
from repositories.entities.workflow_execution import WorkflowExecution as TimedWorkflowExecution
from sqlalchemy import inspect
from sqlalchemy.orm import selectinload

from graphon.entities import WorkflowExecution, WorkflowNodeExecution
from graphon.enums import (
    WorkflowExecutionStatus,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
    WorkflowType,
)
from services.dify_builder.execution_contracts import canonical_json
from services.dify_builder.native_testing.observation_adapters import NativeObservationError, NativeObservationGuard
from services.dify_builder.native_testing.observation_owner import _checked_context
from services.dify_builder.native_testing.observation_privacy import _count, _identity
from services.dify_builder.native_testing.observation_stream import _observed, _process_data, observed_values
from services.dify_builder.native_testing.runtime_contracts import ResolvedNativeTestContext

_MAX_OFFLOAD = 8 * 1024 * 1024
_EMITTERS = (
    "sqlalchemy",
    "core.repositories",
    "extensions.ext_storage",
    "services.file_service",
    "services.dify_builder.native_testing",
)


def _stamp(context: ResolvedNativeTestContext) -> bytes:
    return canonical_json(_checked_context(context).model_dump(mode="json"))


def _time(value: Any, *, optional: bool = False) -> None:
    if value is None and optional:
        return
    if type(value) is not datetime or (value.tzinfo is not None and type(value.tzinfo) is not timezone):
        raise NativeObservationError()


def _elapsed(value: Any) -> None:
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise NativeObservationError()


def _json(value: Any) -> Any:
    if value is None:
        return None
    if type(value) is not str or len(value.encode("utf-8")) > _MAX_OFFLOAD:
        raise NativeObservationError()

    def pairs(items):
        result = {}
        for key, item in items:
            if key in result:
                raise NativeObservationError()
            result[key] = item
        return result

    return json.loads(value, object_pairs_hook=pairs)


class NativeRepositoryObservation:
    """One repository's independent context snapshot and exact process-local guard."""

    def __init__(self, *, repository: Any, context: ResolvedNativeTestContext, guard: NativeObservationGuard):
        if type(guard) is not NativeObservationGuard:
            raise NativeObservationError() from None
        self.guard = guard
        with guard.persistence_scope():
            self._original = context
            self._stamp = _stamp(context)
            self._context = deepcopy(_checked_context(context))
            self._graph = guard.graph(self._context.graph)
            self.check(repository)

    @classmethod
    def bind(cls, *, repository: Any, cache: dict, context: ResolvedNativeTestContext, guard: NativeObservationGuard):
        previous = getattr(repository, "_native_observation", None)
        if previous is not None:
            with previous.scope(repository):
                if guard is not previous.guard or _stamp(context) != previous._stamp:
                    previous.guard.fail()
            return previous
        if type(guard) is not NativeObservationGuard:
            raise NativeObservationError() from None
        with guard.persistence_scope():
            if cache or getattr(repository, "_native_observation_started", False):
                guard.fail()
            return cls(repository=repository, context=context, guard=guard)

    def check(self, repository: Any) -> None:
        self.guard.require_healthy()
        context = self._context
        if any(
            type(value) is not str for value in (repository._tenant_id, repository._app_id, repository._creator_user_id)
        ):
            self.guard.fail()
        if type(repository._creator_user_role) is not CreatorUserRole:
            self.guard.fail()
        if (
            _stamp(self._original) != self._stamp
            or _stamp(context) != self._stamp
            or repository._tenant_id != context.tenant_id
            or repository._app_id != context.app_id
            or repository._creator_user_id != context.actor_id
            or repository._creator_user_role != CreatorUserRole.ACCOUNT
            or not context.native_run_id
            or context.execution_mode != "native"
        ):
            self.guard.fail()

    @contextmanager
    def scope(self, repository: Any):
        with self.guard.persistence_scope():
            self.check(repository)
            with sensitive_http_telemetry(additional_emitters=_EMITTERS):
                yield
            self.check(repository)

    def _values(self, value: Any, *, process: bool = False) -> Any:
        if value is None:
            return None
        if process:
            projected = _process_data(self.guard, value)
            if canonical_json(projected) != canonical_json(value):
                self.guard.fail()
        elif not _observed(value):
            self.guard.fail()
        return deepcopy(value)

    def _owner(self, row: Any, *, node: bool) -> None:
        context = self._context
        if any(
            type(value) is not str for value in (row.id, row.tenant_id, row.app_id, row.workflow_id, row.created_by)
        ):
            self.guard.fail()
        if type(row.created_by_role) is not CreatorUserRole or (node and type(row.workflow_run_id) is not str):
            self.guard.fail()
        if (
            row.tenant_id != context.tenant_id
            or row.app_id != context.app_id
            or row.workflow_id != context.workflow_id
            or row.created_by != context.actor_id
            or row.created_by_role != CreatorUserRole.ACCOUNT
            or (row.workflow_run_id if node else row.id) != context.native_run_id
        ):
            self.guard.fail()
        _identity(row.id)
        _time(row.created_at)
        _time(row.finished_at, optional=True)
        _elapsed(row.elapsed_time)

    def _error(self, value: Any) -> str | None:
        if value is None or (type(value) is str and value == ""):
            return value
        return self.guard.error(value)

    def project_run(self, execution: WorkflowExecution) -> WorkflowExecution:
        context = self._context
        if (
            type(execution) not in (WorkflowExecution, TimedWorkflowExecution)
            or execution.id_ != context.native_run_id
            or execution.workflow_id != context.workflow_id
        ):
            self.guard.fail()
        if (
            execution.workflow_type is not WorkflowType.WORKFLOW
            or type(execution.status) is not WorkflowExecutionStatus
        ):
            self.guard.fail()
        _identity(execution.workflow_version)
        _time(execution.started_at)
        _time(execution.finished_at, optional=True)
        accumulated_elapsed_time = None
        if type(execution) is TimedWorkflowExecution:
            accumulated_elapsed_time = execution.accumulated_elapsed_time
            if accumulated_elapsed_time is not None:
                _elapsed(accumulated_elapsed_time)
        graph = execution.graph
        self.guard.values(graph)  # Validate plain content before canonical comparison.
        if canonical_json(graph) != canonical_json(self._graph):
            graph = self.guard.graph(graph)
        return TimedWorkflowExecution(
            id_=execution.id_,
            workflow_id=execution.workflow_id,
            workflow_type=execution.workflow_type,
            workflow_version=execution.workflow_version,
            graph=deepcopy(graph),
            inputs=observed_values(guard=self.guard, values=execution.inputs) or {},
            outputs=observed_values(guard=self.guard, values=execution.outputs),
            status=execution.status,
            error_message=self._error(execution.error_message) or "",
            total_tokens=_count(execution.total_tokens),
            total_steps=_count(execution.total_steps),
            exceptions_count=_count(execution.exceptions_count),
            started_at=execution.started_at,
            finished_at=execution.finished_at,
            accumulated_elapsed_time=accumulated_elapsed_time,
        )

    def run_row(self, row: WorkflowRun) -> WorkflowRun:
        if type(row) is not WorkflowRun:
            self.guard.fail()
        self._owner(row, node=False)
        if (
            type(row.type) not in (str, ModelWorkflowType)
            or row.type != WorkflowType.WORKFLOW.value
            or type(row.triggered_from) is not WorkflowRunTriggeredFrom
        ):
            self.guard.fail()
        if type(row.status) not in (str, WorkflowExecutionStatus):
            self.guard.fail()
        WorkflowExecutionStatus(row.status)
        _identity(row.version)
        for name in ("total_tokens", "total_steps", "exceptions_count"):
            _count(getattr(row, name))
        if canonical_json(_json(row.graph)) != canonical_json(self._graph):
            self.guard.fail()
        for name in ("inputs", "outputs"):
            self._values(_json(getattr(row, name)))
        if row.error is not None and (type(row.error) is not str or self._error(row.error) != row.error):
            self.guard.fail()
        return row

    def project_node(self, execution: WorkflowNodeExecution) -> WorkflowNodeExecution:
        if type(execution) is not WorkflowNodeExecution:
            self.guard.fail()
        context = self._context
        if execution.workflow_execution_id != context.native_run_id or execution.workflow_id != context.workflow_id:
            self.guard.fail()
        self._node_identity(execution)
        metadata = {} if execution.metadata is None else execution.metadata
        return WorkflowNodeExecution(
            id=execution.id,
            node_execution_id=execution.node_execution_id,
            workflow_id=execution.workflow_id,
            workflow_execution_id=execution.workflow_execution_id,
            index=_count(execution.index),
            predecessor_node_id=execution.predecessor_node_id,
            node_id=execution.node_id,
            node_type=execution.node_type,
            title=execution.node_type,
            inputs=observed_values(guard=self.guard, values=execution.inputs),
            outputs=observed_values(guard=self.guard, values=execution.outputs),
            process_data=_process_data(self.guard, execution.process_data),
            status=execution.status,
            error=self._error(execution.error),
            elapsed_time=execution.elapsed_time,
            metadata={
                WorkflowNodeExecutionMetadataKey(key): value
                for key, value in self.guard._policy._metadata(metadata).items()
            },
            created_at=execution.created_at,
            finished_at=execution.finished_at,
        )

    def _node_identity(self, row: Any) -> None:
        _identity(row.id)
        _identity(row.node_execution_id)
        node = self.guard._policy._nodes.get(_identity(row.node_id))
        if node is None or type(row.node_type) is not str or row.node_type != node[0]:
            self.guard.fail()
        predecessor = row.predecessor_node_id
        if predecessor is not None and type(predecessor) is not str:
            self.guard.fail()
        if predecessor is not None and not any(
            (predecessor, row.node_id) == (tail, head) for _, tail, head in self.guard._policy._edges
        ):
            self.guard.fail()
        if type(row.status) not in (str, WorkflowNodeExecutionStatus):
            self.guard.fail()
        WorkflowNodeExecutionStatus(row.status)
        _count(row.index)
        _time(row.created_at)
        _time(row.finished_at, optional=True)
        _elapsed(row.elapsed_time)

    def _node_row(self, row: WorkflowNodeExecutionModel) -> None:
        if type(row) is not WorkflowNodeExecutionModel:
            self.guard.fail()
        self._owner(row, node=True)
        self._node_identity(row)
        if (
            type(row.title) is not str
            or row.title != row.node_type
            or row.agent_workspace_binding_id is not None
            or type(row.triggered_from) is not WorkflowNodeExecutionTriggeredFrom
            or row.triggered_from != WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
        ):
            self.guard.fail()
        for name in ("inputs", "outputs", "process_data"):
            self._values(_json(getattr(row, name)), process=name == "process_data")
        metadata = _json(row.execution_metadata) or {}
        if canonical_json(self.guard._policy._metadata(metadata)) != canonical_json(metadata):
            self.guard.fail()
        if row.error is not None and (type(row.error) is not str or self._error(row.error) != row.error):
            self.guard.fail()

    def _file(self, row: WorkflowNodeExecutionModel, link: WorkflowNodeExecutionOffload, file: UploadFile) -> None:
        context = self._context
        if type(link) is not WorkflowNodeExecutionOffload or type(file) is not UploadFile:
            self.guard.fail()
        if any(
            type(value) is not str
            for value in (
                link.tenant_id,
                link.app_id,
                link.node_execution_id,
                link.file_id,
                file.tenant_id,
                file.created_by,
                file.name,
                file.key,
                file.hash,
                file.extension,
                file.mime_type,
            )
        ):
            self.guard.fail()
        if type(file.created_by_role) is not CreatorUserRole:
            self.guard.fail()
        if (
            type(link) is not WorkflowNodeExecutionOffload
            or type(file) is not UploadFile
            or link.tenant_id != context.tenant_id
            or link.app_id != context.app_id
            or link.node_execution_id != row.id
            or type(link.type_) is not ExecutionOffLoadType
            or link.file_id != file.id
            or file.tenant_id != context.tenant_id
            or file.created_by != context.actor_id
            or file.created_by_role != CreatorUserRole.ACCOUNT
            or type(file.storage_type) is not StorageType
            or file.storage_type is not StorageType(dify_config.STORAGE_TYPE)
            or file.mime_type != "application/json"
            or file.extension != "json"
            or type(file.size) is not int
            or not 0 <= file.size <= _MAX_OFFLOAD
            or file.name != f"node_execution_{row.id}_{link.type_.value}.json"
            or type(file.key) is not str
            or type(file.hash) is not str
            or len(file.hash) != 64
            or any(ch not in "0123456789abcdef" for ch in file.hash)
        ):
            self.guard.fail()
        prefix = f"upload_files/{context.tenant_id}/"
        if not file.key.startswith(prefix) or not file.key.endswith(".json"):
            self.guard.fail()
        if str(UUID(file.key[len(prefix) : -5])) != file.key[len(prefix) : -5]:
            self.guard.fail()
        _identity(link.id)
        _identity(file.id)

    @staticmethod
    def _read_offload(file: UploadFile) -> bytes:
        stream = storage.load(file.key, stream=True)
        if type(stream) is not GeneratorType:
            raise NativeObservationError()
        chunks: list[bytes] = []
        total = 0
        digest = hashlib.sha3_256()
        with closing(stream):
            for chunk in stream:
                if type(chunk) is not bytes or not chunk or len(chunk) > file.size - total:
                    raise NativeObservationError()
                total += len(chunk)
                digest.update(chunk)
                chunks.append(chunk)
            if total != file.size or digest.hexdigest() != file.hash:
                raise NativeObservationError()
        return b"".join(chunks)

    def node_row(self, row: WorkflowNodeExecutionModel) -> WorkflowNodeExecutionModel:
        self._node_row(row)
        copy = WorkflowNodeExecutionModel()
        for column in inspect(WorkflowNodeExecutionModel).column_attrs:
            setattr(copy, column.key, deepcopy(getattr(row, column.key)))
        seen = set()
        for link in row.offload_data:
            if link.type_ in seen:
                self.guard.fail()
            seen.add(link.type_)
            file = link.file
            if file is None:
                self.guard.fail()
            self._file(row, link, file)
            with sensitive_http_telemetry(additional_emitters=_EMITTERS):
                content = self._read_offload(file)
                value = self._values(
                    _json(content.decode("utf-8")), process=link.type_ is ExecutionOffLoadType.PROCESS_DATA
                )
            setattr(copy, link.type_.value, json.dumps(value, sort_keys=True))
        # Detached diagnostic copy has the full checked values; conversion cannot load storage again.
        copy.offload_data = []
        return copy

    def to_db_run(self, repository: Any, execution: WorkflowExecution) -> WorkflowRun:
        with self.scope(repository):
            projected = self.project_run(execution)
            row = repository._ordinary_to_db_model(projected)
            if projected.outputs is None:
                # An ORM None is omitted on insert and activates WorkflowRun's
                # unmarked "{}" default. JSON null preserves absent diagnostics.
                row.outputs = "null"
            self.run_row(row)
            return row

    def to_db_node(self, repository: Any, execution: WorkflowNodeExecution) -> WorkflowNodeExecutionModel:
        with self.scope(repository):
            row = repository._ordinary_to_db_model(self.project_node(execution))
            self._node_row(row)
            return row

    def to_domain_run(self, repository: Any, row: WorkflowRun) -> WorkflowExecution:
        with self.scope(repository):
            return repository._ordinary_to_domain_model(self.run_row(row))

    def to_domain_node(self, repository: Any, row: WorkflowNodeExecutionModel) -> WorkflowNodeExecution:
        with self.scope(repository):
            self._run_for_nodes(repository)
            return repository._ordinary_to_domain_model(self.node_row(row))

    def get_run(self, repository: Any, run_id: str) -> WorkflowExecution:
        with self.scope(repository):
            if type(run_id) is not str or run_id != self._context.native_run_id:
                self.guard.fail()
            with repository._session_factory() as read:
                row = read.get(WorkflowRun, run_id)
                self.run_row(row)
                copied = WorkflowRun()
                for column in inspect(WorkflowRun).column_attrs:
                    setattr(copied, column.key, deepcopy(getattr(row, column.key)))
            result = repository._ordinary_to_domain_model(copied)
            self.check(repository)
            repository._execution_cache[copied.id] = copied
            return result

    def save_run(self, repository: Any, execution: WorkflowExecution) -> None:
        with self.scope(repository):
            row = self.to_db_run(repository, execution)
            with repository._session_factory() as read:
                previous = read.get(WorkflowRun, row.id)
            if previous is not None:
                self.run_row(previous)
                row.created_at = previous.created_at
            signature = self._columns(previous, WorkflowRun)
            self.check(repository)
            with repository._session_factory() as session:
                current = session.get(WorkflowRun, row.id, with_for_update=True)
                if self._columns(current, WorkflowRun) != signature:
                    raise NativeObservationError()
                session.merge(row)
                session.commit()
            self.check(repository)
            repository._execution_cache[row.id] = row

    @staticmethod
    def _existing(repository: Any, identity: str, *, session: Any = None):
        options = (
            selectinload(WorkflowNodeExecutionModel.offload_data).selectinload(WorkflowNodeExecutionOffload.file),
        )
        if session is not None:
            return session.get(WorkflowNodeExecutionModel, identity, options=options, with_for_update=True)
        with repository._session_factory() as read:
            return read.get(WorkflowNodeExecutionModel, identity, options=options)

    @staticmethod
    def _columns(row: Any, model: Any) -> Any:
        """Pure writer comparison of already qualified rows, no callback/private IO.

        A changed/malformed snapshot raises until the writer exits. Only the
        surrounding guard then latches/notifies. Never run a projection/guard
        callback while the SQL writer is held.
        """
        if row is None:
            return None
        if type(row) is not model:
            raise NativeObservationError()
        values = tuple(getattr(row, column.key) for column in inspect(model).column_attrs)
        allowed = (
            str,
            int,
            float,
            bool,
            datetime,
            ModelWorkflowType,
            WorkflowExecutionStatus,
            WorkflowNodeExecutionStatus,
            WorkflowRunTriggeredFrom,
            WorkflowNodeExecutionTriggeredFrom,
            CreatorUserRole,
            ExecutionOffLoadType,
            StorageType,
        )
        if any(value is not None and type(value) not in allowed for value in values):
            raise NativeObservationError()
        return values

    def _signature(self, row: WorkflowNodeExecutionModel | None) -> Any:
        if row is None:
            return None
        columns = self._columns(row, WorkflowNodeExecutionModel)
        links = []
        for link in row.offload_data:
            link_columns = self._columns(link, WorkflowNodeExecutionOffload)
            file = link.file
            if file is None:
                raise NativeObservationError()
            links.append((link_columns, self._columns(file, UploadFile)))
        # Existing relationship order is not an owner identity.
        return columns, frozenset(links)

    def _run_for_nodes(self, repository: Any) -> WorkflowRun:
        with repository._session_factory() as read:
            row = read.get(WorkflowRun, self._context.native_run_id)
        if row is None:
            self.guard.fail()
        self.run_row(row)
        return row

    def save_node(self, repository: Any, execution: WorkflowNodeExecution, *, data: bool = False) -> None:
        with self.scope(repository):
            row = self.to_db_node(repository, execution)
            self.persist_node(repository, row, data=data)

    def persist_node(self, repository: Any, row: WorkflowNodeExecutionModel, *, data: bool = False) -> None:
        with self.scope(repository):
            run = self._run_for_nodes(repository)
            run_signature = self._columns(run, WorkflowRun)
            cached = self.node_row(row)
            row = self.node_row(cached)
            previous = self._existing(repository, row.id)
            if previous is not None:
                self.node_row(previous)  # Complete old content, before any new offload or writer.
            signature = self._signature(previous)
            row.offload_data = []
            if data:
                for name in ("inputs", "outputs", "process_data"):
                    values = _json(getattr(row, name))
                    with sensitive_http_telemetry(additional_emitters=_EMITTERS):
                        result = repository._ordinary_truncate_and_upload(values, row.id, ExecutionOffLoadType(name))
                    if result is not None:
                        self._file(row, result.offload, result.file)
                        # Keep a canonical inline summary; complete checked retry evidence is offloaded.
                        inline = {key: value for key, value in values.items() if key != "__dify_retry_history"}
                        setattr(row, name, json.dumps(inline, sort_keys=True))
                        row.offload_data.append(result.offload)
            self.check(repository)
            with repository._session_factory() as session:
                current_run = session.get(WorkflowRun, self._context.native_run_id)
                if self._columns(current_run, WorkflowRun) != run_signature:
                    raise NativeObservationError()
                current = self._existing(repository, row.id, session=session)
                if self._signature(current) != signature:
                    raise NativeObservationError()
                session.merge(row)
                session.commit()
            self.check(repository)
            repository._node_execution_cache[row.node_execution_id] = cached

    def get_nodes(self, repository: Any, run_id: str, order: Any, triggered_from: Any):
        with self.scope(repository):
            if (
                run_id != self._context.native_run_id
                or triggered_from != WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
            ):
                self.guard.fail()
            self._run_for_nodes(repository)
            rows = repository._ordinary_get_db_models_by_workflow_run(run_id, order, triggered_from, cache=False)
            if len(rows) > 100_000:
                self.guard.fail()
            copies = [self.node_row(row) for row in rows]
            if len({row.id for row in copies}) != len(copies) or len({row.node_execution_id for row in copies}) != len(
                copies
            ):
                self.guard.fail()
            # Conversion is validated too, before the first ordinary cache write.
            for row in copies:
                repository._ordinary_to_domain_model(row)
            self.check(repository)
            repository._node_execution_cache.update({row.node_execution_id: row for row in copies})
            return copies
