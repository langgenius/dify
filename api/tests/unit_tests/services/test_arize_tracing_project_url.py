"""Arize project links use verified metadata without changing ingestion permissions."""

import json
from collections import deque
from copy import deepcopy
from decimal import Decimal
from typing import Never
from uuid import uuid4

import httpx
import pytest
from dify_trace_arize_phoenix import arize_configuration
from dify_trace_arize_phoenix.arize_configuration import DESTINATION_KEY
from dify_trace_arize_phoenix.config import ArizeConfig
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.helper import ssrf_proxy
from core.ops.ops_trace_manager import OpsTraceManager
from machinery.context import RequestContext
from models.application_trace import ApplicationTraceRun
from models.enums import ConversationFromSource
from models.model import AppMode
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from repositories.application_trace_repository import ApplicationTraceRepository
from services.app_tracing_config_gateway import OpsTraceManagerGateway
from services.app_tracing_config_service import AppTracingConfigService, AppTracingConfigVerificationFailedError
from services.tracing.provider_dispatch import frozen_project_url
from services.tracing.service import ApplicationTracingService
from tests.unit_tests.model_factories import make_app, make_message
from tests.unit_tests.services.tracing.test_arize_configuration import (
    DESTINATION,
    SPACE,
    URL,
    VALUES,
    page,
    project,
    response,
    space,
)
from tests.unit_tests.services.tracing.test_arize_configuration import (
    calls as calls,  # noqa: PLC0414 - Re-export the HTTP boundary fixture for pytest.
)
from tests.unit_tests.services.tracing.test_arize_configuration import (
    responses as responses,  # noqa: PLC0414 - Re-export the HTTP boundary fixture for pytest.
)

pytest_plugins = ("tests.unit_tests.services.tracing.test_nullable_tracing_credentials",)


@pytest.fixture
def verified(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    calls: list[dict[str, object]] = []

    def verify(config: ArizeConfig) -> None:
        calls.append(config.model_dump())

    monkeypatch.setattr(arize_configuration, "verify_configuration", verify)
    return calls


def test_legacy_arize_get_hides_unverified_redirect_without_network_or_rewriting(
    workspace: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    stored = OpsTraceManager.encrypt_tracing_config(
        workspace,
        "arize",
        {"api_key": "synthetic-ingestion-key", "space_id": "U3BhY2U6dGVzdA==", "project": "original"},
    )
    stored["project_url"] = "https://app.arize.com/?redirect_project_name=original"
    untouched = deepcopy(stored)
    calls: list[str] = []

    def forbidden(*_args: object, **_kwargs: object) -> Never:
        calls.append("legacy or network")
        raise AssertionError("Configuration GET must not initialize a tracer or resolve vendor metadata")

    monkeypatch.setattr(OpsTraceManager, "get_trace_config_project_url", forbidden)
    monkeypatch.setattr(ssrf_proxy, "get", forbidden)
    shown = OpsTraceManagerGateway().present_config(
        workspace_id=workspace, tracing_provider="arize", tracing_config=stored
    )

    assert shown["project_url"] is None
    assert calls == []
    assert stored == untouched


def test_real_rsa_create_masked_update_get_and_frozen_history(
    workspace: str,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    verified: list[dict[str, object]],
    calls: list[tuple[str, dict[str, object]]],
    responses: deque[httpx.Response | Exception],
) -> None:
    app_id, message_id = str(uuid4()), str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(
            make_app(
                app_id=app_id,
                tenant_id=workspace,
                mode=AppMode.AGENT,
                tracing=json.dumps({"enabled": True, "tracing_provider": "arize"}),
            )
        )
        session.add(
            make_message(
                message_id=message_id,
                app_id=app_id,
                inputs={},
                query="test",
                message={},
                answer="ok",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.CONSOLE,
            )
        )
    store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    gateway = OpsTraceManagerGateway()
    service = AppTracingConfigService(configs=store, provider=gateway)
    context = RequestContext("request", None, "account", workspace)
    legacy = OpsTraceManager.encrypt_tracing_config(workspace, "arize", VALUES)
    legacy["project_url"] = "https://app.arize.com/?redirect_project_name=exact"
    assert store.create(workspace_id=workspace, app_id=app_id, tracing_provider="arize", tracing_config=legacy)
    repository = ApplicationTraceRepository(sqlite_session_factory)
    run = repository.start(
        tenant_id=workspace, app_id=app_id, source_kind="message", source_id=message_id, session_id="session"
    )
    assert run is not None
    with sqlite_session_factory.begin() as session:
        accepted = session.get(ApplicationTraceRun, run.id)
        assert accepted is not None
        accepted.state = "accepted"
        accepted.attempts = 1
    with sqlite_session_factory() as session:
        accepted_row = deepcopy(
            dict(
                session.execute(select(ApplicationTraceRun.__table__).where(ApplicationTraceRun.id == run.id))
                .mappings()
                .one()
            )
        )
    frozen_before = deepcopy(run.provider_config)

    # Both legacy secret fields are really encrypted, rather than identity stubs.
    assert legacy["api_key"] != VALUES["api_key"]
    assert legacy["space_id"] != SPACE
    responses.extend([space(), page(project())])
    submitted = {
        **VALUES,
        "api_key": "******",
        "space_id": "******",
        DESTINATION_KEY: {"organization_id": "forged", "project_id": "forged"},
        "project_url": "https://untrusted.test/forged",
    }
    untouched = deepcopy(submitted)
    service.update(context, app_id, "arize", submitted)
    current = store.get(workspace_id=workspace, app_id=app_id, tracing_provider="arize")
    assert current is not None
    assert current.tracing_config is not None
    saved = current.tracing_config
    assert saved["api_key"] == legacy["api_key"]
    assert saved["space_id"] == legacy["space_id"]
    assert saved[DESTINATION_KEY] == {**DESTINATION, "source_digest": saved[DESTINATION_KEY]["source_digest"]}
    assert saved["project_url"] == URL
    assert submitted == untouched
    assert len(calls) == 2
    assert verified[-1]["api_key"] == VALUES["api_key"]
    assert verified[-1]["space_id"] == SPACE

    def forbidden(*_args: object, **_kwargs: object) -> Never:
        raise AssertionError("Reading current configuration or frozen history must not use vendor I/O")

    monkeypatch.setattr(ssrf_proxy, "get", forbidden)
    monkeypatch.setattr(OpsTraceManager, "get_trace_config_project_url", forbidden)
    shown = service.get(context, app_id, "arize")
    assert shown is not None
    assert shown.tracing_config is not None
    assert shown.tracing_config["project_url"] == URL
    assert DESTINATION_KEY not in shown.tracing_config
    frozen = repository.source_run(tenant_id=workspace, app_id=app_id, source_kind="message", source_id=message_id)
    assert frozen is not None
    assert (frozen.state, frozen.attempts, frozen.provider_config) == ("accepted", 1, frozen_before)
    assert frozen_project_url("arize", frozen.provider_config) is None
    assert frozen.provider_config == frozen_before
    monkeypatch.setattr(OpsTraceManager, "decrypt_tracing_config", forbidden)
    status = ApplicationTracingService(repository).status(
        tenant_id=workspace, app_id=app_id, source_kind="message", source_id=message_id
    )
    assert status["project_url"] is None
    assert status["status"] == "accepted"
    with sqlite_session_factory() as session:
        after_row = dict(
            session.execute(select(ApplicationTraceRun.__table__).where(ApplicationTraceRun.id == run.id))
            .mappings()
            .one()
        )
    assert after_row == accepted_row

    # A future source freezes the verified destination; it never repairs the old run.
    later_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(
            make_message(
                message_id=later_id,
                app_id=app_id,
                inputs={},
                query="later",
                message={},
                answer="ok",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.CONSOLE,
            )
        )
    later = repository.start(
        tenant_id=workspace, app_id=app_id, source_kind="message", source_id=later_id, session_id="session"
    )
    assert later is not None
    assert frozen_project_url("arize", later.provider_config) == URL


@pytest.mark.parametrize("status", [401, 403, 404, 500])
def test_ingest_verified_key_without_metadata_read_permission_still_saves(
    workspace: str,
    verified: list[dict[str, object]],
    calls: list[tuple[str, dict[str, object]]],
    responses: deque[httpx.Response | Exception],
    status: int,
) -> None:
    responses.append(response({"message": "private-response"}, status))
    saved = OpsTraceManagerGateway().prepare_new_config(
        workspace_id=workspace, tracing_provider="arize", tracing_config=VALUES
    )
    assert "project_url" not in saved
    assert DESTINATION_KEY not in saved
    assert OpsTraceManager.decrypt_tracing_config(workspace, "arize", saved)["api_key"] == VALUES["api_key"]
    assert len(verified) == len(calls) == 1


def test_changed_destination_cannot_keep_old_or_client_supplied_cache(
    workspace: str,
    verified: list[dict[str, object]],
    calls: list[tuple[str, dict[str, object]]],
    responses: deque[httpx.Response | Exception],
) -> None:
    gateway = OpsTraceManagerGateway()
    responses.extend([space(), page(project())])
    before = gateway.prepare_new_config(workspace_id=workspace, tracing_provider="arize", tracing_config=VALUES)
    assert before["project_url"] == URL
    responses.append(response({}, 403))
    after = gateway.prepare_updated_config(
        workspace_id=workspace,
        tracing_provider="arize",
        current_tracing_config=before,
        tracing_config={
            **VALUES,
            "api_key": "******",
            "space_id": "******",
            "project": "later",
            DESTINATION_KEY: before[DESTINATION_KEY],
            "project_url": URL,
        },
    )
    assert after["project"] == "later"
    assert after["api_key"] == before["api_key"]
    assert after["space_id"] == before["space_id"]
    assert "project_url" not in after
    assert DESTINATION_KEY not in after
    assert before["project_url"] == URL
    assert len(calls) == 3
    assert len(verified) == 2


def test_failed_original_ingestion_verification_never_resolves_metadata(
    workspace: str,
    monkeypatch: pytest.MonkeyPatch,
    calls: list[tuple[str, dict[str, object]]],
) -> None:
    def rejected(_config: ArizeConfig) -> Never:
        raise arize_configuration.ArizeConfigurationError("permission_denied")

    monkeypatch.setattr(arize_configuration, "verify_configuration", rejected)
    with pytest.raises(AppTracingConfigVerificationFailedError):
        OpsTraceManagerGateway().prepare_new_config(
            workspace_id=workspace, tracing_provider="arize", tracing_config=VALUES
        )
    assert calls == []
