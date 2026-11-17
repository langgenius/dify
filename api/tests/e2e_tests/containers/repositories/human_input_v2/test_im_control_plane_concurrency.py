"""PostgreSQL-only concurrency coverage for Channel-bound IM persistence."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Barrier

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import ActiveRunDecisionKind
from core.human_input_v2.im_integration.sync_records import SysUserId, SysUserIMSyncInitiator
from core.human_input_v2.shared import AccountId, ContactId, DeploymentScope, IMIdentityId, IMSyncRunId
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.account import Account, AccountStatus
from models.human_input_v2 import (
    HumanInputContactIdentity,
    HumanInputIMBinding,
    HumanInputIMBindingWorkspaceOverride,
    HumanInputIMChannel,
    HumanInputIMIdentity,
    HumanInputIMReconciliationChange,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
)
from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials
from repositories.human_input_v2.im_binding_repository import IMBindingAssignment, IMBindingConflictError
from repositories.human_input_v2.im_channel_repository import (
    IMChannel,
    IMChannelId,
    IMChannelStatus,
    WebhookId,
)
from repositories.human_input_v2.im_identity_repository import IMIdentityObservation, OpaqueProviderPayload
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import DeploymentIMChannelWriter
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository
from services.human_input_v2.contact_service_composition import build_deployment_contact_service

pytestmark = pytest.mark.usefixtures("flask_req_ctx_with_containers")


def _channel() -> IMChannel:
    now = naive_utc_now()
    return IMChannel(
        id=IMChannelId(str(uuidv7())),
        created_at=now,
        updated_at=now,
        provider=IMProvider.FEISHU,
        provider_tenant_id=f"provider-{uuidv7()}",
        encrypted_credentials=ChannelEncryptedCredentials(ciphertext="opaque-ciphertext"),
        app_identifier="app-1",
        webhook_id=WebhookId(uuidv7().hex),
        config_version=1,
        status=IMChannelStatus.CONNECTED,
    )


def _cleanup(session_maker: sessionmaker[Session], channel_id: IMChannelId) -> None:
    with session_maker.begin() as session:
        run_ids = session.scalars(
            sa.select(HumanInputIMSyncRun.id).where(HumanInputIMSyncRun.channel_id == str(channel_id))
        ).all()
        if run_ids:
            session.execute(
                sa.delete(HumanInputIMReconciliationChange).where(
                    HumanInputIMReconciliationChange.sync_run_id.in_(run_ids)
                )
            )
            session.execute(sa.delete(HumanInputIMSyncResult).where(HumanInputIMSyncResult.sync_run_id.in_(run_ids)))
        session.execute(
            sa.delete(HumanInputIMBindingWorkspaceOverride).where(
                HumanInputIMBindingWorkspaceOverride.channel_id == str(channel_id)
            )
        )
        session.execute(sa.delete(HumanInputIMBinding).where(HumanInputIMBinding.channel_id == str(channel_id)))
        session.execute(sa.delete(HumanInputIMIdentity).where(HumanInputIMIdentity.channel_id == str(channel_id)))
        session.execute(sa.delete(HumanInputIMSyncRun).where(HumanInputIMSyncRun.channel_id == str(channel_id)))
        session.execute(sa.delete(HumanInputIMChannel).where(HumanInputIMChannel.id == str(channel_id)))


def _persist_channel(session_maker: sessionmaker[Session], channel: IMChannel) -> None:
    with session_maker.begin() as session:
        DeploymentIMChannelWriter(session).create(channel)


def test_concurrent_organization_default_replacements_preserve_both_endpoints() -> None:
    """Exercise the service's Channel/Account locks with concurrent default endpoint swaps."""
    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
    channel = _channel()
    _persist_channel(sessions, channel)
    account_ids = (str(uuidv7()), str(uuidv7()))
    identity_ids = (IMIdentityId(str(uuidv7())), IMIdentityId(str(uuidv7())))
    contacts: list[ContactId] = []
    try:
        with sessions.begin() as session:
            for account_id, identity_id in zip(account_ids, identity_ids, strict=True):
                account = Account(
                    name="Concurrent Contact", email=f"{account_id}@example.com", status=AccountStatus.ACTIVE
                )
                account.id = account_id
                session.add(account)
                session.flush()
                contacts.append(
                    SQLAlchemyContactRepository(session).provision_account_backed_contact(AccountId(account_id))
                )
                SQLAlchemyIMIdentityRepository(session, channel.id).create(
                    identity_id,
                    IMIdentityObservation(
                        provider_user_id=str(identity_id),
                        display_name=None,
                        email=account.email,
                        raw_payload=OpaqueProviderPayload({}),
                        sync_run_id=IMSyncRunId(str(uuidv7())),
                        observed_at=naive_utc_now(),
                    ),
                )
        for contact_id, identity_id in zip(contacts, identity_ids, strict=True):
            with sessions.begin() as session:
                build_deployment_contact_service(session, for_update=True).set_organization_im_binding(
                    DeploymentScope(), contact_id, identity_id
                )
        barrier = Barrier(2)

        def rebind(index: int) -> None:
            barrier.wait(timeout=10)
            with sessions.begin() as session:
                build_deployment_contact_service(session, for_update=True).set_organization_im_binding(
                    DeploymentScope(), contacts[index], identity_ids[1 - index]
                )

        with ThreadPoolExecutor(max_workers=2) as executor:
            list(executor.map(rebind, (0, 1)))
        with sessions() as session:
            current = SQLAlchemyIMBindingRepository(session, channel.id).list_all()
        assert {(binding.contact_id, binding.identity_id) for binding in current} == {
            (contacts[0], identity_ids[1]),
            (contacts[1], identity_ids[0]),
        }
    finally:
        _cleanup(sessions, channel.id)
        with sessions.begin() as session:
            session.execute(
                sa.delete(HumanInputContactIdentity).where(HumanInputContactIdentity.account_id.in_(account_ids))
            )
            session.execute(sa.delete(Account).where(Account.id.in_(account_ids)))


def test_concurrent_sync_triggers_create_at_most_one_active_run() -> None:
    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    channel = _channel()
    _persist_channel(session_maker, channel)
    barrier = Barrier(2)

    def trigger(_index: int) -> ActiveRunDecisionKind:
        barrier.wait()
        with session_maker.begin() as session:
            decision = SQLAlchemyIMControlPlaneRepository(session, channel).create_or_get_active_run(
                sync_run_id=IMSyncRunId(str(uuidv7())),
                started_by=SysUserIMSyncInitiator(SysUserId("00000000-0000-0000-0000-000000000999")),
                now=naive_utc_now(),
            )
            return decision.kind

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            outcomes = list(executor.map(trigger, range(2)))

        assert outcomes.count(ActiveRunDecisionKind.CREATED) == 1
        assert outcomes.count(ActiveRunDecisionKind.EXISTING_ACTIVE) == 1
        with session_maker() as session:
            count = session.scalar(
                sa.select(sa.func.count(HumanInputIMSyncRun.id)).where(
                    HumanInputIMSyncRun.channel_id == str(channel.id)
                )
            )
        assert count == 1
    finally:
        _cleanup(session_maker, channel.id)


def test_concurrent_default_binding_conflict_commits_at_most_one_endpoint() -> None:
    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    channel = _channel()
    _persist_channel(session_maker, channel)
    identity_ids = (IMIdentityId(str(uuidv7())), IMIdentityId(str(uuidv7())))
    contact_id = ContactId(str(uuidv7()))
    run_id = IMSyncRunId(str(uuidv7()))
    now = naive_utc_now()
    with session_maker.begin() as session:
        identities = SQLAlchemyIMIdentityRepository(session, channel.id)
        for index, identity_id in enumerate(identity_ids):
            identities.create(
                identity_id,
                IMIdentityObservation(
                    provider_user_id=f"provider-user-{index}",
                    display_name=None,
                    email=None,
                    raw_payload=OpaqueProviderPayload({}),
                    sync_run_id=run_id,
                    observed_at=now,
                ),
            )
    barrier = Barrier(2)

    def bind(identity_id: IMIdentityId) -> str:
        barrier.wait()
        try:
            with session_maker.begin() as session:
                SQLAlchemyIMBindingRepository(session, channel.id).create(
                    IMBindingAssignment(contact_id, identity_id, datetime.fromtimestamp(now.timestamp())),
                    bound_by_account_id=None,
                )
            return "created"
        except IMBindingConflictError:
            return "conflict"

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            outcomes = list(executor.map(bind, identity_ids))

        assert outcomes.count("created") == 1
        assert outcomes.count("conflict") == 1
        with session_maker() as session:
            assert (
                session.scalar(
                    sa.select(sa.func.count(HumanInputIMBinding.id)).where(
                        HumanInputIMBinding.channel_id == str(channel.id),
                        HumanInputIMBinding.contact_id == str(contact_id),
                    )
                )
                == 1
            )
    finally:
        _cleanup(session_maker, channel.id)
