"""Real provider config serialization must retain verified project links on update."""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.helper import ssrf_proxy
from core.ops import ops_trace_manager
from core.ops.ops_trace_manager import OpsTraceManager
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from machinery.context import RequestContext
from models.enums import ConversationFromSource
from models.model import AppMode
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from repositories.application_trace_repository import ApplicationTraceRepository
from services.app_tracing_config_gateway import OpsTraceManagerGateway
from services.app_tracing_config_service import AppTracingConfigService, AppTracingConfigVerificationFailedError
from services.tracing.provider_dispatch import export_trace
from tests.unit_tests.model_factories import make_app, make_message


@dataclass
class ProviderBoundary:
    calls: list[tuple[str, str, dict[str, object]]] = field(default_factory=list)
    effective: bool = True
    lookup_fails: bool = False

    def verify(self, config: Mapping[str, object], provider: str) -> bool:
        self.calls.append(("verify", provider, dict(config)))
        return self.effective

    def project_url(self, config: Mapping[str, object], provider: str) -> str:
        self.calls.append(("url", provider, dict(config)))
        if self.lookup_fails:
            raise RuntimeError("Synthetic project lookup failure")
        return f"https://tracing.test/{provider}/{config['project']}"

    def project_key(self, config: Mapping[str, object], provider: str) -> str:
        self.calls.append(("key", provider, dict(config)))
        return "verified-project"


@pytest.fixture
def boundary(monkeypatch: pytest.MonkeyPatch) -> ProviderBoundary:
    boundary = ProviderBoundary()

    def encrypt(_tenant: str, value: str) -> str:
        return "test-cipher:" + value

    def decrypt(_tenant: str, values: Sequence[str]) -> list[str]:
        assert all(value.startswith("test-cipher:") for value in values)
        return [value.removeprefix("test-cipher:") for value in values]

    monkeypatch.setattr(ops_trace_manager, "encrypt_token", encrypt)
    monkeypatch.setattr(ops_trace_manager, "batch_decrypt_token", decrypt)
    monkeypatch.setattr(OpsTraceManager, "check_trace_config_is_effective", boundary.verify)
    monkeypatch.setattr(OpsTraceManager, "get_trace_config_project_url", boundary.project_url)
    monkeypatch.setattr(OpsTraceManager, "get_trace_config_project_key", boundary.project_key)
    return boundary


@pytest.mark.parametrize("provider", ["langsmith", "opik"])
@pytest.mark.parametrize("project", ["original", "changed"])
def test_update_resolves_project_link_using_verified_unmasked_configuration(
    boundary: ProviderBoundary, provider: str, project: str
) -> None:
    gateway = OpsTraceManagerGateway()
    workspace = str(uuid4())
    current = gateway.prepare_new_config(
        workspace_id=workspace,
        tracing_provider=provider,
        tracing_config={"api_key": "synthetic-key", "project": "original"},
    )
    submitted = {"api_key": "******", "project": project, "project_url": "https://untrusted.test/stale"}
    updated = gateway.prepare_updated_config(
        workspace_id=workspace, tracing_provider=provider, tracing_config=submitted, current_tracing_config=current
    )

    assert updated["project_url"] == f"https://tracing.test/{provider}/{project}"
    assert updated["api_key"] == current["api_key"] == "test-cipher:synthetic-key"
    assert current["project_url"] == f"https://tracing.test/{provider}/original"
    assert submitted["api_key"] == "******"
    assert [call[0] for call in boundary.calls] == ["verify", "url", "verify", "url"]
    assert boundary.calls[-1][2]["api_key"] == "synthetic-key"
    assert boundary.calls[-1][2]["project"] == project


def test_langfuse_update_uses_current_host_and_resolved_project_key(boundary: ProviderBoundary) -> None:
    gateway = OpsTraceManagerGateway()
    workspace = str(uuid4())
    current = gateway.prepare_new_config(
        workspace_id=workspace,
        tracing_provider="langfuse",
        tracing_config={"public_key": "synthetic-public", "secret_key": "synthetic-secret", "host": "https://old.test"},
    )
    updated = gateway.prepare_updated_config(
        workspace_id=workspace,
        tracing_provider="langfuse",
        tracing_config={"public_key": "******", "secret_key": "******", "host": "https://new.test"},
        current_tracing_config=current,
    )
    assert updated["project_url"] == "https://new.test/project/verified-project"
    assert current["project_url"] == "https://old.test/project/verified-project"
    assert boundary.calls[-1][0] == "key"
    assert boundary.calls[-1][2]["secret_key"] == "synthetic-secret"


def test_failed_optional_link_lookup_does_not_reuse_stale_project_url(boundary: ProviderBoundary) -> None:
    gateway = OpsTraceManagerGateway()
    workspace = str(uuid4())
    current = gateway.prepare_new_config(
        workspace_id=workspace,
        tracing_provider="langsmith",
        tracing_config={"api_key": "synthetic-key", "project": "original"},
    )
    boundary.lookup_fails = True
    updated = gateway.prepare_updated_config(
        workspace_id=workspace,
        tracing_provider="langsmith",
        tracing_config={"api_key": "******", "project": "changed"},
        current_tracing_config=current,
    )
    assert updated["project"] == "changed"
    assert "project_url" not in updated
    assert boundary.calls[-1][0] == "url"


def test_invalid_updated_configuration_never_resolves_a_project_url(boundary: ProviderBoundary) -> None:
    boundary.effective = False
    with pytest.raises(AppTracingConfigVerificationFailedError):
        OpsTraceManagerGateway().prepare_updated_config(
            workspace_id=str(uuid4()),
            tracing_provider="langsmith",
            tracing_config={"api_key": "synthetic-key", "project": "changed"},
            current_tracing_config=None,
        )
    assert [call[0] for call in boundary.calls] == ["verify"]


def test_updated_project_url_is_frozen_and_used_by_real_langsmith_serializer(
    boundary: ProviderBoundary,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace, app_id, message_id = (str(uuid4()) for _ in range(3))
    with sqlite_session_factory.begin() as session:
        session.add(
            make_app(
                app_id=app_id,
                tenant_id=workspace,
                mode=AppMode.AGENT,
                tracing=json.dumps({"enabled": True, "tracing_provider": "langsmith"}),
            )
        )
        session.add(
            make_message(
                message_id=message_id,
                app_id=app_id,
                inputs={},
                query="test input",
                message={},
                answer="test output",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.CONSOLE,
            )
        )
    store = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    configs = AppTracingConfigService(configs=store, provider=OpsTraceManagerGateway())
    context = RequestContext("request", None, "account", workspace)
    configs.create(context, app_id, "langsmith", {"api_key": "synthetic-key", "project": "original"})
    configs.update(context, app_id, "langsmith", {"api_key": "******", "project": "changed"})
    repository = ApplicationTraceRepository(sqlite_session_factory)
    run = repository.start(
        tenant_id=workspace, app_id=app_id, source_kind="message", source_id=message_id, session_id="test-session"
    )
    assert run is not None
    assert run.provider_config["project_url"] == "https://tracing.test/langsmith/changed"
    configs.update(context, app_id, "langsmith", {"api_key": "******", "project": "later"})
    frozen = repository.source_run(tenant_id=workspace, app_id=app_id, source_kind="message", source_id=message_id)
    assert frozen is not None
    assert frozen.provider_config["project_url"] == "https://tracing.test/langsmith/changed"

    requests: list[str] = []

    def send(method: str, url: str, **_kwargs: object) -> httpx.Response:
        requests.append(url)
        return httpx.Response(200, request=httpx.Request(method, url))

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    config = dict(frozen.provider_config)
    config.update(OpsTraceManager.decrypt_tracing_config(workspace, "langsmith", frozen.provider_config))
    start = datetime(2026, 10, 16, tzinfo=UTC)
    trace = CanonicalTrace(
        trace_id=frozen.trace_id,
        session_id=frozen.session_id,
        root_span_id=frozen.root_span_id,
        spans=(
            CanonicalSpan(
                id=frozen.root_span_id,
                name="Agent",
                kind=CanonicalSpanKind.AGENT,
                parent_id=None,
                status=CanonicalSpanStatus.OK,
                start_time=start,
                end_time=start + timedelta(seconds=1),
            ),
        ),
    )
    result = export_trace("langsmith", config, trace)
    assert result.status == "accepted"
    assert result.trace_url == f"https://tracing.test/langsmith/changed/r/{result.trace_id}"
    assert result.span_urls[frozen.root_span_id] == result.trace_url
    assert len(requests) == 1
    assert boundary.calls[-1][2]["project"] == "later"
