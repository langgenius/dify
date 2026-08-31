"""Supported-database concurrency contracts for IM Channel creation."""

from __future__ import annotations

from collections.abc import Callable, Generator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.shared import AccountId, TenantId
from libs.datetime_utils import naive_utc_now
from models.human_input_v2 import HumanInputIMChannel, IMEncryptedCredentials
from repositories.human_input_v2.im_channel_repository import (
    IMChannel,
    IMChannelAlreadyConfiguredError,
    IMChannelId,
    IMChannelStatus,
    IMChannelWriter,
    WebhookId,
)
from repositories.human_input_v2.sqlalchemy_im_channel_repository import (
    DeploymentIMChannelWriter,
    WorkspaceIMChannelWriter,
)

type _WriterFactory = Callable[[Session], IMChannelWriter]


@pytest.fixture(params=("postgresql", "mysql"), scope="session")
def im_channel_engine(request: pytest.FixtureRequest) -> Generator[Engine, None, None]:
    if request.param == "postgresql":
        testcontainers_postgres = pytest.importorskip("testcontainers.postgres")
        container = testcontainers_postgres.PostgresContainer("postgres:15-alpine")
    else:
        testcontainers_mysql = pytest.importorskip("testcontainers.mysql")
        container = testcontainers_mysql.MySqlContainer("mysql:8.0")

    container.start()
    raw_url = container.get_connection_url()
    engine = sa.create_engine(raw_url.replace("mysql://", "mysql+pymysql://", 1))
    channel_table = HumanInputIMChannel.metadata.tables[HumanInputIMChannel.__tablename__]
    try:
        HumanInputIMChannel.metadata.create_all(engine, tables=[channel_table])
        yield engine
    finally:
        HumanInputIMChannel.metadata.drop_all(engine, tables=[channel_table])
        engine.dispose()
        container.stop()


@pytest.fixture(autouse=True)
def clean_im_channel_table(im_channel_engine: Engine) -> Generator[None, None, None]:
    with im_channel_engine.begin() as connection:
        connection.execute(sa.delete(HumanInputIMChannel))
    yield
    with im_channel_engine.begin() as connection:
        connection.execute(sa.delete(HumanInputIMChannel))


def _channel() -> IMChannel:
    now = naive_utc_now()
    return IMChannel(
        id=IMChannelId(str(uuid4())),
        created_at=now,
        updated_at=now,
        provider=IMProvider.FEISHU,
        provider_tenant_id=f"provider-tenant-{uuid4()}",
        encrypted_credentials=IMEncryptedCredentials(ciphertext=f"opaque-{uuid4()}"),
        app_identifier=f"app-{uuid4()}",
        webhook_id=WebhookId(uuid4().hex),
        config_version=1,
        status=IMChannelStatus.CONNECTED,
    )


def _concurrent_create_outcomes(
    engine: Engine,
    writer_factories: tuple[_WriterFactory, _WriterFactory],
) -> tuple[type[IMChannelAlreadyConfiguredError] | None, ...]:
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    barrier = Barrier(2)

    def create(index: int) -> type[IMChannelAlreadyConfiguredError] | None:
        try:
            with sessions.begin() as session:
                barrier.wait()
                writer_factories[index](session).create(_channel())
        except IMChannelAlreadyConfiguredError as error:
            return type(error)
        return None

    with ThreadPoolExecutor(max_workers=2) as executor:
        return tuple(executor.map(create, range(2)))


def test_same_workspace_concurrent_create_has_one_committed_winner(
    im_channel_engine: Engine,
) -> None:
    tenant_id = TenantId(str(uuid4()))
    writer_factories: tuple[_WriterFactory, _WriterFactory] = (
        lambda session: WorkspaceIMChannelWriter(session, tenant_id, AccountId(str(uuid4()))),
        lambda session: WorkspaceIMChannelWriter(session, tenant_id, AccountId(str(uuid4()))),
    )

    outcomes = _concurrent_create_outcomes(im_channel_engine, writer_factories)

    assert outcomes.count(None) == 1
    assert outcomes.count(IMChannelAlreadyConfiguredError) == 1
    with Session(im_channel_engine) as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputIMChannel.id))) == 1


def test_different_workspaces_concurrent_create_both_commit(
    im_channel_engine: Engine,
) -> None:
    tenant_ids = (TenantId(str(uuid4())), TenantId(str(uuid4())))
    writer_factories: tuple[_WriterFactory, _WriterFactory] = (
        lambda session: WorkspaceIMChannelWriter(session, tenant_ids[0], AccountId(str(uuid4()))),
        lambda session: WorkspaceIMChannelWriter(session, tenant_ids[1], AccountId(str(uuid4()))),
    )

    outcomes = _concurrent_create_outcomes(im_channel_engine, writer_factories)

    assert outcomes == (None, None)
    with Session(im_channel_engine) as session:
        owner_keys = set(session.scalars(sa.select(HumanInputIMChannel.owner_key)))
    assert owner_keys == {f"workspace:{tenant_id}" for tenant_id in tenant_ids}


def test_deployment_concurrent_create_has_one_committed_winner(
    im_channel_engine: Engine,
) -> None:
    writer_factories: tuple[_WriterFactory, _WriterFactory] = (
        DeploymentIMChannelWriter,
        DeploymentIMChannelWriter,
    )

    outcomes = _concurrent_create_outcomes(im_channel_engine, writer_factories)

    assert outcomes.count(None) == 1
    assert outcomes.count(IMChannelAlreadyConfiguredError) == 1
    with Session(im_channel_engine) as session:
        assert session.scalar(sa.select(HumanInputIMChannel.owner_key)) == "deployment"
