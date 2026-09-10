"""Persistence acceptance contracts for recipients, deliveries, and send history."""

from __future__ import annotations

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from sqlite3 import Connection as SQLiteConnection
from threading import Barrier, Event
from uuid import uuid4

import pytest
import sqlalchemy as sa
from pydantic import JsonValue, ValidationError
from sqlalchemy import event
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import IntegrityError, MultipleResultsFound, OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.pool import ConnectionPoolEntry

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.shared.values import ContactId, NormalizedEmail, RecipientId, TenantId
from core.workflow.nodes.human_input_v2.entities import (
    AllWorkspaceContacts,
    Contact,
    DynamicEmail,
    Initiator,
    OnetimeEmail,
)
from models.human_input_v2 import (
    HumanInputDelivery,
    HumanInputDeliveryAttempt,
    HumanInputRecipient,
    RecipientSnapshot,
    RecipientSources,
    RecipientSubjectType,
)
from repositories.human_input_v2.delivery_attempt_repository import DeliveryAttemptCreateParams, DeliveryStatus
from repositories.human_input_v2.delivery_repository import (
    DeliveryCreateParams,
    EmailTargetSnapshot,
    IMUserTargetSnapshot,
    InitiatorSnapshot,
    SubmissionAuthType,
    TargetSnapshot,
)
from repositories.human_input_v2.recipient_repository import (
    ContactRecipientSubject,
    EmailRecipientSubject,
    EndUserRecipientSubject,
    Recipient,
    RecipientCreateParams,
)
from repositories.human_input_v2.sqlalchemy_delivery_attempt_repository import SQLAlchemyDeliveryAttemptRepository
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_recipient_repository import SQLAlchemyRecipientRepository

_TENANT = TenantId("00000000-0000-0000-0000-000000000001")
_FORM = "00000000-0000-0000-0000-000000000002"
_CONTACT = ContactId("00000000-0000-0000-0000-000000000003")
_HASH = "a" * 64


@pytest.fixture
def delivery_engine(tmp_path: Path) -> Iterator[Engine]:
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'deliveries.sqlite3'}", connect_args={"timeout": 10})

    # Use real outer transactions, including before the first SAVEPOINT.
    @event.listens_for(engine, "connect")
    def configure_transaction(connection: SQLiteConnection, _record: ConnectionPoolEntry) -> None:
        connection.isolation_level = None

    @event.listens_for(engine, "begin")
    def begin_transaction(connection: Connection) -> None:
        connection.exec_driver_sql("BEGIN")

    for model in (HumanInputRecipient, HumanInputDelivery, HumanInputDeliveryAttempt):
        model.metadata.tables[model.__tablename__].create(engine)
    try:
        yield engine
    finally:
        engine.dispose()


def _recipient_params() -> RecipientCreateParams:
    return RecipientCreateParams(
        subject=ContactRecipientSubject(_CONTACT),
        sources=(Contact(contact_id=_CONTACT), AllWorkspaceContacts()),
        name="Original Contact",
    )


def _delivery_params(recipient_id: RecipientId) -> DeliveryCreateParams:
    return DeliveryCreateParams(
        recipient_id=recipient_id,
        token_hash=_HASH,
        auth_type=SubmissionAuthType.EMAIL_OTP,
        target_snapshot=EmailTargetSnapshot(email_address="shared@example.com"),
    )


def _attempt_params() -> DeliveryAttemptCreateParams:
    return DeliveryAttemptCreateParams(
        status=DeliveryStatus.FAILED,
        error_message="Provider timed out",
        response={"code": 504, "retryable": True, "metadata": {"request_id": "first"}, "receipt": None},
    )


def _create_recipient(engine: Engine, params: RecipientCreateParams | None = None) -> Recipient:
    with Session(engine) as session, session.begin():
        return SQLAlchemyRecipientRepository(session, _TENANT, _FORM).create_recipients(
            [params or _recipient_params()]
        )[0]


def test_recipients_round_trip_all_subjects_and_provenance_without_resolution(delivery_engine: Engine) -> None:
    email_sources = (
        DynamicEmail(selector=["upstream", "emails"]),
        OnetimeEmail(email="shared@example.com"),
        Initiator(),
    )
    params = [
        _recipient_params(),
        RecipientCreateParams(EmailRecipientSubject(NormalizedEmail("shared@example.com")), email_sources, None),
        RecipientCreateParams(EndUserRecipientSubject(_CONTACT), (Initiator(),), None),
        replace(_recipient_params(), subject=ContactRecipientSubject(ContactId(str(uuid4())))),
    ]
    with Session(delivery_engine) as session, session.begin():
        repo = SQLAlchemyRecipientRepository(session, _TENANT, _FORM)
        recipients = repo.create_recipients(params)
        assert [item.subject for item in recipients] == [item.subject for item in params]
        assert len({item.id for item in recipients}) == len(params)
        assert repo.create_recipients([]) == ()
    with Session(delivery_engine) as session:
        repo = SQLAlchemyRecipientRepository(session, _TENANT, _FORM)
        assert repo.list_recipients() == tuple(sorted(recipients, key=lambda item: item.id))
        for recipient, param in zip(recipients, params, strict=True):
            assert repo.get_recipient(recipient.id) == recipient
            assert recipient.sources == param.sources
            assert recipient.name == param.name
            assert recipient.created_at.tzinfo is None
            assert recipient.updated_at == recipient.created_at
        assert repo.get_recipient(RecipientId(str(uuid4()))) is None


def test_retries_preserve_existing_ids_names_sources_and_timestamps(delivery_engine: Engine) -> None:
    original = _create_recipient(delivery_engine)
    historical_id = RecipientId(str(uuid4()))
    with delivery_engine.begin() as connection:
        connection.execute(
            sa.update(HumanInputRecipient)
            .where(HumanInputRecipient.id == original.id)
            .values(id=historical_id, updated_at=original.updated_at)
        )
    historical = replace(original, id=historical_id)
    extra = replace(_recipient_params(), subject=EndUserRecipientSubject(str(uuid4())), name=None)
    with Session(delivery_engine) as session, session.begin():
        repo = SQLAlchemyRecipientRepository(session, _TENANT, _FORM)
        retry = replace(_recipient_params(), sources=(Initiator(),), name="Changed Contact")
        created = repo.create_recipients([extra, retry])
        assert created[1] == historical
        assert repo.create_recipients([retry]) == (historical,)
        assert len(repo.list_recipients()) == 2


def test_caller_retries_concurrent_recipient_initialization(delivery_engine: Engine) -> None:
    barrier = Barrier(2)
    committed = Event()
    second = replace(_recipient_params(), subject=EndUserRecipientSubject(str(uuid4())), name=None)

    def create(reverse: bool) -> tuple[Recipient, ...]:
        params = [replace(_recipient_params(), name=f"Writer {reverse}"), second]
        if reverse:
            params.reverse()
        barrier.wait(timeout=5)
        try:
            with Session(delivery_engine) as session, session.begin():
                recipients = SQLAlchemyRecipientRepository(session, _TENANT, _FORM).create_recipients(params)
        except (IntegrityError, OperationalError) as error:
            # SQLite may reject a concurrent read-to-write upgrade before the
            # unique constraint is checked. Retry only after the winner commits.
            if isinstance(error, OperationalError) and "database is locked" not in str(error):
                raise
            assert committed.wait(timeout=10)
            with Session(delivery_engine) as session, session.begin():
                return SQLAlchemyRecipientRepository(session, _TENANT, _FORM).create_recipients(params)
        committed.set()
        return recipients

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(create, False)
        second_result = executor.submit(create, True)
        forward = first.result(timeout=15)
        backward = second_result.result(timeout=15)
    assert forward == tuple(reversed(backward))
    with Session(delivery_engine) as session:
        assert len(SQLAlchemyRecipientRepository(session, _TENANT, _FORM).list_recipients()) == 2


@pytest.mark.parametrize("tenant", [_TENANT, TenantId("00000000-0000-0000-0000-000000000004")])
def test_database_rejects_duplicate_subjects_in_the_same_form(delivery_engine: Engine, tenant: TenantId) -> None:
    original = _create_recipient(delivery_engine)
    with Session(delivery_engine) as session:
        session.add(
            HumanInputRecipient(
                tenant_id=tenant,
                form_id=_FORM,
                subject_type=RecipientSubjectType.CONTACT,
                subject_value=_CONTACT,
                sources=RecipientSources(root=[]),
                snapshot=RecipientSnapshot(name="Duplicate"),
            )
        )
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()
    with Session(delivery_engine) as session:
        assert SQLAlchemyRecipientRepository(session, _TENANT, _FORM).list_recipients() == (original,)


def test_same_subject_can_participate_in_different_forms(delivery_engine: Engine) -> None:
    original = _create_recipient(delivery_engine)
    with Session(delivery_engine) as session, session.begin():
        other = SQLAlchemyRecipientRepository(session, _TENANT, str(uuid4())).create_recipients([_recipient_params()])[
            0
        ]
        assert other.id != original.id
        assert other.subject == original.subject


def test_failed_batch_is_rolled_back_by_the_caller_transaction(delivery_engine: Engine) -> None:
    with delivery_engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TRIGGER reject_recipient BEFORE INSERT ON hitlv2_recipients "
            "WHEN NEW.subject_value = 'reject' BEGIN SELECT RAISE(ABORT, 'recipient rejected'); END"
        )
    with Session(delivery_engine) as session:
        repo = SQLAlchemyRecipientRepository(session, _TENANT, _FORM)
        repo.create_recipients([_recipient_params()])
        params = [
            RecipientCreateParams(ContactRecipientSubject(ContactId("accepted")), (), "Accepted"),
            RecipientCreateParams(EndUserRecipientSubject("reject"), (), None),
        ]
        with pytest.raises(IntegrityError, match="recipient rejected"):
            repo.create_recipients(params)
        assert not session.is_active
        session.rollback()
    with Session(delivery_engine) as session:
        assert SQLAlchemyRecipientRepository(session, _TENANT, _FORM).list_recipients() == ()


@pytest.mark.parametrize(
    ("target", "authentication"),
    [
        (EmailTargetSnapshot(email_address="shared@example.com"), SubmissionAuthType.EMAIL_OTP),
        (InitiatorSnapshot(), SubmissionAuthType.CONSOLE),
        (InitiatorSnapshot(), SubmissionAuthType.WEB_APP),
        *[
            (
                IMUserTargetSnapshot(
                    im_provider=provider, im_tenant_id="provider-tenant", im_provider_user_id="provider-user"
                ),
                SubmissionAuthType.IM,
            )
            for provider in IMProvider
        ],
    ],
)
def test_delivery_round_trips_frozen_access_data(
    delivery_engine: Engine, target: TargetSnapshot, authentication: SubmissionAuthType
) -> None:
    recipient = _create_recipient(delivery_engine)
    params = replace(_delivery_params(recipient.id), target_snapshot=target, auth_type=authentication)
    with Session(delivery_engine) as session, session.begin():
        delivery = SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=_TENANT, form_id=_FORM, params=params
        )
        assert delivery is not None
        assert delivery.recipient_id == recipient.id
        assert delivery.target_snapshot == target
        assert delivery.auth_type == authentication
        assert delivery.token_hash == _HASH
        assert delivery.created_at.tzinfo is None
        assert delivery.updated_at == delivery.created_at
    with Session(delivery_engine) as session:
        repo = SQLAlchemyDeliveryRepository(session)
        assert repo.get_delivery_by_token_hash(_HASH) == delivery
        assert repo.get_delivery_by_token_hash(_HASH.upper()) is None


def test_deliveries_keep_distinct_recipients_sharing_an_endpoint_and_reject_ambiguous_hashes(
    delivery_engine: Engine,
) -> None:
    recipient = _create_recipient(delivery_engine)
    other = _create_recipient(
        delivery_engine, replace(_recipient_params(), subject=ContactRecipientSubject(ContactId(str(uuid4()))))
    )
    with Session(delivery_engine) as session, session.begin():
        repo = SQLAlchemyDeliveryRepository(session)
        first = repo.create_delivery(tenant_id=_TENANT, form_id=_FORM, params=_delivery_params(recipient.id))
        second = repo.create_delivery(tenant_id=_TENANT, form_id=_FORM, params=_delivery_params(other.id))
        third = repo.create_delivery(
            tenant_id=_TENANT, form_id=_FORM, params=replace(_delivery_params(recipient.id), token_hash="b" * 64)
        )
        assert first is not None
        assert second is not None
        assert third is not None
        assert len({first.id, second.id, third.id}) == 3
        persisted_recipients = (
            session.execute(sa.select(HumanInputDelivery.id, HumanInputDelivery.recipient_id)).tuples().all()
        )
        assert dict(persisted_recipients) == {
            first.id: recipient.id,
            second.id: other.id,
            third.id: recipient.id,
        }
        assert repo.get_delivery_by_token_hash("b" * 64) == third
        with pytest.raises(MultipleResultsFound):
            repo.get_delivery_by_token_hash(_HASH)


@pytest.mark.parametrize(
    ("tenant", "form"),
    [
        (TenantId("00000000-0000-0000-0000-000000000004"), _FORM),
        (_TENANT, "00000000-0000-0000-0000-000000000005"),
    ],
)
def test_owner_scoped_writes_and_global_token_lookup(delivery_engine: Engine, tenant: TenantId, form: str) -> None:
    recipient = _create_recipient(delivery_engine)
    with Session(delivery_engine) as session, session.begin():
        delivery = SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=_TENANT, form_id=_FORM, params=_delivery_params(recipient.id)
        )
        assert delivery is not None
        attempt = SQLAlchemyDeliveryAttemptRepository(session, _TENANT, _FORM).record_attempt(
            delivery.id, _attempt_params()
        )
        assert attempt is not None
        recipients = SQLAlchemyRecipientRepository(session, tenant, form)
        deliveries = SQLAlchemyDeliveryRepository(session)
        attempts = SQLAlchemyDeliveryAttemptRepository(session, tenant, form)
        assert recipients.list_recipients() == ()
        assert recipients.get_recipient(recipient.id) is None
        assert deliveries.create_delivery(tenant_id=tenant, form_id=form, params=_delivery_params(recipient.id)) is None
        assert deliveries.get_delivery_by_token_hash(_HASH) == delivery
        assert attempts.record_attempt(delivery.id, _attempt_params()) is None
        assert session.scalars(sa.select(HumanInputDeliveryAttempt.id)).all() == [attempt.id]
        other_form = str(uuid4())
        other = SQLAlchemyRecipientRepository(session, tenant, other_form).create_recipients([_recipient_params()])[0]
        assert other.id != recipient.id
        own_delivery = deliveries.create_delivery(
            tenant_id=tenant,
            form_id=other_form,
            params=replace(_delivery_params(other.id), token_hash="b" * 64),
        )
        assert own_delivery is not None
        assert own_delivery.tenant_id == tenant
        assert own_delivery.form_id == other_form
        assert deliveries.get_delivery_by_token_hash("b" * 64) == own_delivery
        assert deliveries.get_delivery_by_token_hash(_HASH) == delivery
        assert (
            deliveries.create_delivery(tenant_id=tenant, form_id=other_form, params=_delivery_params(other.id))
            is not None
        )
        with pytest.raises(MultipleResultsFound):
            deliveries.get_delivery_by_token_hash(_HASH)
    with Session(delivery_engine) as session:
        assert SQLAlchemyDeliveryRepository(session).get_delivery_by_token_hash("b" * 64) == own_delivery


def test_missing_membership_does_not_create_delivery_or_attempt(delivery_engine: Engine) -> None:
    with Session(delivery_engine) as session, session.begin():
        deliveries = SQLAlchemyDeliveryRepository(session)
        attempts = SQLAlchemyDeliveryAttemptRepository(session, _TENANT, _FORM)
        assert (
            deliveries.create_delivery(
                tenant_id=_TENANT, form_id=_FORM, params=_delivery_params(RecipientId(str(uuid4())))
            )
            is None
        )
        assert deliveries.get_delivery_by_token_hash(_HASH) is None
        assert session.scalar(sa.select(HumanInputDelivery.id)) is None
        assert attempts.record_attempt(str(uuid4()), _attempt_params()) is None
        assert session.scalar(sa.select(HumanInputDeliveryAttempt.id)) is None


def test_retry_and_resend_append_history_without_changing_delivery(delivery_engine: Engine) -> None:
    recipient = _create_recipient(delivery_engine)
    with Session(delivery_engine) as session, session.begin():
        deliveries = SQLAlchemyDeliveryRepository(session)
        delivery = deliveries.create_delivery(tenant_id=_TENANT, form_id=_FORM, params=_delivery_params(recipient.id))
        assert delivery is not None
        attempts = SQLAlchemyDeliveryAttemptRepository(session, _TENANT, _FORM)
        first = attempts.record_attempt(delivery.id, _attempt_params())
        success = DeliveryAttemptCreateParams(DeliveryStatus.SUCCEEDED, None, {"receipt": "provider-accepted"})
        retry = attempts.record_attempt(delivery.id, success)
        resend = attempts.record_attempt(delivery.id, success)
        assert first is not None
        assert retry is not None
        assert resend is not None
        assert len({first.id, retry.id, resend.id}) == 3
        assert first.response == _attempt_params().response
        assert first.error_message == _attempt_params().error_message
        assert first.status == DeliveryStatus.FAILED
        assert retry.status == DeliveryStatus.SUCCEEDED
        assert retry.error_message is None
        assert first.created_at.tzinfo is None
        assert first.updated_at == first.created_at
        assert deliveries.get_delivery_by_token_hash(_HASH) == delivery
    with Session(delivery_engine) as session:
        history = {record.id: record for record in session.scalars(sa.select(HumanInputDeliveryAttempt))}
        assert set(history) == {first.id, retry.id, resend.id}
        for expected in (first, retry, resend):
            record = history[expected.id]
            assert (record.tenant_id, record.form_id, record.delivery_id) == (_TENANT, _FORM, delivery.id)
            assert record.status == expected.status
            assert record.error_message == expected.error_message
            assert record.response.root == expected.response
            assert record.created_at == expected.created_at
            assert record.updated_at == expected.updated_at


def test_caller_can_roll_back_all_three_repositories_atomically(delivery_engine: Engine) -> None:
    with Session(delivery_engine) as session:
        recipient = SQLAlchemyRecipientRepository(session, _TENANT, _FORM).create_recipients([_recipient_params()])[0]
        delivery = SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=_TENANT, form_id=_FORM, params=_delivery_params(recipient.id)
        )
        assert delivery is not None
        assert (
            SQLAlchemyDeliveryAttemptRepository(session, _TENANT, _FORM).record_attempt(delivery.id, _attempt_params())
            is not None
        )
        session.rollback()
    with Session(delivery_engine) as session:
        assert SQLAlchemyRecipientRepository(session, _TENANT, _FORM).list_recipients() == ()
        assert session.scalar(sa.select(HumanInputDelivery.id)) is None
        assert session.scalar(sa.select(HumanInputDeliveryAttempt.id)) is None


def test_repository_operations_do_not_flush_unrelated_pending_caller_work(delivery_engine: Engine) -> None:
    with Session(delivery_engine) as session:
        pending = HumanInputRecipient(
            tenant_id=_TENANT,
            form_id=_FORM,
            subject_type=RecipientSubjectType.END_USER,
            subject_value="pending",
            sources=RecipientSources(root=[]),
            snapshot=RecipientSnapshot(),
        )
        session.add(pending)
        recipients = SQLAlchemyRecipientRepository(session, _TENANT, _FORM)
        recipient = recipients.create_recipients([_recipient_params()])[0]
        deliveries = SQLAlchemyDeliveryRepository(session)
        delivery = deliveries.create_delivery(tenant_id=_TENANT, form_id=_FORM, params=_delivery_params(recipient.id))
        assert delivery is not None
        attempts = SQLAlchemyDeliveryAttemptRepository(session, _TENANT, _FORM)
        assert attempts.record_attempt(delivery.id, _attempt_params()) is not None
        assert recipients.list_recipients() == (recipient,)
        assert deliveries.get_delivery_by_token_hash(_HASH) == delivery
        assert (
            session.scalar(
                sa.select(sa.func.count()).select_from(HumanInputDeliveryAttempt).execution_options(autoflush=False)
            )
            == 1
        )
        assert pending in session.new
        session.rollback()


def test_mutating_supplied_or_returned_json_does_not_rewrite_persisted_history(delivery_engine: Engine) -> None:
    source = DynamicEmail(selector=["node", "email"])
    params = replace(_recipient_params(), sources=(source,))
    with Session(delivery_engine) as session, session.begin():
        recipients = SQLAlchemyRecipientRepository(session, _TENANT, _FORM)
        recipient = recipients.create_recipients([params])[0]
        source.selector = ["changed", "selector"]
        assert recipient.sources == (DynamicEmail(selector=["node", "email"]),)
        delivery = SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=_TENANT, form_id=_FORM, params=_delivery_params(recipient.id)
        )
        assert delivery is not None
        attempts = SQLAlchemyDeliveryAttemptRepository(session, _TENANT, _FORM)
        metadata: dict[str, JsonValue] = {"request_id": "original"}
        response: dict[str, JsonValue] = {"metadata": metadata}
        attempt = attempts.record_attempt(
            delivery.id, DeliveryAttemptCreateParams(DeliveryStatus.SUCCEEDED, None, response)
        )
        assert attempt is not None
        metadata["request_id"] = "mutated"
        assert attempt.response == {"metadata": {"request_id": "original"}}
        returned_source = recipient.sources[0]
        assert isinstance(returned_source, DynamicEmail)
        returned_source.selector = ["changed", "again"]
        reloaded = recipients.get_recipient(recipient.id)
        assert reloaded is not None
        assert reloaded.sources == (DynamicEmail(selector=["node", "email"]),)
    with Session(delivery_engine) as session:
        persisted_attempt = session.get(HumanInputDeliveryAttempt, attempt.id)
        assert persisted_attempt is not None
        assert persisted_attempt.response.root == {"metadata": {"request_id": "original"}}


@pytest.mark.parametrize(
    ("table", "column", "payload"),
    [
        ("hitlv2_recipients", "sources", '[{"type":"unknown"}]'),
        ("hitlv2_recipients", "snapshot", '{"name":42}'),
        ("hitlv2_deliveries", "target_snapshot", '{"type":"email","email_address":"invalid"}'),
        ("hitlv2_delivery_attempts", "response", "[]"),
    ],
)
def test_malformed_persisted_json_is_rejected_at_the_storage_boundary(
    delivery_engine: Engine, table: str, column: str, payload: str
) -> None:
    recipient = _create_recipient(delivery_engine)
    with Session(delivery_engine) as session, session.begin():
        delivery = SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=_TENANT, form_id=_FORM, params=_delivery_params(recipient.id)
        )
        assert delivery is not None
        attempt = SQLAlchemyDeliveryAttemptRepository(session, _TENANT, _FORM).record_attempt(
            delivery.id, _attempt_params()
        )
        assert attempt is not None
    with delivery_engine.begin() as connection:
        connection.execute(sa.text(f"UPDATE {table} SET {column} = :payload"), {"payload": payload})
    with Session(delivery_engine) as session:
        if table == "hitlv2_recipients":
            with pytest.raises(ValidationError):
                SQLAlchemyRecipientRepository(session, _TENANT, _FORM).get_recipient(recipient.id)
        elif table == "hitlv2_deliveries":
            with pytest.raises(ValidationError):
                SQLAlchemyDeliveryRepository(session).get_delivery_by_token_hash(_HASH)
        else:
            with pytest.raises(ValidationError):
                session.get(HumanInputDeliveryAttempt, attempt.id)
