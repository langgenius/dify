"""Real SQLite-backed operation owners for focused Builder boundary tests."""

from collections.abc import Generator
from typing import cast

import pytest
from sqlalchemy import Table, create_engine
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeEffectAttempt,
    NativeEffectDispatchClaim,
    NativeEffectOperation,
    NativeEffectOutcome,
    NativeInvocationState,
    NativePayloadObject,
    NativeTestInvocation,
    NativeTestScope,
)
from services.dify_builder.native_testing.agent_operations import AgentOperationBindingResolver, AgentOperationService
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore


@pytest.fixture
def operations_service() -> Generator[AgentOperationService]:
    engine = create_engine("sqlite://")
    for model in (
        DifyBuilderExecutionRequest,
        NativeEffectAttempt,
        NativeEffectDispatchClaim,
        NativeEffectOperation,
        NativeEffectOutcome,
        NativeInvocationState,
        NativePayloadObject,
        NativeTestInvocation,
        NativeTestScope,
    ):
        cast(Table, model.__table__).create(engine)
    sessions = sessionmaker(engine, expire_on_commit=False)
    loader = OwnedNativeTestLoader(
        sessions, actor=Actor(account_id="actor", tenant_id="tenant"), resolver=AgentOperationBindingResolver()
    )

    def assessment(**_kwargs: object) -> None:
        pytest.fail("unexpected reasoning assessment")

    try:
        yield AgentOperationService(loader=loader, state_store=NativeExecutionStateStore(loader), assessor=assessment)
    finally:
        engine.dispose()


@pytest.fixture
def preparation_sql(operations_service: AgentOperationService) -> Generator[Session]:
    """Close the actual preparation writer even when a boundary assertion fails."""
    with operations_service.loader.session_factory() as session:
        yield session
