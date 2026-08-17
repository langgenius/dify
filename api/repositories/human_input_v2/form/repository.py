"""SQLAlchemy Human Input v2 Form adapter.

The public operations own their transaction and eager-loading shape. Every
query carries the complete workspace/form/child owner predicates because domain
references are navigation values, not authorization tokens. ORM instances never
cross this boundary.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload, sessionmaker

from core.human_input_v2.approval import (
    DeliveryAttempt,
    DeliveryEndpointRef,
    FormCreation,
    FormDefinitionProjection,
    FormDeliveryProjection,
    FormRef,
    HumanInputForm,
    UploadCapability,
    UploadFileAssociation,
)
from core.human_input_v2.shared import TenantId
from models.human_input_v2 import (
    HumanInputV2Form,
    HumanInputV2FormApproverGrant,
    HumanInputV2FormDeliveryEndpoint,
    HumanInputV2FormUploadToken,
)
from models.model import UploadFile

from .mappers import (
    delivery_attempt_from_record,
    delivery_attempt_to_record,
    endpoint_from_record,
    endpoint_to_record,
    form_from_record,
    form_to_record,
    grant_from_record,
    grant_to_record,
    upload_capability_from_record,
    upload_capability_to_record,
    upload_file_from_record,
    upload_file_to_record,
)


class FormPersistenceError(RuntimeError):
    """A Form Core persistence operation could not preserve its contract."""


class SQLAlchemyFormRepository:
    """Transactional, operation-oriented adapter for one form aggregate boundary."""

    _session_maker: sessionmaker[Session]

    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    def create_form(self, creation: FormCreation) -> HumanInputForm:
        """Persist the complete form/grant/endpoint/attempt snapshot in one transaction."""

        try:
            with self._session_maker() as session, session.begin():
                session.add(form_to_record(creation.form))
                session.add_all(grant_to_record(grant) for grant in creation.form.grants)
                session.add_all(endpoint_to_record(endpoint) for endpoint in creation.endpoints)
                session.add_all(delivery_attempt_to_record(attempt) for attempt in creation.attempts)
                session.flush()
            return creation.form
        except SQLAlchemyError as error:
            raise FormPersistenceError("failed to create Human Input form snapshot") from error

    def load_for_lifecycle(self, form_ref: FormRef) -> HumanInputForm | None:
        """Load one form and its grant membership in a fixed two-query shape."""

        try:
            with self._session_maker() as session, session.begin():
                record = session.scalar(
                    select(HumanInputV2Form)
                    .options(selectinload(HumanInputV2Form.grants))
                    .where(
                        HumanInputV2Form.tenant_id == str(form_ref.tenant_id),
                        HumanInputV2Form.id == str(form_ref.form_id),
                    )
                )
                if record is None:
                    return None
                return form_from_record(record, tuple(record.grants))
        except SQLAlchemyError as error:
            raise FormPersistenceError("failed to load Human Input form lifecycle state") from error

    def load_delivery_projection(self, endpoint_ref: DeliveryEndpointRef) -> FormDeliveryProjection | None:
        """Load exactly one endpoint, grant, and form for delivery."""

        try:
            with self._session_maker() as session, session.begin():
                row = session.execute(self._endpoint_graph_statement(endpoint_ref)).one_or_none()
                if row is None:
                    return None
                endpoint_record, grant_record, form_record = row
                form = form_from_record(form_record, (grant_record,))
                return FormDeliveryProjection(
                    form_ref=form.ref,
                    grant=grant_from_record(grant_record),
                    endpoint=endpoint_from_record(endpoint_record),
                    resolved_form=form.resolved_form,
                )
        except SQLAlchemyError as error:
            raise FormPersistenceError("failed to load Human Input delivery projection") from error

    def load_definition_by_endpoint_token(
        self,
        *,
        tenant_id: TenantId,
        token_hash: str,
    ) -> FormDefinitionProjection | None:
        """Resolve a token to a read model without returning grant authority."""

        try:
            with self._session_maker() as session, session.begin():
                row = session.execute(
                    self._endpoint_graph_base().where(
                        HumanInputV2FormDeliveryEndpoint.tenant_id == str(tenant_id),
                        HumanInputV2FormDeliveryEndpoint.access_token_hash == token_hash,
                    )
                ).one_or_none()
                if row is None:
                    return None
                endpoint_record, grant_record, form_record = row
                form = form_from_record(form_record, (grant_record,))
                return FormDefinitionProjection(
                    form_ref=form.ref,
                    endpoint_ref=endpoint_from_record(endpoint_record).ref,
                    resolved_form=form.resolved_form,
                    display_in_ui=form.display_in_ui,
                    status=form.status,
                    node_timeout_at=form.node_timeout_at,
                    global_expires_at=form.global_expires_at,
                )
        except SQLAlchemyError as error:
            raise FormPersistenceError("failed to load Human Input token projection") from error

    def append_delivery_attempt(self, attempt: DeliveryAttempt) -> DeliveryAttempt:
        """Append one attempt after validating its full endpoint owner chain."""

        try:
            with self._session_maker() as session, session.begin():
                endpoint_record = self._load_endpoint_record(session, attempt.endpoint_ref)
                if endpoint_record is None:
                    raise ValueError("delivery attempt endpoint scope does not exist")
                record = delivery_attempt_to_record(attempt)
                session.add(record)
                session.flush()
                return delivery_attempt_from_record(record, endpoint_record)
        except ValueError:
            raise
        except SQLAlchemyError as error:
            raise FormPersistenceError("failed to append Human Input delivery attempt") from error

    def create_upload_capability(self, capability: UploadCapability) -> UploadCapability:
        """Persist one capability only when endpoint and app ownership match."""

        try:
            with self._session_maker() as session, session.begin():
                row = session.execute(self._endpoint_graph_statement(capability.endpoint_ref)).one_or_none()
                if row is None:
                    raise ValueError("upload capability endpoint scope does not exist")
                endpoint_record, _grant_record, form_record = row
                if form_record.app_id != str(capability.app_id):
                    raise ValueError("upload capability app scope does not match the form")
                record = upload_capability_to_record(capability)
                session.add(record)
                session.flush()
                return upload_capability_from_record(record, endpoint_record)
        except ValueError:
            raise
        except SQLAlchemyError as error:
            raise FormPersistenceError("failed to create Human Input upload capability") from error

    def associate_upload_file(self, association: UploadFileAssociation) -> UploadFileAssociation:
        """Persist a file only after resolving its token and UploadFile workspace owners."""

        capability_ref = association.capability_ref
        endpoint_ref = capability_ref.endpoint_ref
        try:
            with self._session_maker() as session, session.begin():
                row = session.execute(
                    select(HumanInputV2FormUploadToken, HumanInputV2FormDeliveryEndpoint)
                    .join(
                        HumanInputV2FormDeliveryEndpoint,
                        sa.and_(
                            HumanInputV2FormDeliveryEndpoint.id == HumanInputV2FormUploadToken.endpoint_id,
                            HumanInputV2FormDeliveryEndpoint.tenant_id == HumanInputV2FormUploadToken.tenant_id,
                            HumanInputV2FormDeliveryEndpoint.form_id == HumanInputV2FormUploadToken.form_id,
                        ),
                    )
                    .join(
                        HumanInputV2Form,
                        sa.and_(
                            HumanInputV2Form.id == HumanInputV2FormUploadToken.form_id,
                            HumanInputV2Form.tenant_id == HumanInputV2FormUploadToken.tenant_id,
                            HumanInputV2Form.app_id == HumanInputV2FormUploadToken.app_id,
                        ),
                    )
                    .where(
                        HumanInputV2FormUploadToken.id == str(capability_ref.capability_id),
                        HumanInputV2FormUploadToken.tenant_id == str(endpoint_ref.form_ref.tenant_id),
                        HumanInputV2FormUploadToken.app_id == str(capability_ref.app_id),
                        HumanInputV2FormUploadToken.form_id == str(endpoint_ref.form_ref.form_id),
                        HumanInputV2FormUploadToken.endpoint_id == str(endpoint_ref.endpoint_id),
                    )
                ).one_or_none()
                if row is None:
                    raise ValueError("upload file capability scope does not match")
                capability_record, endpoint_record = row
                upload_file_id = session.scalar(
                    select(UploadFile.id).where(
                        UploadFile.id == association.upload_file_id,
                        UploadFile.tenant_id == str(endpoint_ref.form_ref.tenant_id),
                    )
                )
                if upload_file_id is None:
                    raise ValueError("upload file workspace scope does not exist")
                record = upload_file_to_record(association)
                session.add(record)
                session.flush()
                return upload_file_from_record(record, capability_record, endpoint_record)
        except ValueError:
            raise
        except SQLAlchemyError as error:
            raise FormPersistenceError("failed to associate Human Input uploaded file") from error

    @staticmethod
    def _endpoint_graph_base() -> sa.Select[
        tuple[HumanInputV2FormDeliveryEndpoint, HumanInputV2FormApproverGrant, HumanInputV2Form]
    ]:
        return (
            select(HumanInputV2FormDeliveryEndpoint, HumanInputV2FormApproverGrant, HumanInputV2Form)
            .join(
                HumanInputV2FormApproverGrant,
                sa.and_(
                    HumanInputV2FormApproverGrant.id == HumanInputV2FormDeliveryEndpoint.approver_grant_id,
                    HumanInputV2FormApproverGrant.tenant_id == HumanInputV2FormDeliveryEndpoint.tenant_id,
                    HumanInputV2FormApproverGrant.form_id == HumanInputV2FormDeliveryEndpoint.form_id,
                ),
            )
            .join(
                HumanInputV2Form,
                sa.and_(
                    HumanInputV2Form.id == HumanInputV2FormDeliveryEndpoint.form_id,
                    HumanInputV2Form.tenant_id == HumanInputV2FormDeliveryEndpoint.tenant_id,
                ),
            )
        )

    @classmethod
    def _endpoint_graph_statement(
        cls,
        endpoint_ref: DeliveryEndpointRef,
    ) -> sa.Select[tuple[HumanInputV2FormDeliveryEndpoint, HumanInputV2FormApproverGrant, HumanInputV2Form]]:
        return cls._endpoint_graph_base().where(
            HumanInputV2FormDeliveryEndpoint.tenant_id == str(endpoint_ref.form_ref.tenant_id),
            HumanInputV2FormDeliveryEndpoint.form_id == str(endpoint_ref.form_ref.form_id),
            HumanInputV2FormDeliveryEndpoint.approver_grant_id == str(endpoint_ref.grant_ref.grant_id),
            HumanInputV2FormDeliveryEndpoint.id == str(endpoint_ref.endpoint_id),
        )

    @classmethod
    def _load_endpoint_record(
        cls,
        session: Session,
        endpoint_ref: DeliveryEndpointRef,
    ) -> HumanInputV2FormDeliveryEndpoint | None:
        row = session.execute(cls._endpoint_graph_statement(endpoint_ref)).one_or_none()
        return row[0] if row is not None else None
