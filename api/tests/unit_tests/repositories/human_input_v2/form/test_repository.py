"""Transaction and query-shape contracts for the SQLAlchemy Form adapter."""

from collections.abc import Iterator
from dataclasses import replace
from datetime import datetime, timedelta

import pytest
import sqlalchemy as sa
from pydantic import NaiveDatetime
from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.human_input import ButtonStyle
from core.human_input_v2 import MarkdownText, ResolvedForm, ResolvedFormAction
from core.human_input_v2.approval import (
    CanonicalSubjectKey,
    DeliveryAttempt,
    DeliveryAttemptData,
    DeliveryEndpoint,
    EmailAddressApprovalSubject,
    EmailEndpointPlan,
    EndpointAccessCapability,
    FormCreation,
    FormRef,
    FormSnapshotIdentifierFactory,
    HumanInputForm,
    MatchedRecipientSource,
    ProtectedRenderedEmailRequest,
    RecipientSourceKind,
    ResolvedApprovalPlan,
    ResolvedApprover,
    SubjectSnapshot,
    UploadCapability,
    UploadCapabilityRef,
    UploadFileAssociation,
)
from core.human_input_v2.delivery_runtime import ConfigurationSnapshotIdentity, DeliveryOutcome
from core.human_input_v2.entities import (
    HumanInputDeliveryAttemptStatus,
    HumanInputV2FormKind,
    HumanInputV2FormStatus,
)
from core.human_input_v2.shared import (
    AppId,
    ApproverGrantId,
    DeliveryAttemptId,
    DeliveryEndpointId,
    EmailProviderId,
    FormId,
    NormalizedEmail,
    TenantId,
    UploadCapabilityId,
    UploadFileAssociationId,
)
from extensions.storage.storage_type import StorageType
from models.enums import CreatorUserRole
from models.human_input_v2 import (
    FormDeliveryProviderResponse,
    HumanInputV2Form,
    HumanInputV2FormApproverGrant,
    HumanInputV2FormDeliveryAttempt,
    HumanInputV2FormDeliveryEndpoint,
    HumanInputV2FormUploadFile,
    HumanInputV2FormUploadToken,
)
from models.model import UploadFile
from repositories.human_input_v2.form.delivery_repository import SQLAlchemyDeliveryAttemptRepository
from repositories.human_input_v2.form.repository import FormPersistenceError, SQLAlchemyFormRepository

_NOW = datetime(2026, 7, 25, 8)
_TENANT_ID = TenantId("workspace-1")
_FORM_REF = FormRef(_TENANT_ID, FormId("form-1"))


class _SequentialIdentifierFactory(FormSnapshotIdentifierFactory):
    def __init__(self) -> None:
        self._grant_number = 0
        self._endpoint_number = 0

    def new_grant_id(self) -> ApproverGrantId:
        self._grant_number += 1
        return ApproverGrantId(f"grant-{self._grant_number}")

    def new_endpoint_id(self) -> DeliveryEndpointId:
        self._endpoint_number += 1
        return DeliveryEndpointId(f"endpoint-{self._endpoint_number}")


@pytest.fixture
def repository_context(
    sqlite_engine: Engine,
) -> Iterator[tuple[SQLAlchemyFormRepository, sessionmaker[Session]]]:
    tables = [
        UploadFile.__table__,
        HumanInputV2Form.__table__,
        HumanInputV2FormApproverGrant.__table__,
        HumanInputV2FormDeliveryEndpoint.__table__,
        HumanInputV2FormDeliveryAttempt.__table__,
        HumanInputV2FormUploadToken.__table__,
        HumanInputV2FormUploadFile.__table__,
    ]
    HumanInputV2Form.metadata.create_all(sqlite_engine, tables=tables)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    return SQLAlchemyFormRepository(session_maker), session_maker


def _resolved_form() -> ResolvedForm:
    return ResolvedForm(
        title="Review",
        blocks=(MarkdownText("Approve"),),
        user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
        legacy_form_content="Approve",
    )


def _approver(email: str, position: int, endpoints: tuple[str, ...]) -> ResolvedApprover:
    normalized_email = NormalizedEmail(email)
    return ResolvedApprover(
        subject=EmailAddressApprovalSubject(normalized_email),
        subject_key=CanonicalSubjectKey.for_email(normalized_email),
        matched_sources=(MatchedRecipientSource(RecipientSourceKind.ONE_TIME_EMAIL, position, email),),
        subject_snapshot=SubjectSnapshot(None, email),
        endpoints=tuple(EmailEndpointPlan(NormalizedEmail(address)) for address in endpoints),
    )


def _creation(*, duplicate_endpoint: bool = False) -> FormCreation:
    endpoint_addresses = (
        ("first@example.com", "first@example.com")
        if duplicate_endpoint
        else ("first@example.com", "backup@example.com")
    )
    plan = ResolvedApprovalPlan(
        approvers=(
            _approver("first@example.com", 0, endpoint_addresses),
            _approver("second@example.com", 1, ("second@example.com",)),
        ),
        rejected_recipients=(),
        failure_reason=None,
    )
    return HumanInputForm.create_from_plan(
        ref=_FORM_REF,
        app_id=AppId("app-1"),
        resolved_form=_resolved_form(),
        display_in_ui=True,
        node_timeout_at=_NOW + timedelta(hours=1),
        global_expires_at=_NOW + timedelta(hours=2),
        kind=HumanInputV2FormKind.RUNTIME,
        workflow_pause_id="pause-1",
        node_execution_id="node-execution-1",
        plan=plan,
        identifier_factory=_SequentialIdentifierFactory(),
        now=_NOW,
    )


def _attempt(endpoint: DeliveryEndpoint, *, attempt_id: str = "attempt-1") -> DeliveryAttempt:
    return DeliveryAttempt(
        id=DeliveryAttemptId(attempt_id),
        endpoint_ref=endpoint.ref,
        attempt_number=1,
        status=HumanInputDeliveryAttemptStatus.FAILED,
        scheduled_at=_NOW,
        started_at=_NOW,
        finished_at=_NOW,
        provider_message_id=None,
        failure_code="provider_rejected",
        failure_reason="Recipient unavailable",
        provider_response={"status": 400},
        created_at=_NOW,
        updated_at=_NOW,
    )


def _upload_file(*, file_id: str, tenant_id: str) -> UploadFile:
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"upload_files/{tenant_id}/{file_id}.txt",
        name=f"{file_id}.txt",
        size=1,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=_NOW,
        used=False,
    )
    upload_file.id = file_id
    return upload_file


def test_create_form_persists_form_grants_and_endpoints_in_one_transaction(repository_context) -> None:
    repository, session_maker = repository_context
    creation = _creation()

    created = repository.create_form(creation)

    assert created == creation.form
    with session_maker() as session:
        assert session.scalar(select(sa.func.count(HumanInputV2Form.id))) == 1
        assert session.scalar(select(sa.func.count(HumanInputV2FormApproverGrant.id))) == 2
        assert session.scalar(select(sa.func.count(HumanInputV2FormDeliveryEndpoint.id))) == 3


def test_create_form_and_delivery_attempt_lifecycle_are_atomic_and_cas_guarded(repository_context) -> None:
    repository, session_maker = repository_context
    creation = _creation()
    endpoint = creation.endpoints[0]
    data = DeliveryAttemptData(
        protected_request=ProtectedRenderedEmailRequest("ciphertext"),
        payload_fingerprint="a" * 64,
        idempotency_key="hitl-v2-key",
    )
    attempt = DeliveryAttempt(
        id=DeliveryAttemptId("attempt-queued"),
        endpoint_ref=endpoint.ref,
        attempt_number=1,
        status=HumanInputDeliveryAttemptStatus.QUEUED,
        scheduled_at=_NOW,
        started_at=None,
        finished_at=None,
        provider_message_id=None,
        failure_code=None,
        failure_reason=None,
        provider_response=data.to_mapping(),
        created_at=_NOW,
        updated_at=_NOW,
    )
    repository.create_form(replace(creation, attempts=(attempt,)))
    delivery_repository = SQLAlchemyDeliveryAttemptRepository(session_maker)

    assert delivery_repository.list_due_ids(now=_NOW, limit=10) == (DeliveryAttemptId("attempt-queued"),)
    claim = delivery_repository.claim(DeliveryAttemptId("attempt-queued"), now=_NOW)
    assert claim is not None
    assert delivery_repository.claim(DeliveryAttemptId("attempt-queued"), now=_NOW) is None
    bound = delivery_repository.bind_prepared(
        claim,
        snapshot=ConfigurationSnapshotIdentity(EmailProviderId("configuration-1"), _NOW),
        payload_fingerprint="a" * 64,
        now=_NOW,
    )
    assert bound is not None
    assert delivery_repository.complete(
        bound,
        outcome=DeliveryOutcome.accepted("message-1"),
        now=_NOW,
    )
    assert not delivery_repository.complete(
        bound,
        outcome=DeliveryOutcome.accepted("message-1"),
        now=_NOW,
    )

    with session_maker() as session:
        record = session.get(HumanInputV2FormDeliveryAttempt, "attempt-queued")
        assert record is not None
        assert record.status is HumanInputDeliveryAttemptStatus.SENT
        assert record.provider_message_id == "message-1"


def test_stale_sending_recovery_respects_the_provider_idempotency_horizon(repository_context) -> None:
    repository, session_maker = repository_context
    creation = _creation()
    data = DeliveryAttemptData(
        protected_request=ProtectedRenderedEmailRequest("ciphertext"),
        payload_fingerprint="a" * 64,
        idempotency_key="hitl-v2-key",
    )

    def sending_attempt(
        *,
        attempt_id: str,
        endpoint: DeliveryEndpoint,
        started_at: NaiveDatetime,
    ) -> DeliveryAttempt:
        return DeliveryAttempt(
            id=DeliveryAttemptId(attempt_id),
            endpoint_ref=endpoint.ref,
            attempt_number=1,
            status=HumanInputDeliveryAttemptStatus.SENDING,
            scheduled_at=started_at,
            started_at=started_at,
            finished_at=None,
            provider_message_id=None,
            failure_code=None,
            failure_reason=None,
            provider_response=data.to_mapping(),
            created_at=started_at,
            updated_at=_NOW - timedelta(minutes=10),
        )

    recoverable = sending_attempt(
        attempt_id="attempt-recoverable",
        endpoint=creation.endpoints[0],
        started_at=_NOW - timedelta(hours=1),
    )
    unknown = sending_attempt(
        attempt_id="attempt-unknown",
        endpoint=creation.endpoints[1],
        started_at=_NOW - timedelta(hours=24),
    )
    repository.create_form(replace(creation, attempts=(recoverable, unknown)))
    delivery_repository = SQLAlchemyDeliveryAttemptRepository(session_maker)

    recovered = delivery_repository.recover_stale(
        stale_before=_NOW - timedelta(minutes=5),
        idempotency_cutoff=_NOW - timedelta(hours=23),
        now=_NOW,
        limit=10,
    )

    assert recovered == 2
    with session_maker() as session:
        recoverable_record = session.get(HumanInputV2FormDeliveryAttempt, "attempt-recoverable")
        unknown_record = session.get(HumanInputV2FormDeliveryAttempt, "attempt-unknown")
        assert recoverable_record is not None
        assert recoverable_record.status is HumanInputDeliveryAttemptStatus.QUEUED
        assert unknown_record is not None
        assert unknown_record.status is HumanInputDeliveryAttemptStatus.FAILED
        assert unknown_record.failure_code == "delivery_outcome_unknown"


def test_claim_marks_a_malformed_durable_payload_as_failed(repository_context) -> None:
    repository, session_maker = repository_context
    creation = _creation()
    endpoint = creation.endpoints[0]
    attempt = DeliveryAttempt(
        id=DeliveryAttemptId("attempt-malformed"),
        endpoint_ref=endpoint.ref,
        attempt_number=1,
        status=HumanInputDeliveryAttemptStatus.QUEUED,
        scheduled_at=_NOW,
        started_at=None,
        finished_at=None,
        provider_message_id=None,
        failure_code=None,
        failure_reason=None,
        provider_response={"legacy": True},
        created_at=_NOW,
        updated_at=_NOW,
    )
    repository.create_form(replace(creation, attempts=(attempt,)))
    delivery_repository = SQLAlchemyDeliveryAttemptRepository(session_maker)

    assert delivery_repository.claim(attempt.id, now=_NOW) is None

    with session_maker() as session:
        record = session.get_one(HumanInputV2FormDeliveryAttempt, str(attempt.id))
        assert record.status is HumanInputDeliveryAttemptStatus.FAILED
        assert record.failure_code == "delivery_payload_unavailable"
        assert record.provider_response == FormDeliveryProviderResponse({"legacy": True})


def test_create_form_rolls_back_every_record_when_one_endpoint_conflicts(repository_context) -> None:
    repository, session_maker = repository_context

    with pytest.raises(FormPersistenceError):
        repository.create_form(_creation(duplicate_endpoint=True))

    with session_maker() as session:
        assert session.scalar(select(sa.func.count(HumanInputV2Form.id))) == 0
        assert session.scalar(select(sa.func.count(HumanInputV2FormApproverGrant.id))) == 0
        assert session.scalar(select(sa.func.count(HumanInputV2FormDeliveryEndpoint.id))) == 0


def test_lifecycle_load_is_owner_scoped_and_has_a_fixed_two_query_shape(repository_context) -> None:
    repository, session_maker = repository_context
    repository.create_form(_creation())
    statements: list[str] = []

    def record_statement(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    engine = session_maker.kw["bind"]
    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        loaded = repository.load_for_lifecycle(_FORM_REF)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)

    assert loaded is not None
    assert len(loaded.grants) == 2
    assert len(statements) == 2
    assert repository.load_for_lifecycle(FormRef(TenantId("other-workspace"), _FORM_REF.form_id)) is None


def test_delivery_attempt_is_append_only_and_does_not_change_form_status(repository_context) -> None:
    repository, session_maker = repository_context
    creation = _creation()
    repository.create_form(creation)
    endpoint = creation.endpoints[0]
    attempt = _attempt(endpoint)

    assert repository.append_delivery_attempt(attempt) == attempt

    with session_maker() as session:
        assert session.scalar(select(sa.func.count(HumanInputV2FormDeliveryAttempt.id))) == 1
        assert session.get_one(HumanInputV2Form, str(_FORM_REF.form_id)).status is HumanInputV2FormStatus.WAITING


def test_endpoint_token_read_projection_does_not_return_a_grant_or_actor(repository_context) -> None:
    repository, session_maker = repository_context
    creation = _creation()
    endpoint = creation.endpoints[0]
    endpoint_with_token = DeliveryEndpoint(
        ref=endpoint.ref,
        configuration=endpoint.configuration,
        address_hash=endpoint.address_hash,
        access_capability=EndpointAccessCapability(endpoint.ref, "a" * 64),
        created_at=endpoint.created_at,
        updated_at=endpoint.updated_at,
    )
    repository.create_form(FormCreation(creation.form, (endpoint_with_token, *creation.endpoints[1:])))

    projection = repository.load_definition_by_endpoint_token(tenant_id=_TENANT_ID, token_hash="a" * 64)

    assert projection is not None
    assert projection.endpoint_ref == endpoint.ref
    assert projection.resolved_form == _resolved_form()
    assert projection.display_in_ui is True
    assert not hasattr(projection, "grant")
    assert not hasattr(projection, "actor")
    assert (
        repository.load_definition_by_endpoint_token(tenant_id=TenantId("other-workspace"), token_hash="a" * 64) is None
    )
    assert repository.load_definition_by_endpoint_token(tenant_id=_TENANT_ID, token_hash="b" * 64) is None
    with session_maker() as session:
        endpoint_record = session.get_one(HumanInputV2FormDeliveryEndpoint, str(endpoint.id))
        with pytest.raises(sa.exc.InvalidRequestError):
            _ = endpoint_record.approver_grant


def test_upload_file_association_requires_matching_form_endpoint_app_and_token_scope(repository_context) -> None:
    repository, session_maker = repository_context
    creation = _creation()
    repository.create_form(creation)
    endpoint = creation.endpoints[0]
    capability = UploadCapability(
        id=UploadCapabilityId("upload-capability-1"),
        endpoint_ref=endpoint.ref,
        app_id=AppId("app-1"),
        token_hash="b" * 64,
        created_at=_NOW,
        updated_at=_NOW,
    )
    repository.create_upload_capability(capability)
    with session_maker() as session, session.begin():
        session.add_all(
            [
                _upload_file(file_id="file-1", tenant_id="workspace-1"),
                _upload_file(file_id="file-2", tenant_id="workspace-1"),
            ]
        )
    association = UploadFileAssociation(
        id=UploadFileAssociationId("upload-association-1"),
        capability_ref=capability.ref,
        upload_file_id="file-1",
        created_at=_NOW,
        updated_at=_NOW,
    )
    wrong_endpoint_ref = creation.endpoints[1].ref
    cross_scoped = UploadFileAssociation(
        id=UploadFileAssociationId("upload-association-2"),
        capability_ref=UploadCapabilityRef(wrong_endpoint_ref, capability.id, capability.app_id),
        upload_file_id="file-2",
        created_at=_NOW,
        updated_at=_NOW,
    )

    assert repository.associate_upload_file(association) == association
    with pytest.raises(ValueError, match="scope"):
        repository.associate_upload_file(cross_scoped)

    with session_maker() as session:
        records = session.scalars(select(HumanInputV2FormUploadFile)).all()
        assert [(record.form_id, record.endpoint_id, record.upload_token_id) for record in records] == [
            ("form-1", "endpoint-1", "upload-capability-1")
        ]


@pytest.mark.parametrize(
    ("upload_file_id", "seed_tenant_id"),
    [
        ("missing-file", None),
        ("cross-tenant-file", "workspace-2"),
    ],
)
def test_upload_file_association_fails_closed_without_inserting_a_row(
    repository_context,
    upload_file_id: str,
    seed_tenant_id: str | None,
) -> None:
    repository, session_maker = repository_context
    creation = _creation()
    repository.create_form(creation)
    capability = UploadCapability(
        id=UploadCapabilityId("upload-capability-1"),
        endpoint_ref=creation.endpoints[0].ref,
        app_id=creation.form.app_id,
        token_hash="c" * 64,
        created_at=_NOW,
        updated_at=_NOW,
    )
    repository.create_upload_capability(capability)
    if seed_tenant_id is not None:
        with session_maker() as session, session.begin():
            session.add(_upload_file(file_id=upload_file_id, tenant_id=seed_tenant_id))
    association = UploadFileAssociation(
        id=UploadFileAssociationId("upload-association-1"),
        capability_ref=capability.ref,
        upload_file_id=upload_file_id,
        created_at=_NOW,
        updated_at=_NOW,
    )

    with pytest.raises(ValueError, match="workspace scope does not exist"):
        repository.associate_upload_file(association)

    with session_maker() as session:
        assert session.scalar(select(sa.func.count(HumanInputV2FormUploadFile.id))) == 0


def test_delivery_projection_is_scoped_to_the_complete_endpoint_owner_chain(repository_context) -> None:
    repository, _session_maker = repository_context
    creation = _creation()
    repository.create_form(creation)
    endpoint = creation.endpoints[0]

    projection = repository.load_delivery_projection(endpoint.ref)

    assert projection is not None
    assert projection.form_ref == creation.form.ref
    assert projection.grant.ref == endpoint.grant_ref
    assert projection.endpoint == endpoint
    assert (
        repository.load_delivery_projection(
            FormRef(TenantId("other-workspace"), endpoint.ref.form_ref.form_id)
            .grant(endpoint.grant_ref.grant_id)
            .endpoint(endpoint.id)
        )
        is None
    )


def test_append_delivery_attempt_requires_an_existing_endpoint_scope(repository_context) -> None:
    repository, _session_maker = repository_context
    creation = _creation()
    repository.create_form(creation)
    endpoint = creation.endpoints[0]
    missing_endpoint = DeliveryEndpoint(
        ref=endpoint.grant_ref.endpoint(DeliveryEndpointId("missing-endpoint")),
        configuration=endpoint.configuration,
        address_hash=endpoint.address_hash,
        access_capability=None,
        created_at=_NOW,
        updated_at=_NOW,
    )

    with pytest.raises(ValueError, match="endpoint scope"):
        repository.append_delivery_attempt(_attempt(missing_endpoint))


def test_upload_capability_requires_an_existing_endpoint_and_matching_app(repository_context) -> None:
    repository, _session_maker = repository_context
    creation = _creation()
    repository.create_form(creation)
    endpoint = creation.endpoints[0]
    missing_endpoint_ref = endpoint.grant_ref.endpoint(DeliveryEndpointId("missing-endpoint"))
    missing_endpoint_capability = UploadCapability(
        id=UploadCapabilityId("upload-capability-missing"),
        endpoint_ref=missing_endpoint_ref,
        app_id=creation.form.app_id,
        token_hash="c" * 64,
        created_at=_NOW,
        updated_at=_NOW,
    )
    wrong_app_capability = UploadCapability(
        id=UploadCapabilityId("upload-capability-wrong-app"),
        endpoint_ref=endpoint.ref,
        app_id=AppId("app-2"),
        token_hash="d" * 64,
        created_at=_NOW,
        updated_at=_NOW,
    )

    with pytest.raises(ValueError, match="endpoint scope"):
        repository.create_upload_capability(missing_endpoint_capability)
    with pytest.raises(ValueError, match="app scope"):
        repository.create_upload_capability(wrong_app_capability)


def test_append_operations_translate_unique_constraint_failures(repository_context) -> None:
    repository, session_maker = repository_context
    creation = _creation()
    repository.create_form(creation)
    endpoint = creation.endpoints[0]
    attempt = _attempt(endpoint)
    capability = UploadCapability(
        id=UploadCapabilityId("upload-capability-1"),
        endpoint_ref=endpoint.ref,
        app_id=creation.form.app_id,
        token_hash="e" * 64,
        created_at=_NOW,
        updated_at=_NOW,
    )
    association = UploadFileAssociation(
        id=UploadFileAssociationId("upload-association-1"),
        capability_ref=capability.ref,
        upload_file_id="file-1",
        created_at=_NOW,
        updated_at=_NOW,
    )

    with session_maker() as session, session.begin():
        session.add(_upload_file(file_id="file-1", tenant_id="workspace-1"))

    repository.append_delivery_attempt(attempt)
    repository.create_upload_capability(capability)
    repository.associate_upload_file(association)

    with pytest.raises(FormPersistenceError):
        repository.append_delivery_attempt(attempt)
    with pytest.raises(FormPersistenceError):
        repository.create_upload_capability(capability)
    with pytest.raises(FormPersistenceError):
        repository.associate_upload_file(
            UploadFileAssociation(
                id=UploadFileAssociationId("upload-association-2"),
                capability_ref=capability.ref,
                upload_file_id=association.upload_file_id,
                created_at=_NOW,
                updated_at=_NOW,
            )
        )
