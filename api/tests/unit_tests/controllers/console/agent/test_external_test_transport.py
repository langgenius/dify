"""Admitted Test/File transport over real application services and scoped SQLite."""

import inspect
from collections.abc import Callable, Iterator
from contextlib import suppress
from dataclasses import replace
from datetime import UTC, datetime
from io import BytesIO
from queue import Empty
from typing import Protocol, runtime_checkable
from uuid import UUID, uuid4

import pytest
from celery import Celery
from celery.contrib.testing.app import TestApp, setup_default_app
from celery.signals import after_task_publish
from flask_restx import Resource
from kombu.message import Message
from kombu.simple import SimpleQueue
from pydantic import TypeAdapter
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, Gone, NotFound

from configs import dify_config
from controllers.console.agent.external_tests import (
    ExternalAgentCapabilitiesApi,
    ExternalAgentTestApi,
    ExternalAgentTestCancelApi,
    ExternalAgentTestFileApi,
    ExternalAgentTestFileReleaseApi,
    ExternalAgentTestLeaveApi,
    ExternalAgentTestPasteLinkApi,
    ExternalAgentTestResultApi,
    _call,
)
from extensions.application_services.external_agents import build_external_agent_services
from machinery.context import RequestContext
from models.external_agent import ExternalAgentFileLease, ExternalAgentInvocation
from repositories.external_agents.asset_repository import ExternalAssetRepository
from repositories.external_agents.observability_repository import ExternalObservabilityRepository
from repositories.external_agents.test_file_repository import ExternalTestFileRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.external_agents.file_profile import FileLimits
from services.external_agents.io_contracts import ExternalIOError
from services.external_agents.runtime_contracts import RuntimeError as ExternalRuntimeError
from services.external_agents.test_service import ExternalTestService
from services.external_agents.traceability import TraceLimits
from tests.helpers.unit.config_override import config_overrides_context
from tests.unit_tests.controllers.console.agent.test_external_endpoint_contracts import EndpointDomain, endpoint_domain
from tests.unit_tests.repositories.external_agents.test_runtime_repository import Clock
from tests.unit_tests.services.external_agents.test_control_plane_applications import MembershipAccess, OwnedUploads

__all__ = ["endpoint_domain"]

type TestTransport = tuple[EndpointDomain, OwnedUploads, Celery]


@runtime_checkable
class AdmittedTestHandler(Protocol):
    def __call__(self, resource: Resource, context: RequestContext, **path: object) -> object: ...


@runtime_checkable
class DisconnectableSignal(Protocol):
    """Celery exposes disconnect at runtime; its bundled stub omits the method."""

    def disconnect(self, receiver: Callable[..., None]) -> object: ...


def mapping(value: object) -> dict[str, object]:
    return TypeAdapter(dict[str, object]).validate_python(value)


def acknowledge_owned_messages(broker: Celery, queues: tuple[str, ...], owned_ids: set[str]) -> None:
    """Remove only this fixture's publications from global memory-transport queues.

    Preconditions: task publication for this fixture has ended. Postcondition:
    its unconsumed envelopes are acknowledged; unrelated queued messages remain
    available. This includes the production hardcoded retention wakeup queue.
    """
    with broker.connection_for_write() as connection:
        for queue in queues:
            preserved: list[Message] = []
            with SimpleQueue(connection, queue) as inbox:
                for _ in range(inbox.qsize()):
                    with suppress(Empty):
                        message = inbox.get(block=False)
                        if message.headers.get("id") in owned_ids:
                            message.ack()
                        else:
                            preserved.append(message)
                for message in reversed(preserved):
                    message.reject(requeue=True)


@pytest.fixture
def test_transport(endpoint_domain: EndpointDomain) -> Iterator[TestTransport]:
    """Enable the actual composition and use typed owned-blob IO plus memory broker."""
    app, context, agent, base, sessions = endpoint_domain
    broker = TestApp(broker="memory://", backend="cache+memory://")
    with (
        config_overrides_context(
            EXTERNAL_AGENTS_ENABLED=True,
            EXTERNAL_AGENTS_QUEUE="test-external-commands-" + uuid4().hex,
            OPS_TRACE_QUEUE="test-external-exports-" + uuid4().hex,
        ),
        setup_default_app(broker),
    ):
        broker.set_current()
        external = build_external_agent_services(
            sessions=sessions,
            workspaces=WorkspaceRepository(sessions),
            rbac=base.rbac,
            tracing=base.tracing,
            files=base.files,
        )
        limits, uploads = (
            FileLimits(max_files=2, max_document_bytes=5, max_image_bytes=7, max_total_bytes=12),
            OwnedUploads(sessions),
        )
        external = replace(
            external,
            file_limits=limits,
            tests=ExternalTestService(
                assets=ExternalAssetRepository(session_factory=sessions),
                access=MembershipAccess(sessions),
                runtime=external.runtime,
                files=ExternalTestFileRepository(sessions=sessions, limits=limits),
                uploads=uploads,
                limits=limits,
                max_variable_bytes=16,
                statistics=ExternalObservabilityRepository(sessions=sessions, limits=TraceLimits()),
                clock=Clock(),
            ),
        )
        services = replace(base, external_agents=external)
        app.extensions["application_services"] = services
        owned_ids: set[str] = set()

        def observe_publication(sender: object = None, headers: object = None, **_kwargs: object) -> None:
            """Observe only task identity, never payload or credentials, through Celery's real signal."""
            if isinstance(sender, str) and sender.startswith("tasks.external_agent_task."):
                identifier = mapping(headers).get("id")
                assert isinstance(identifier, str)
                owned_ids.add(identifier)

        after_task_publish.connect(observe_publication, weak=False)
        try:
            yield (app, context, agent, services, sessions), uploads, broker
        finally:
            assert isinstance(after_task_publish, DisconnectableSignal)
            after_task_publish.disconnect(observe_publication)
            acknowledge_owned_messages(
                broker, ("retention", dify_config.EXTERNAL_AGENTS_QUEUE, dify_config.OPS_TRACE_QUEUE), owned_ids
            )
    broker.close()


def invoke_test(
    domain: EndpointDomain,
    resource: type[Resource],
    method: str,
    *,
    body: dict[str, object] | None = None,
    data: dict[str, object] | None = None,
    **path: object,
) -> object:
    """Enter the real request context after the separately tested role/CSRF admission."""
    app, context, _, _, _ = domain
    handler = inspect.unwrap(vars(resource)[method])
    assert isinstance(handler, AdmittedTestHandler)
    with app.test_request_context("/", method=method.upper(), json=body, data=data):
        return handler(resource(), context, **path)


def start_test(domain: EndpointDomain, *, page: str = "page", key: str = "run") -> dict[str, object]:
    result = invoke_test(
        domain,
        ExternalAgentTestApi,
        "post",
        agent_id=UUID(domain[2]),
        body={"page_session_id": page, "expected_generation": 1, "idempotency_key": key, "task_text": "Task"},
    )
    payload, status = TypeAdapter(tuple[dict[str, object], int]).validate_python(result)
    assert status == 202
    assert payload["state"] == "waiting"
    return payload


def test_capabilities_start_result_and_cancel_are_real_serialized_transitions(test_transport: TestTransport) -> None:
    domain, _, _ = test_transport
    profile = mapping(invoke_test(domain, ExternalAgentCapabilitiesApi, "get"))
    assert profile["enabled"] is True
    assert profile["protocol"] == "a2a-1.0.1"
    assert mapping(mapping(profile["limits"])["files"])["max_image_bytes"] == 7
    first = start_test(domain)
    identifier = TypeAdapter(UUID).validate_python(first["invocation_id"])
    second = start_test(domain)
    assert second["invocation_id"] == str(identifier)
    queried = mapping(
        invoke_test(domain, ExternalAgentTestResultApi, "get", agent_id=UUID(domain[2]), invocation_id=identifier)
    )
    assert queried["invocation_id"] == str(identifier)
    assert queried["outputs"] is None
    assert mapping(queried["statistics"]) == {
        "elapsed_time": None,
        "total_tokens": None,
        "attempt_count": 0,
        "token_reporting_numerator": 0,
        "token_reporting_denominator": 0,
    }
    canceled = invoke_test(
        domain, ExternalAgentTestCancelApi, "post", agent_id=UUID(domain[2]), invocation_id=identifier
    )
    assert canceled == ({"result": "requested"}, 202)
    final = mapping(
        invoke_test(domain, ExternalAgentTestResultApi, "get", agent_id=UUID(domain[2]), invocation_id=identifier)
    )
    assert final["state"] == "stopped"
    assert "opaque-encrypted-value" not in str(final)
    with pytest.raises(NotFound):
        invoke_test(domain, ExternalAgentTestResultApi, "get", agent_id=UUID(domain[2]), invocation_id=uuid4())


def test_upload_read_cap_exact_file_projection_and_scope_preserving_clear(test_transport: TestTransport) -> None:
    domain, uploads, _ = test_transport
    agent = UUID(domain[2])
    invalid_forms: tuple[dict[str, object], ...] = (
        {},
        {"other": (BytesIO(b"five!"), "one.txt")},
        {"file": (BytesIO(b"five!"), "one.txt"), "second": (BytesIO(b"more"), "two.txt")},
    )
    for data in invalid_forms:
        with pytest.raises(BadRequest, match="Exactly one"):
            invoke_test(domain, ExternalAgentTestFileApi, "post", agent_id=agent, data=data)
    with pytest.raises(BadRequest):
        invoke_test(
            domain,
            ExternalAgentTestFileApi,
            "post",
            agent_id=agent,
            data={"page_session_id": "page", "file": (BytesIO(b"123456789012"), "too-big.txt")},
        )
    assert uploads.blobs == {}
    result = invoke_test(
        domain,
        ExternalAgentTestFileApi,
        "post",
        agent_id=agent,
        data={"page_session_id": "page", "file": (BytesIO(b"five!"), "owned.txt")},
    )
    uploaded, status = TypeAdapter(tuple[dict[str, object], int]).validate_python(result)
    assert status == 201
    assert uploaded["filename"] == "owned.txt"
    assert uploaded["size"] == 5
    lease = TypeAdapter(UUID).validate_python(uploaded["lease_id"])
    assert invoke_test(domain, ExternalAgentTestFileReleaseApi, "delete", agent_id=agent, lease_id=lease) == ("", 204)
    assert invoke_test(domain, ExternalAgentTestFileReleaseApi, "delete", agent_id=agent, lease_id=lease) == ("", 204)
    with domain[4]() as session:
        row = session.get(ExternalAgentFileLease, str(lease))
        assert row is not None
        assert row.released_at is not None


def test_paste_and_leave_page_do_not_cancel_or_revive_an_accepted_test(test_transport: TestTransport) -> None:
    domain, uploads, _ = test_transport
    result = invoke_test(
        domain,
        ExternalAgentTestPasteLinkApi,
        "post",
        agent_id=UUID(domain[2]),
        body={
            "page_session_id": "page",
            "url": "https://files.example.test/allowed.txt",
            "filename": "copy.txt",
            "media_type": "text/plain",
        },
    )
    uploaded, status = TypeAdapter(tuple[dict[str, object], int]).validate_python(result)
    assert status == 201
    assert uploads.fetches == ["https://files.example.test/allowed.txt"]
    first = start_test(domain)
    assert invoke_test(domain, ExternalAgentTestLeaveApi, "post", body={"page_session_id": "page"}) == (
        {"result": "success"},
        202,
    )
    with domain[4]() as session:
        row = session.get(ExternalAgentInvocation, first["invocation_id"])
        assert row is not None
        assert row.local_state == "waiting"
        assert row.cancel_state == "none"
    with pytest.raises(Conflict):
        start_test(domain, key="must-not-revive")


def test_result_expiry_maps_to_gone_without_a_body_from_another_generation(test_transport: TestTransport) -> None:
    domain, _, _ = test_transport
    first = start_test(domain)
    identifier = TypeAdapter(UUID).validate_python(first["invocation_id"])
    with domain[4].begin() as session:
        row = session.get(ExternalAgentInvocation, str(identifier))
        assert row is not None
        row.deleted_at = datetime.now(UTC).replace(tzinfo=None)
    with pytest.raises(Gone):
        invoke_test(domain, ExternalAgentTestResultApi, "get", agent_id=UUID(domain[2]), invocation_id=identifier)


@pytest.mark.parametrize(
    ("code", "error_type"),
    [
        ("permission_denied", Forbidden),
        ("execution_unavailable", Forbidden),
        ("invocation_not_found", NotFound),
        ("agent_not_found", NotFound),
        ("data_expired", Gone),
        ("test_expired", Gone),
        ("parent_deleted", Gone),
        ("runtime_conflict", Conflict),
    ],
)
def test_runtime_error_translation_preserves_the_declared_http_category(code: str, error_type: type[Exception]) -> None:
    """Exercise the adapter's typed failure contract without inventing successful service results."""

    def unavailable() -> object:
        raise ExternalRuntimeError(code, "Confirmed domain failure.")

    with pytest.raises(error_type, match="Confirmed domain failure"):
        _call(unavailable)


def test_file_io_translation_has_no_implicit_retry_or_success() -> None:
    def unavailable() -> object:
        raise ExternalIOError("file_unavailable", "Owned file no longer available.")

    with pytest.raises(BadRequest, match="Owned file"):
        _call(unavailable)
