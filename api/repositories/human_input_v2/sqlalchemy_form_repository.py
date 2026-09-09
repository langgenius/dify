"""Owner-bound persistence for Human Input v2 forms."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Self, override

import sqlalchemy as sa
from pydantic import BaseModel, ConfigDict, Json, JsonValue, NaiveDatetime, TypeAdapter, model_validator
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from core.human_input_v2.resolved_form import ResolvedForm
from core.human_input_v2.shared.values import RecipientId, TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from graphon.variables.segments import Segment, SerializableSegment
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.human_input_v2 import HumanInputForm

from .form_repository import Form, FormCreateParams, FormRepository, FormSubmission, FormSubmissionFailure

_RAW_INPUTS = TypeAdapter(Mapping[str, JsonValue])
_NORMALIZED_INPUTS = TypeAdapter(Mapping[str, Segment])
_EXECUTION_KEY = ("tenant_id", "app_id", "workflow_run_id", "node_execution_id")


class _StoredForm(BaseModel):
    """Validate database values once before constructing a repository snapshot."""

    model_config = ConfigDict(from_attributes=True, strict=True)

    id: str
    tenant_id: TenantId
    app_id: str
    workflow_run_id: str | None
    node_execution_id: str | None
    form_kind: HumanInputFormKind
    status: HumanInputFormStatus
    resolved_form: ResolvedForm
    created_at: NaiveDatetime
    updated_at: NaiveDatetime
    expiration_time: NaiveDatetime
    global_timeout_deadline: NaiveDatetime
    submitted_at: NaiveDatetime | None
    submitted_by_recipient_id: RecipientId | None
    selected_action_id: str | None
    raw_submission_inputs: Json[dict[str, JsonValue]] | None
    normalized_submission_data: Json[dict[str, SerializableSegment]] | None

    @model_validator(mode="after")
    def validate_facts(self) -> Self:
        execution_ids = (self.workflow_run_id, self.node_execution_id)
        if self.form_kind == HumanInputFormKind.RUNTIME:
            if any(identifier is None for identifier in execution_ids):
                raise ValueError("Runtime forms require both execution IDs")
        elif any(identifier is not None for identifier in execution_ids):
            raise ValueError("Delivery-test forms must not have execution IDs")
        submission_fields = (
            self.submitted_at,
            self.submitted_by_recipient_id,
            self.selected_action_id,
            self.raw_submission_inputs,
            self.normalized_submission_data,
        )
        if self.status == HumanInputFormStatus.SUBMITTED:
            if any(value is None for value in submission_fields):
                raise ValueError("Submitted forms require a complete submission")
        elif any(value is not None for value in submission_fields):
            raise ValueError("Only submitted forms may contain submission data")
        return self

    def to_form(self) -> Form:
        submission = None
        if self.status == HumanInputFormStatus.SUBMITTED:
            # Validation above establishes this all-or-none boundary contract.
            assert self.submitted_at is not None
            assert self.submitted_by_recipient_id is not None
            assert self.selected_action_id is not None
            assert self.raw_submission_inputs is not None
            assert self.normalized_submission_data is not None
            submission = FormSubmission(
                submitted_at=self.submitted_at,
                submitted_by_recipient_id=self.submitted_by_recipient_id,
                selected_action_id=self.selected_action_id,
                raw_submission_inputs=self.raw_submission_inputs,
                normalized_submission_data=self.normalized_submission_data,
            )
        return Form(
            id=self.id,
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            workflow_run_id=self.workflow_run_id,
            node_execution_id=self.node_execution_id,
            form_kind=self.form_kind,
            status=self.status,
            resolved_form=self.resolved_form,
            created_at=self.created_at,
            updated_at=self.updated_at,
            expiration_time=self.expiration_time,
            global_timeout_deadline=self.global_timeout_deadline,
            submission=submission,
        )


def _form_from_record(record: HumanInputForm) -> Form:
    return _StoredForm.model_validate(record).to_form()


def _terminal_submission_failure(status: HumanInputFormStatus) -> FormSubmissionFailure | None:
    match status:
        case HumanInputFormStatus.SUBMITTED:
            return FormSubmissionFailure.ALREADY_SUBMITTED
        case HumanInputFormStatus.EXPIRED:
            return FormSubmissionFailure.GLOBAL_TIMEOUT
        case HumanInputFormStatus.TIMEOUT:
            return FormSubmissionFailure.FORM_EXPIRED
        case HumanInputFormStatus.WAITING:
            return None


class SQLAlchemyFormRepository(FormRepository):
    """Flush form changes into a caller-owned transaction without committing it."""

    def __init__(self, session: Session, tenant_id: TenantId, app_id: str) -> None:
        self._session = session
        self._tenant_id = tenant_id
        self._app_id = app_id

    def _query(self) -> sa.Select[tuple[HumanInputForm]]:
        return (
            sa.select(HumanInputForm)
            .where(
                HumanInputForm.tenant_id == self._tenant_id,
                HumanInputForm.app_id == self._app_id,
            )
            .execution_options(autoflush=False, populate_existing=True)
        )

    @override
    def get_form(self, workflow_run_id: str, node_execution_id: str) -> Form | None:
        record = self._session.scalar(
            self._query().where(
                HumanInputForm.form_kind == HumanInputFormKind.RUNTIME,
                HumanInputForm.workflow_run_id == workflow_run_id,
                HumanInputForm.node_execution_id == node_execution_id,
            )
        )
        return _form_from_record(record) if record is not None else None

    @override
    def get_form_by_id(self, form_id: str) -> Form | None:
        record = self._session.scalar(self._query().where(HumanInputForm.id == form_id))
        return _form_from_record(record) if record is not None else None

    @override
    def create_form(self, params: FormCreateParams) -> Form:
        execution_ids = (params.workflow_run_id, params.node_execution_id)
        if params.form_kind == HumanInputFormKind.RUNTIME:
            if any(identifier is None for identifier in execution_ids):
                raise ValueError("Runtime forms require both execution IDs")
        elif any(identifier is not None for identifier in execution_ids):
            raise ValueError("Delivery-test forms must not have execution IDs")

        form_id = str(uuidv7())
        now = naive_utc_now()
        values = {
            "id": form_id,
            "tenant_id": self._tenant_id,
            "app_id": self._app_id,
            "workflow_run_id": params.workflow_run_id,
            "node_execution_id": params.node_execution_id,
            "form_kind": params.form_kind,
            "status": HumanInputFormStatus.WAITING,
            "resolved_form": params.resolved_form,
            "expiration_time": params.expiration_time,
            "global_timeout_deadline": params.global_timeout_deadline,
            "created_at": now,
            "updated_at": now,
            "submitted_at": None,
            "submitted_by_recipient_id": None,
            "selected_action_id": None,
            "raw_submission_inputs": None,
            "normalized_submission_data": None,
        }
        statement: sa.Insert
        if params.form_kind == HumanInputFormKind.DELIVERY_TEST:
            statement = sa.insert(HumanInputForm).values(values)
        else:
            # Insert first: the unique execution key arbitrates concurrent creation
            # without flushing unrelated objects or rolling back the caller's work.
            dialect = self._session.get_bind().dialect.name
            if dialect == "postgresql":
                statement = (
                    postgresql_insert(HumanInputForm)
                    .values(values)
                    .on_conflict_do_nothing(
                        constraint="hitlv2_forms_execution_uq",
                    )
                )
            elif dialect == "sqlite":
                statement = (
                    sqlite_insert(HumanInputForm)
                    .values(values)
                    .on_conflict_do_nothing(
                        index_elements=_EXECUTION_KEY,
                    )
                )
            elif dialect == "mysql":
                statement = mysql_insert(HumanInputForm).values(values).on_duplicate_key_update(id=HumanInputForm.id)
            else:
                raise NotImplementedError(f"Unsupported form persistence dialect: {dialect}")
        self._session.execute(statement.execution_options(autoflush=False))
        query = self._query()
        if params.form_kind == HumanInputFormKind.RUNTIME:
            query = query.where(
                HumanInputForm.form_kind == HumanInputFormKind.RUNTIME,
                HumanInputForm.workflow_run_id == params.workflow_run_id,
                HumanInputForm.node_execution_id == params.node_execution_id,
            )
        else:
            query = query.where(HumanInputForm.id == form_id)
        # A locking read also sees the concurrent winner under MySQL REPEATABLE READ.
        record = self._session.scalars(query.with_for_update()).one()
        return _form_from_record(record)

    def _lock_form(self, form_id: str) -> HumanInputForm | None:
        if self._session.get_bind().dialect.name == "sqlite":
            # SQLite ignores FOR UPDATE. Acquire its write lock without changing
            # any facts before reading the form and the database clock.
            self._session.execute(
                sa.update(HumanInputForm)
                .where(
                    HumanInputForm.tenant_id == self._tenant_id,
                    HumanInputForm.app_id == self._app_id,
                    HumanInputForm.id == form_id,
                )
                .values(id=HumanInputForm.id, updated_at=HumanInputForm.updated_at)
                .execution_options(
                    autoflush=False,
                    synchronize_session=False,
                )
            )
        return self._session.scalar(self._query().where(HumanInputForm.id == form_id).with_for_update())

    def _database_now(self) -> datetime:
        dialect = self._session.get_bind().dialect.name
        if dialect == "postgresql":
            # CURRENT_TIMESTAMP is fixed at transaction start on PostgreSQL.
            expression = sa.func.timezone("UTC", sa.func.clock_timestamp(), type_=sa.DateTime())
        elif dialect == "mysql":
            expression = sa.func.utc_timestamp(6, type_=sa.DateTime())
        elif dialect == "sqlite":
            expression = sa.func.strftime("%Y-%m-%d %H:%M:%f", "now", type_=sa.DateTime())
        else:
            raise NotImplementedError(f"Unsupported form persistence dialect: {dialect}")
        return self._session.scalars(sa.select(expression).execution_options(autoflush=False)).one()

    @override
    def submit_form(
        self,
        form_id: str,
        *,
        submitted_by_recipient_id: RecipientId,
        selected_action_id: str,
        raw_submission_inputs: Mapping[str, JsonValue],
        normalized_submission_data: Mapping[str, Segment],
    ) -> Form | FormSubmissionFailure:
        record = self._lock_form(form_id)
        if record is None:
            return FormSubmissionFailure.NOT_FOUND
        form = _form_from_record(record)
        failure = _terminal_submission_failure(form.status)
        if failure is not None:
            return failure
        now = self._database_now()
        if now >= form.global_timeout_deadline:
            return FormSubmissionFailure.GLOBAL_TIMEOUT
        if now >= form.expiration_time:
            return FormSubmissionFailure.FORM_EXPIRED
        raw_inputs = _RAW_INPUTS.dump_json(raw_submission_inputs, warnings="error").decode()
        normalized_inputs = _NORMALIZED_INPUTS.dump_json(
            normalized_submission_data,
            serialize_as_any=True,
            warnings="error",
        ).decode()
        record.status = HumanInputFormStatus.SUBMITTED
        record.submitted_at = now
        record.submitted_by_recipient_id = submitted_by_recipient_id
        record.selected_action_id = selected_action_id
        record.raw_submission_inputs = raw_inputs
        record.normalized_submission_data = normalized_inputs
        record.updated_at = now
        self._session.flush([record])
        return _form_from_record(record)

    @override
    def list_expired_forms(
        self,
        *,
        now: NaiveDatetime,
        limit: int,
        after_form_id: str | None = None,
    ) -> tuple[Form, ...]:
        if limit <= 0:
            raise ValueError("Expired form scan limit must be positive")
        query = self._query().where(
            HumanInputForm.form_kind == HumanInputFormKind.RUNTIME,
            HumanInputForm.status == HumanInputFormStatus.WAITING,
            sa.or_(HumanInputForm.expiration_time <= now, HumanInputForm.global_timeout_deadline <= now),
        )
        if after_form_id is not None:
            query = query.where(HumanInputForm.id > after_form_id)
        return tuple(
            _form_from_record(record)
            for record in self._session.scalars(
                query.order_by(HumanInputForm.id).limit(limit),
            )
        )

    @override
    def expire_form(self, form_id: str) -> Form | None:
        record = self._lock_form(form_id)
        if record is None:
            return None
        form = _form_from_record(record)
        if form.status != HumanInputFormStatus.WAITING:
            return form
        now = self._database_now()
        if now >= form.global_timeout_deadline:
            record.status = HumanInputFormStatus.EXPIRED
        elif now >= form.expiration_time:
            record.status = HumanInputFormStatus.TIMEOUT
        else:
            return form
        record.updated_at = now
        self._session.flush([record])
        return _form_from_record(record)
