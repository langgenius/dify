"""Delivery and Binding write contracts on MySQL and PostgreSQL."""

import os
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from threading import Barrier, Event
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import ORMExecuteState, Session
from testcontainers.community.mysql import MySqlContainer
from testcontainers.community.postgres import PostgresContainer

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.message_locator import MessageLocator
from core.human_input_v2.shared.values import ContactId, IMBindingId, IMIdentityId, RecipientId, TenantId
from libs.datetime_utils import naive_utc_now
from models.human_input_v2 import (
    HumanInputDelivery,
    HumanInputIMBinding,
    HumanInputIMBindingWorkspaceOverride,
    HumanInputIMIdentity,
    IMIdentityRawPayload,
)
from repositories.human_input_v2.delivery_repository import (
    DeliveryCreateParams,
    IMMessageType,
    IMUserTargetSnapshot,
    InitiatorSnapshot,
    SubmissionAuthType,
)
from repositories.human_input_v2.im_binding_repository import IMBinding, IMBindingAssignment, IMBindingConflictError
from repositories.human_input_v2.im_channel_repository import IMChannelId
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository


@pytest.fixture(scope="module", params=["mysql", "postgresql"])
def write_engine(request: pytest.FixtureRequest) -> Iterator[Engine]:
    """Allow an isolated external database, otherwise start a disposable container."""
    dialect = request.param
    external_url = os.environ.get(f"HITL_WRITE_TEST_{dialect.upper()}_URL")
    with ExitStack() as stack:
        if external_url is None:
            container = stack.enter_context(
                MySqlContainer("mysql:8.0", dialect="pymysql")
                if dialect == "mysql"
                else PostgresContainer("postgres:15-alpine")
            )
            external_url = container.get_connection_url()
        engine = sa.create_engine(external_url)
        tables = [
            HumanInputDelivery.metadata.tables[model.__tablename__]
            for model in (
                HumanInputDelivery,
                HumanInputIMIdentity,
                HumanInputIMBinding,
                HumanInputIMBindingWorkspaceOverride,
            )
        ]
        try:
            HumanInputDelivery.metadata.create_all(engine, tables=tables)
            yield engine
        finally:
            engine.dispose()


def _delivery_params(*, im: bool) -> DeliveryCreateParams:
    return DeliveryCreateParams(
        recipient_id=RecipientId(str(uuid4())),
        token_hash=uuid4().hex * 2,
        auth_type=SubmissionAuthType.IM if im else SubmissionAuthType.CONSOLE,
        target_snapshot=(
            IMUserTargetSnapshot(
                im_provider=IMProvider.SLACK,
                im_tenant_id="team",
                im_provider_user_id="user",
                im_binding_id=IMBindingId(str(uuid4())),
                message_type=IMMessageType.CARD,
            )
            if im
            else InitiatorSnapshot(protected_form_token="encrypted-token")
        ),
    )


def test_initiator_delivery_round_trip_and_caller_rollback(write_engine: Engine) -> None:
    tenant_id, form_id = TenantId(str(uuid4())), str(uuid4())
    params = _delivery_params(im=False)
    with Session(write_engine) as session, session.begin():
        delivery = SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=tenant_id, form_id=form_id, params=params
        )
    with Session(write_engine) as session:
        repository = SQLAlchemyDeliveryRepository(session)
        assert repository.get_initiator_delivery(tenant_id=tenant_id, form_id=form_id) == delivery
        assert delivery.target_snapshot == params.target_snapshot
        assert delivery.recipient_id == params.recipient_id
        rolled_back = repository.create_delivery(
            tenant_id=tenant_id, form_id=form_id, params=_delivery_params(im=False)
        )
        session.rollback()
        assert repository.get_delivery(tenant_id=tenant_id, form_id=form_id, delivery_id=rolled_back.id) is None


def test_locator_assignment_is_serialized_idempotent_and_owner_scoped(write_engine: Engine) -> None:
    tenant_id, form_id = TenantId(str(uuid4())), str(uuid4())
    with Session(write_engine) as session, session.begin():
        delivery = SQLAlchemyDeliveryRepository(session).create_delivery(
            tenant_id=tenant_id, form_id=form_id, params=_delivery_params(im=True)
        )
    barrier = Barrier(2)

    def assign(locator: MessageLocator) -> bool:
        barrier.wait(timeout=10)
        try:
            with Session(write_engine) as session, session.begin():
                assigned = SQLAlchemyDeliveryRepository(session).set_im_message_locator(
                    tenant_id=tenant_id, form_id=form_id, delivery_id=delivery.id, message_locator=locator
                )
                assert assigned is not None
            return True
        except ValueError as error:
            if "already has a different message locator" not in str(error):
                raise
            return False

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(assign, (MessageLocator("card-one"), MessageLocator("card-two")))) == [False, True]
    with Session(write_engine) as session, session.begin():
        repository = SQLAlchemyDeliveryRepository(session)
        saved = repository.get_delivery(tenant_id=tenant_id, form_id=form_id, delivery_id=delivery.id)
        assert saved is not None
        assert isinstance(saved.target_snapshot, IMUserTargetSnapshot)
        locator = saved.target_snapshot.message_locator
        assert locator is not None
        assert locator in (MessageLocator("card-one"), MessageLocator("card-two"))
        assert (
            repository.set_im_message_locator(
                tenant_id=tenant_id, form_id=form_id, delivery_id=delivery.id, message_locator=locator
            )
            == saved
        )
        assert (
            repository.set_im_message_locator(
                tenant_id=TenantId(str(uuid4())), form_id=form_id, delivery_id=delivery.id, message_locator=locator
            )
            is None
        )


@pytest.fixture
def binding_scope(write_engine: Engine) -> tuple[IMChannelId, ContactId, tuple[IMIdentityId, ...]]:
    channel_id, contact_id = IMChannelId(str(uuid4())), ContactId(str(uuid4()))
    identity_ids = tuple(IMIdentityId(str(uuid4())) for _ in range(3))
    with Session(write_engine) as session, session.begin():
        for identity_id in identity_ids:
            record = HumanInputIMIdentity(
                channel_id=str(channel_id),
                provider_user_id=str(identity_id),
                raw_payload=IMIdentityRawPayload({}),
                last_seen_sync_run_id=str(uuid4()),
                last_seen_at=naive_utc_now(),
            )
            record.id = str(identity_id)
            session.add(record)
    return channel_id, contact_id, identity_ids


@pytest.mark.parametrize("workspace", [False, True])
def test_binding_replacement_preserves_ids_only_for_identical_assignments_and_rolls_back(
    write_engine: Engine, binding_scope: tuple[IMChannelId, ContactId, tuple[IMIdentityId, ...]], workspace: bool
) -> None:
    channel_id, contact_id, identities = binding_scope
    tenant_id = TenantId(str(uuid4()))

    def replace(session: Session, identity_id: IMIdentityId) -> IMBinding:
        repository = SQLAlchemyIMBindingRepository(session, channel_id)
        assignment = IMBindingAssignment(contact_id, identity_id, naive_utc_now().replace(microsecond=0))
        if workspace:
            return repository.set_workspace_override(tenant_id, assignment, bound_by_account_id=None)
        return repository.replace(assignment, bound_by_account_id=None)

    with Session(write_engine) as session, session.begin():
        original = replace(session, identities[0])
    with Session(write_engine) as session, session.begin():
        updated = replace(session, identities[1])
        assert updated.id != original.id
        assert updated.identity_id == identities[1]
        assert replace(session, identities[1]) == updated
    with Session(write_engine) as session:
        assert replace(session, identities[2]).id != updated.id
        session.rollback()
    with Session(write_engine) as session:
        assert SQLAlchemyIMBindingRepository(session, channel_id).get_effective(tenant_id, contact_id) == updated


@pytest.mark.parametrize("workspace", [False, True])
def test_stale_binding_replacement_cannot_delete_a_concurrent_replacement(
    write_engine: Engine, binding_scope: tuple[IMChannelId, ContactId, tuple[IMIdentityId, ...]], workspace: bool
) -> None:
    channel_id, contact_id, identities = binding_scope
    tenant_id = TenantId(str(uuid4()))
    observed, replaced = Event(), Event()

    def replace(session: Session, identity_id: IMIdentityId) -> IMBinding:
        repository = SQLAlchemyIMBindingRepository(session, channel_id)
        assignment = IMBindingAssignment(contact_id, identity_id, naive_utc_now().replace(microsecond=0))
        if workspace:
            return repository.set_workspace_override(tenant_id, assignment, bound_by_account_id=None)
        return repository.replace(assignment, bound_by_account_id=None)

    with Session(write_engine) as session, session.begin():
        replace(session, identities[0])

    def pause_before_delete(state: ORMExecuteState) -> None:
        if state.is_delete:
            observed.set()
            assert replaced.wait(timeout=10)

    def stale_replace() -> None:
        with Session(write_engine) as session:
            # Pause at the database boundary after the old Binding was observed.
            event.listen(session, "do_orm_execute", pause_before_delete)
            with pytest.raises(IMBindingConflictError, match="changed concurrently"):
                replace(session, identities[2])
            session.rollback()

    with ThreadPoolExecutor(max_workers=1) as executor:
        stale = executor.submit(stale_replace)
        try:
            assert observed.wait(timeout=10)
            with Session(write_engine) as session, session.begin():
                winner = replace(session, identities[1])
        finally:
            replaced.set()
        stale.result(timeout=10)
    with Session(write_engine) as session:
        assert SQLAlchemyIMBindingRepository(session, channel_id).get_effective(tenant_id, contact_id) == winner
