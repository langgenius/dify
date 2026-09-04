"""PostgreSQL-only concurrency coverage for Channel-bound IM persistence."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Barrier

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import ActiveRunDecisionKind
from core.human_input_v2.shared import ContactId, IMIdentityId, IMSyncRunId
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.human_input_v2 import (
    HumanInputIMBinding,
    HumanInputIMBindingWorkspaceOverride,
    HumanInputIMChannel,
    HumanInputIMIdentity,
    HumanInputIMReconciliationChange,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
    IMEncryptedCredentials,
)
from repositories.human_input_v2.im_binding_repository import IMBindingAssignment, IMBindingConflictError
from repositories.human_input_v2.im_channel_repository import (
    IMChannel,
    IMChannelId,
    IMChannelStatus,
    WebhookId,
)
from repositories.human_input_v2.im_identity_repository import IMIdentityObservation, OpaqueProviderPayload
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import DeploymentIMChannelWriter
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository


def _require_postgresql() -> None:
    if db.engine.dialect.name != "postgresql":
        pytest.skip("requires the CI PostgreSQL integration database")


def _channel() -> IMChannel:
    now = naive_utc_now()
    return IMChannel(
        id=IMChannelId(str(uuidv7())),
        created_at=now,
        updated_at=now,
        provider=IMProvider.FEISHU,
        provider_tenant_id=f"provider-{uuidv7()}",
        encrypted_credentials=IMEncryptedCredentials(ciphertext="opaque-ciphertext"),
        app_identifier="app-1",
        webhook_id=WebhookId(uuidv7().hex),
        config_version=1,
        status=IMChannelStatus.CONNECTED,
    )


def _cleanup(session_maker: sessionmaker[Session], channel_id: IMChannelId) -> None:
    with session_maker.begin() as session:
        run_ids = session.scalars(
            sa.select(HumanInputIMSyncRun.id).where(HumanInputIMSyncRun.integration_id == str(channel_id))
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
        session.execute(sa.delete(HumanInputIMSyncRun).where(HumanInputIMSyncRun.integration_id == str(channel_id)))
        session.execute(sa.delete(HumanInputIMChannel).where(HumanInputIMChannel.id == str(channel_id)))


def _persist_channel(session_maker: sessionmaker[Session], channel: IMChannel) -> None:
    with session_maker.begin() as session:
        DeploymentIMChannelWriter(session).create(channel)


def test_concurrent_sync_triggers_create_at_most_one_active_run(flask_req_ctx: object) -> None:
    _require_postgresql()
    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    channel = _channel()
    _persist_channel(session_maker, channel)
    barrier = Barrier(2)

    def trigger(_index: int) -> ActiveRunDecisionKind:
        barrier.wait()
        with session_maker.begin() as session:
            decision = SQLAlchemyIMControlPlaneRepository(session, channel).create_or_get_active_run(
                sync_run_id=IMSyncRunId(str(uuidv7())),
                started_by_account_id=None,
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
                    HumanInputIMSyncRun.integration_id == str(channel.id)
                )
            )
        assert count == 1
    finally:
        _cleanup(session_maker, channel.id)


def test_concurrent_default_binding_conflict_commits_at_most_one_endpoint(flask_req_ctx: object) -> None:
    _require_postgresql()
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
